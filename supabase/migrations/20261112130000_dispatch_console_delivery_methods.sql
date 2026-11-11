begin;
-- 발송처리 화면의 배송 방법 선택과 택배 외 일괄 발송(인계) — S36-072·S36-X04(2026-11-11 사용자 결정 묶음 4:
-- "발송처리 화면에서 선택", "택배 외도 일괄"). 기존 주문 상세의 고객 요청·배송비 유지 동의 흐름
-- (admin_select_shipment_delivery_method)은 그대로 두고, 발송처리 화면에서 운영자가 방법을 정하는 별도
-- 입구를 더한다. 고객이 주문서에서 고른 방법(fulfillment_partition)과 다르면 사유가 필수이고, 배송비·결제
-- 금액은 바꾸지 않는다(기존 계약 order_fee_unchanged). 방법 변경과 인계 기록은 기존 트리거
-- (guard_shipment_delivery_method)가 요구하는 method_selected·*_handoff 원장 행을 그대로 남기므로
-- 주문 상세의 방식·인계 이력과 고객 주문 화면이 같은 기록을 읽는다.

-- 고른 배송 건의 현재 방법·고객이 고른 방법·처리 가능 여부와, 그 출고지들에서 켜진 운영 조건.
create function public.admin_dispatch_delivery_options(p_shipment_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ids uuid[];
begin
 perform private.require_operator_capability('sales.manage',false);
 if p_shipment_ids is null or cardinality(p_shipment_ids) not between 1 and 100 or array_position(p_shipment_ids,null) is not null then
  raise invalid_parameter_value using message='invalid_dispatch_delivery_request';end if;
 select array_agg(distinct id order by id) into ids from unnest(p_shipment_ids) id;
 return jsonb_build_object(
  'shipments',coalesce((select jsonb_agg(jsonb_build_object(
    'id',s.id,'orderId',o.id,'orderNumber',o.order_number,'shipmentNumber',s.shipment_number,
    'originId',s.origin_id,'originName',s.origin_name_snapshot,'status',s.status,'orderStatus',o.status,
    'customerMethod',s.fulfillment_partition,'method',s.delivery_method,'updatedAt',s.updated_at,'exportedAt',s.exported_at,
    'hasTracking',s.carrier is not null or s.tracking_number is not null,'packed',packed.value,'claimOpen',claim.value,
    'preorderReady',ready.value,
    'canSelect',s.fulfillment_partition not in('none','digital') and s.status='ready' and s.exported_at is null and s.carrier is null
      and s.tracking_number is null and o.status in('paid','confirmed','shipping') and not claim.value and not packed.value,
    'canHandoff',s.status='ready' and o.status in('confirmed','shipping') and not claim.value and ready.value)
   order by s.id)
   from public.order_shipments s join public.orders o on o.id=s.order_id
   cross join lateral (select exists(select 1 from private.shipment_pack_members m where m.shipment_id=s.id and m.released_at is null) value) packed
   cross join lateral (select exists(select 1 from public.order_cancellation_requests r where r.order_id=o.id and r.status in ('requested','processing','needs_review'))
     or exists(select 1 from public.order_cancellation_claims c where c.order_id=o.id) value) claim
   cross join lateral (select private.shipment_preorder_allocation_ready(s.id) value) ready
   where s.id=any(ids)),'[]'::jsonb),
  'policies',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'originId',p.origin_id,'method',p.method,'revision',p.revision,
    'contactName',p.terms->>'contactName','handoffLocation',p.terms->>'handoffLocation','allowDelegate',p.terms->'allowDelegate')
    order by p.origin_id,p.method)
   from private.fulfillment_delivery_policies p join public.fulfillment_origins origin on origin.id=p.origin_id and origin.is_active
   where p.state='active' and p.method in('quick','pickup','direct','freight') and private.valid_delivery_policy_terms(p.terms,true)
    and p.origin_id in(select origin_id from public.order_shipments where id=any(ids))),'[]'::jsonb));
end $$;
revoke all on function public.admin_dispatch_delivery_options(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.admin_dispatch_delivery_options(uuid[]) to authenticated;

-- 고른 배송 건(1~100)에 한 방법을 적용하고, 퀵·직접배송·화물배송이면 실제 인계 근거까지 한 번에 남긴다.
-- 방문수령은 고객이 일회 수령 확인값을 제시해야 끝나므로 방법 적용만 한다. 배송 건마다 따로 처리해
-- 실패한 건만 되돌리고(행별 결과), 요청 전체는 operation ID로 재전송을 막는다. 잠금은 저장소 공통 순서
-- (주문 id 순 → 배송 건 id 순 → 출고지·운영 조건 공유 잠금)를 따른다.
create function public.admin_dispatch_apply_delivery(p_targets jsonb,p_method text,p_reason text,p_handoff jsonb,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;reason_value text:=nullif(btrim(coalesce(p_reason,'')),'');targets jsonb;ids uuid[];handoff jsonb;request jsonb;receipt jsonb;
 target record;field text;value text;max_length integer;occurred timestamptz;shipment public.order_shipments;purchase public.orders;
 policy private.fulfillment_delivery_policies;snapshot jsonb;evidence jsonb;selection_key uuid;event_key uuid;changed boolean;handed boolean;
 error_text text;results jsonb:='[]'::jsonb;changed_count integer:=0;handoff_count integer:=0;failed_count integer:=0;
begin
 actor:=private.require_operator_capability('sales.manage',false);
 if p_operation_id is null or p_method is null or p_method not in('parcel','quick','pickup','direct','freight')
  or jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 100
  or length(reason_value)>1000
  or (p_handoff is not null and (jsonb_typeof(p_handoff)<>'object' or p_method not in('quick','direct','freight')))
  or exists(select 1 from jsonb_array_elements(p_targets) element where jsonb_typeof(element)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(element) key)<>array['shipmentId','updatedAt']
   or jsonb_typeof(element->'shipmentId')<>'string' or jsonb_typeof(element->'updatedAt')<>'string') then
  raise invalid_parameter_value using message='invalid_dispatch_delivery_request';end if;
 begin
  select jsonb_agg(jsonb_build_object('shipmentId',parsed.id,'updatedAt',parsed.at) order by parsed.id),array_agg(parsed.id order by parsed.id)
   into targets,ids from (select (element->>'shipmentId')::uuid id,(element->>'updatedAt')::timestamptz at from jsonb_array_elements(p_targets) element) parsed;
 exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
  raise invalid_parameter_value using message='invalid_dispatch_delivery_request';end;
 if (select count(distinct id) from unnest(ids) id)<>cardinality(ids) then raise invalid_parameter_value using message='invalid_dispatch_delivery_request';end if;
 if p_handoff is not null then
  -- 주문 상세의 인계 기록(admin_record_shipment_delivery)과 같은 근거 형식이다.
  if exists(select 1 from jsonb_object_keys(p_handoff) key where key not in('operatorName','providerName','providerPhone','handoffReference','occurredAt')) then
   raise invalid_parameter_value using message='invalid_delivery_evidence';end if;
  handoff:='{}'::jsonb;
  foreach field in array array['operatorName','providerName','providerPhone','handoffReference','occurredAt'] loop
   if jsonb_typeof(p_handoff->field) is distinct from 'string' then raise invalid_parameter_value using message='invalid_delivery_evidence';end if;
   value:=btrim(p_handoff->>field);
   max_length:=case when field in('operatorName','providerName') then 100 when field='providerPhone' then 40 else 2000 end;
   if length(value) not between 1 and max_length then raise invalid_parameter_value using message='invalid_delivery_evidence';end if;
   handoff:=handoff||jsonb_build_object(field,value);
  end loop;
  if handoff->>'occurredAt'!~'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$' then
   raise invalid_parameter_value using message='invalid_delivery_evidence';end if;
  begin occurred:=(handoff->>'occurredAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then raise invalid_parameter_value using message='invalid_delivery_evidence';end;
  handoff:=handoff||jsonb_build_object('occurredAt',occurred);
 end if;
 request:=jsonb_build_object('targets',targets,'method',p_method,'reason',reason_value,'handoff',handoff);
 perform pg_advisory_xact_lock(hashtextextended('dispatch-delivery:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.shipment.dispatch_delivery_applied',request);
 if receipt is not null then return receipt||jsonb_build_object('replayed',true);end if;
 perform o.id from public.orders o where o.id in(select order_id from public.order_shipments where id=any(ids)) order by o.id for update;
 perform s.id from public.order_shipments s where s.id=any(ids) order by s.id for update;
 for target in select (element->>'shipmentId')::uuid id,(element->>'updatedAt')::timestamptz at from jsonb_array_elements(targets) element order by 1 loop
  begin
   changed:=false;handed:=false;policy:=null;snapshot:=null;
   select * into shipment from public.order_shipments where id=target.id;
   if not found then raise no_data_found using message='shipment_not_found';end if;
   select * into purchase from public.orders where id=shipment.order_id;
   if shipment.updated_at<>target.at then raise sqlstate 'PT409' using message='shipment_delivery_changed';end if;
   if shipment.delivery_method<>p_method then
    if shipment.fulfillment_partition in('none','digital') then raise check_violation using message='delivery_method_fixed';end if;
    if shipment.status<>'ready' or shipment.exported_at is not null or shipment.carrier is not null or shipment.tracking_number is not null
     or purchase.status not in('paid','confirmed','shipping') then raise check_violation using message='delivery_method_selection_unavailable';end if;
    perform private.assert_order_dispatch_allowed(purchase.id);
    -- 합포장은 택배 묶음이다. 한 건만 다른 방법으로 빼면 묶음 출고·송장 처리가 막히므로 먼저 해제한다.
    if exists(select 1 from private.shipment_pack_members where shipment_id=shipment.id and released_at is null) then
     raise check_violation using message='shipment_pack_method_locked';end if;
    if p_method<>shipment.fulfillment_partition and reason_value is null then
     raise check_violation using message='dispatch_method_reason_required';end if;
    if p_method<>'parcel' then
     perform id from public.fulfillment_origins where id=shipment.origin_id and is_active for share;
     if not found then raise check_violation using message='delivery_policy_unavailable';end if;
     select * into policy from private.fulfillment_delivery_policies where origin_id=shipment.origin_id and method=p_method and state='active' for share;
     if not found or not private.valid_delivery_policy_terms(policy.terms,true) then raise check_violation using message='delivery_policy_unavailable';end if;
     snapshot:=(policy.terms-'approvalReference')||jsonb_build_object('version',1,'policyId',policy.id,'revision',policy.revision,
      'feeRule','order_fee_unchanged','confirmationRule','recipient_code');
    end if;
    selection_key:=extensions.uuid_generate_v5(p_operation_id,shipment.id::text||':method');
    evidence:=jsonb_build_object('fromMethod',shipment.delivery_method,'toMethod',p_method,'customerMethod',shipment.fulfillment_partition,
     'policyId',policy.id,'policyRevision',policy.revision,'dispatchReason',reason_value,'source','dispatch_console','batchOperationId',p_operation_id,
     'shippingFee',shipment.shipping_fee,'orderTotal',purchase.total,'feeRule','order_fee_unchanged');
    insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
     values(selection_key,shipment.id,'method_selected',actor,extensions.digest(request::text||':'||shipment.id::text||':method','sha256'),evidence);
    update public.order_shipments set delivery_method=p_method,delivery_policy_id=policy.id,delivery_method_snapshot=snapshot,
     delivery_selection_id=selection_key,delivery_event_id=null,updated_at=clock_timestamp() where id=shipment.id;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_method_selected','order:'||purchase.id,
     jsonb_build_object('shipmentId',shipment.id,'operationId',selection_key,'from',shipment.delivery_method,'to',p_method,'shippingFee',shipment.shipping_fee,
      'customerMethod',shipment.fulfillment_partition,'reason',reason_value,'source','dispatch_console','batchOperationId',p_operation_id));
    select * into shipment from public.order_shipments where id=target.id;
    changed:=true;
   end if;
   if handoff is not null then
    if purchase.status not in('confirmed','shipping') or shipment.status<>'ready' or shipment.delivery_method<>p_method then
     raise check_violation using message='delivery_method_evidence_required';end if;
    perform private.assert_order_dispatch_allowed(purchase.id);
    perform private.assert_shipment_preorder_ready(shipment.id);
    if occurred>clock_timestamp() or occurred<greatest(shipment.created_at,coalesce(purchase.confirmed_at,shipment.created_at)) then
     raise check_violation using message='invalid_delivery_evidence';end if;
    event_key:=extensions.uuid_generate_v5(p_operation_id,shipment.id::text||':handoff');
    insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
     values(event_key,shipment.id,p_method||'_handoff',actor,extensions.digest(request::text||':'||shipment.id::text||':handoff','sha256'),
      handoff||jsonb_build_object('selectionId',shipment.delivery_selection_id,'policyId',shipment.delivery_policy_id,
       'policyRevision',shipment.delivery_method_snapshot->'revision','source','dispatch_console','batchOperationId',p_operation_id));
    update public.order_shipments set status='shipping',delivery_event_id=event_key,shipped_at=occurred,updated_at=clock_timestamp() where id=shipment.id;
    insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.shipment.delivery_evidence_recorded','order:'||purchase.id,
     jsonb_build_object('shipmentId',shipment.id,'operationId',event_key,'method',p_method,'kind',p_method||'_handoff','occurredAt',occurred,
      'source','dispatch_console','batchOperationId',p_operation_id));
    handed:=true;
   end if;
   if not changed and not handed then raise check_violation using message='dispatch_delivery_unchanged';end if;
   results:=results||jsonb_build_array(jsonb_build_object('shipmentId',target.id,'ok',true,'methodChanged',changed,'handedOff',handed));
   changed_count:=changed_count+case when changed then 1 else 0 end;handoff_count:=handoff_count+case when handed then 1 else 0 end;
  exception when others then
   get stacked diagnostics error_text=message_text;
   results:=results||jsonb_build_array(jsonb_build_object('shipmentId',target.id,'ok',false,'error',error_text));
   failed_count:=failed_count+1;
  end;
 end loop;
 receipt:=jsonb_build_object('operationId',p_operation_id,'method',p_method,'results',results,
  'changed',changed_count,'handedOff',handoff_count,'failed',failed_count);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.shipment.dispatch_delivery_applied',
  'dispatch:'||p_operation_id,jsonb_build_object('request',request,'result',receipt,'source','dispatch_console'));
 return receipt||jsonb_build_object('replayed',false);
end $$;
revoke all on function public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_dispatch_delivery_options(uuid[])'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)'::regprocedure,'sales.manage','write',false);
commit;

begin;
-- 운영 강제 배송완료 — 1014-083(2026-11-11 사용자 결정 묶음 3: "운영 전체 주문 허용"). 10/14 회의에서
-- 구매확정·리뷰를 시험하려고 운영 사이트에서도 주문을 배송완료로 바꿀 수 있어야 한다고 요청했다.
-- 스테이징 전용 테스트 배송완료(admin_mark_staging_test_delivered, ADR-0025 A15)와 같은 전이를 환경 허용 행 없이 열고,
-- 택배 외 배송 건(퀵·직접배송·화물배송·방문수령·배송없음 직접전달)까지 넓힌다. 안전장치: 사유 필수, 화면의 대상
-- 확인창(아래 미리보기), operation ID 재전송, 감사 기록(admin.order.forced_delivered — 사유·처리한 배송 건).
-- 권한은 배송 처리 권한(sales.manage)이다 — 운송장·인계 근거 없이 철회 기간을 여는 도구라 최소 권한을 유지한다.
--
-- 전이는 발주확인 이후 주문의 남은 배송 건(준비·배송 중)을 배송완료로 옮기는 것이다. 택배는 운송장 없이, 택배 외
-- 방식은 실제 인계·일회 수령 확인값 대신 'forced_delivered' 증거 행(사유 포함)으로 옮긴다. 준비 → 배송완료로 바로
-- 옮겨 택배 발송 메일 대기열은 생기지 않는다. 주문 상태 집계·구매확정 기한·고객 앱 알림('배송이 완료됐어요')은 기존
-- 트리거가 정상 배송완료와 같게 만든다. 합포장 소속이면 운영 배송완료와 같이 묶음 전체를 함께 옮긴다.
-- 예외(오케스트레이터 결정·법적 근거): 예약 재고 미할당·주문제작 미완료는 실물이 없어 재고 불변식상 막고, 디지털
-- 파일은 구매자가 내려받을 때만 '제공 시작'을 기록한다(청약철회가 제한되는 시점이라 강제로 만들지 않는다).
-- 진행 중인 취소·반품·교환이 있는 주문도 클레임을 먼저 정리한다.

-- 택배 외 배송 건의 강제 배송완료 증거. 기존 인계·수령 증거와 같은 원장에 남겨 주문 상세 방식·인계 이력이 읽는다.
alter table private.shipment_delivery_operations drop constraint shipment_delivery_operations_kind_check;
alter table private.shipment_delivery_operations add constraint shipment_delivery_operations_kind_check check(kind in(
 'method_selected','quick_handoff','quick_receive','pickup_receive','direct_handoff','direct_receive','freight_handoff','freight_receive',
 'none_receive','digital_access','forced_delivered'));

-- 배송 방식 가드가 강제 증거를 받게 두 곳만 바꾼다(다른 트랙의 재정의와 겹쳐도 앵커가 정확히 한 번씩 있어야 한다).
do $patch$
declare definition text:=pg_get_functiondef('private.guard_shipment_delivery_method()'::regprocedure);
 transition_anchor constant text:=$a$or new.delivery_method='digital' and old.status='ready' and new.status='delivered' and operation.kind='digital_access'$a$;
 receipt_anchor constant text:=$a$elsif new.status='delivered' and not exists(select 1 from private.shipment_receipt_confirmations c where c.shipment_id=new.id$a$;
begin
 if (length(definition)-length(replace(definition,transition_anchor,'')))/length(transition_anchor)<>1
  or (length(definition)-length(replace(definition,receipt_anchor,'')))/length(receipt_anchor)<>1 then
  raise exception 'guard_shipment_delivery_method anchors changed';end if;
 definition:=replace(definition,transition_anchor,transition_anchor||E'\n    or new.delivery_method in(''quick'',''direct'',''freight'',''pickup'',''none'') and old.status in(''ready'',''shipping'') and new.status=''delivered'' and operation.kind=''forced_delivered''');
 definition:=replace(definition,receipt_anchor,$r$elsif new.status='delivered' and operation.kind<>'forced_delivered' and not exists(select 1 from private.shipment_receipt_confirmations c where c.shipment_id=new.id$r$);
 execute definition;
end $patch$;

-- 주문번호는 형식만 가볍게 본다(새 주문번호 형식이 와도 정확히 일치하는 주문만 찾는다).
create function private.forced_delivery_order_number(p_order_number text) returns text
language plpgsql immutable set search_path='' as $$
begin
 if p_order_number is null or btrim(p_order_number)!~'^[0-9]{8,32}$' then raise invalid_parameter_value using message='invalid_forced_delivery';end if;
 return btrim(p_order_number);
end $$;
revoke all on function private.forced_delivery_order_number(text) from public,anon,authenticated,service_role;

-- 확인창에 보일 대상과 막는 사유. 읽기만 하고 잠그지 않는다 — 실행 함수가 잠근 뒤 같은 조건을 다시 본다.
-- shipments에는 함께 옮길 배송 건(합포장 포함)과, 제외되는 이 주문의 디지털 파일 배송 건을 함께 싣는다.
create function public.admin_force_order_delivery_preview(p_order_number text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;targets uuid[];scope uuid[];blockers text[]:='{}'::text[];
begin
 perform private.require_operator_capability('sales.manage',false);
 select * into purchase from public.orders where order_number=private.forced_delivery_order_number(p_order_number);
 if not found then raise no_data_found using message='forced_delivery_order_not_found';end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into targets from public.order_shipments
  where order_id=purchase.id and status in('ready','shipping') and delivery_method<>'digital';
 scope:=case when cardinality(targets)>0 then private.shipment_pack_scope(targets) else '{}'::uuid[] end;
 if cardinality(targets)=0 then
  blockers:=blockers||case when purchase.status not in('confirmed','shipping') then 'requires_confirmed'
   when exists(select 1 from public.order_shipments where order_id=purchase.id and status in('ready','shipping') and delivery_method='digital') then 'digital_access_only'
   else 'nothing_to_deliver' end;
 else
  if exists(select 1 from public.orders o where o.id in(select order_id from public.order_shipments where id=any(scope)) and o.status not in('confirmed','shipping')) then
   blockers:=blockers||'requires_confirmed'::text;end if;
  if exists(select 1 from public.order_shipments s where s.id=any(scope) and (exists(select 1 from public.order_cancellation_requests r where r.order_id=s.order_id and r.status in('requested','processing','needs_review'))
   or exists(select 1 from public.order_cancellation_claims c where c.order_id=s.order_id))) then blockers:=blockers||'claim_in_progress'::text;end if;
  if exists(select 1 from public.order_shipments where id=any(scope) and status in('ready','shipping') and not private.shipment_preorder_allocation_ready(id)) then
   blockers:=blockers||'preorder_allocation_required'::text;end if;
  if exists(select 1 from public.order_shipment_items si join public.order_items i on i.id=si.order_item_id join public.order_shipments s on s.id=si.shipment_id
   where si.shipment_id=any(scope) and s.status='ready' and i.production_terms_snapshot is not null
    and not exists(select 1 from private.order_production_jobs j where j.order_item_id=i.id and j.claim_id is null and j.state='completed')) then
   blockers:=blockers||'production_incomplete'::text;end if;
 end if;
 return jsonb_build_object('orderId',purchase.id,'orderNumber',purchase.order_number,'status',purchase.status,'createdAt',purchase.created_at,
  'buyerName',(select coalesce(nullif(p.nickname,''),'fan_'||left(purchase.user_id::text,6)) from public.profiles p where p.id=purchase.user_id),
  'itemCount',(select count(*) from public.order_items where order_id=purchase.id)::integer,
  'firstItemName',(select good_name_snapshot from public.order_items where order_id=purchase.id order by id limit 1),
  'orderCount',(select count(distinct order_id) from public.order_shipments where id=any(scope))::integer,
  'shipments',coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'shipmentNumber',s.shipment_number,'orderNumber',o.order_number,
    'originName',s.origin_name_snapshot,'status',s.status,'method',s.delivery_method,'carrier',s.carrier,'trackingNumber',s.tracking_number,'exportedAt',s.exported_at) order by s.id)
   from public.order_shipments s join public.orders o on o.id=s.order_id
   where s.status in('ready','shipping') and (s.id=any(scope) or s.order_id=purchase.id and s.delivery_method='digital')),'[]'::jsonb),
  'blockers',to_jsonb(blockers));
end $$;
revoke all on function public.admin_force_order_delivery_preview(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_force_order_delivery_preview(text) to authenticated;

create function public.admin_force_order_delivered(p_order_number text,p_reason text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;order_number_value text;reason_value text:=nullif(btrim(coalesce(p_reason,'')),'');purchase public.orders;
 targets uuid[];ids uuid[];shipment public.order_shipments;related record;delivered integer:=0;at_value timestamptz;request jsonb;receipt jsonb;event_key uuid;
begin
 actor:=private.require_operator_capability('sales.manage',false);
 order_number_value:=private.forced_delivery_order_number(p_order_number);
 if p_operation_id is null then raise invalid_parameter_value using message='invalid_forced_delivery';end if;
 if reason_value is null or length(reason_value)>500 then raise invalid_parameter_value using message='forced_delivery_reason_required';end if;
 request:=jsonb_build_object('orderNumber',order_number_value,'reason',reason_value);
 perform pg_advisory_xact_lock(hashtextextended('forced-delivery:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.order.forced_delivered',request);
 if receipt is not null then return receipt;end if;
 select * into purchase from public.orders where order_number=order_number_value;
 if not found then raise no_data_found using message='forced_delivery_order_not_found';end if;
 -- 디지털 파일 배송 건은 구매자가 내려받을 때만 제공 시작으로 기록한다(청약철회 제한 시점). 강제 대상에서 뺀다.
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into targets from public.order_shipments
  where order_id=purchase.id and status in('ready','shipping') and delivery_method<>'digital';
 if cardinality(targets)=0 then
  select * into purchase from public.orders where id=purchase.id for update;
  if purchase.status not in('confirmed','shipping') then raise check_violation using message='forced_delivery_requires_confirmed';end if;
  if exists(select 1 from public.order_shipments where order_id=purchase.id and status in('ready','shipping') and delivery_method='digital') then
   raise check_violation using message='forced_delivery_digital_access_only';end if;
  raise check_violation using message='forced_delivery_nothing_to_deliver';
 end if;
 -- 주문 id 순 → 배송 건 id 순으로 묶음 전체를 잠근다(운영 배송완료와 같은 잠금).
 ids:=private.lock_shipment_pack_scope(targets);
 if exists(select 1 from public.order_shipments where order_id=purchase.id and status in('ready','shipping') and delivery_method<>'digital' and id<>all(ids)) then
  raise sqlstate 'PT409' using message='shipment_pack_changed';end if;
 if exists(select 1 from public.orders o where o.id in(select order_id from public.order_shipments where id=any(ids)) and o.status not in('confirmed','shipping')) then
  raise check_violation using message='forced_delivery_requires_confirmed';end if;
 perform private.assert_order_dispatch_allowed(packed.order_id) from (select distinct order_id from public.order_shipments where id=any(ids) order by order_id) packed;
 at_value:=clock_timestamp();
 for shipment in select * from public.order_shipments where id=any(ids) and status in('ready','shipping') and delivery_method<>'digital' order by id loop
  perform private.assert_shipment_preorder_ready(shipment.id);
  event_key:=null;
  if shipment.delivery_method<>'parcel' then
   -- 택배 외 방식은 실제 인계·일회 수령 확인값 대신 이 증거 행으로 옮긴다(배송 방식 가드가 받는 유일한 강제 경로).
   event_key:=extensions.uuid_generate_v5(p_operation_id,shipment.id::text||':forced');
   insert into private.shipment_delivery_operations(id,shipment_id,kind,actor_id,request_digest,evidence)
    values(event_key,shipment.id,'forced_delivered',actor,extensions.digest(request::text||':'||shipment.id::text,'sha256'),
     jsonb_build_object('occurredAt',at_value,'reason',reason_value,'operationId',p_operation_id,'fromStatus',shipment.status,'method',shipment.delivery_method,
      'selectionId',shipment.delivery_selection_id,'policyId',shipment.delivery_policy_id,'policyRevision',shipment.delivery_method_snapshot->'revision'));
  end if;
  update public.order_shipments set status='delivered',shipped_at=coalesce(shipped_at,at_value),delivered_at=at_value,
   delivery_event_id=coalesce(event_key,delivery_event_id),updated_at=at_value where id=shipment.id;
  delivered:=delivered+1;
 end loop;
 if delivered=0 then raise check_violation using message='forced_delivery_nothing_to_deliver';end if;
 select * into purchase from public.orders where id=purchase.id;
 receipt:=jsonb_build_object('orderId',purchase.id,'orderNumber',purchase.order_number,'status',purchase.status,'deliveredShipments',delivered,
  'orderCount',(select count(distinct order_id) from public.order_shipments where id=any(ids))::integer,'deliveredAt',at_value);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.forced_delivered','order:'||purchase.id,
  jsonb_build_object('request',request,'result',receipt,'forced',true,'reason',reason_value,'shipmentIds',to_jsonb(ids),
   'methods',(select jsonb_object_agg(id::text,delivery_method) from public.order_shipments where id=any(ids))));
 -- 합포장으로 함께 옮긴 다른 주문에도 같은 사유를 남겨 각 주문의 기록에서 찾을 수 있게 한다.
 for related in select distinct order_id from public.order_shipments where id=any(ids) and order_id<>purchase.id order by order_id loop
  insert into public.audit_log(actor_id,action,target,diff) values(actor,'admin.order.forced_delivered','order:'||related.order_id,
   jsonb_build_object('forced',true,'reason',reason_value,'viaPackOf',purchase.id,'operationId',p_operation_id,
    'shipmentIds',(select to_jsonb(array_agg(id order by id)) from public.order_shipments where id=any(ids) and order_id=related.order_id)));
 end loop;
 return receipt;
end $$;
revoke all on function public.admin_force_order_delivered(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_force_order_delivered(text,text,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_force_order_delivery_preview(text)'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_force_order_delivered(text,text,uuid)'::regprocedure,'sales.manage','write',false);
commit;

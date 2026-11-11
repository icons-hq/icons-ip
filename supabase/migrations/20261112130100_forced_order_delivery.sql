begin;
-- 운영 강제 배송완료 — 1014-083(2026-11-11 사용자 결정 묶음 3: "운영 전체 주문 허용"). 10/14 회의에서
-- 구매확정·리뷰를 시험하려고 운영 사이트에서도 주문을 배송완료로 바꿀 수 있어야 한다고 요청했다.
-- 스테이징 전용 테스트 배송완료(admin_mark_staging_test_delivered, ADR-0025 A15)와 같은 전이를 쓰되 환경
-- 허용 행 없이 열고, 대신 안전장치를 둔다: 사유 필수, 화면의 대상 확인창(아래 미리보기), operation ID
-- 재전송, 감사 기록(admin.order.forced_delivered — 사유·처리한 배송 건). 권한은 배송 처리 권한(sales.manage).
--
-- 전이는 발주확인 이후 택배 주문의 남은 배송 건(준비·배송 중)을 배송완료로 옮기는 것뿐이다. 준비 → 배송완료로
-- 바로 옮겨 발송 메일 대기열을 만들지 않고, 합포장 소속이면 운영 배송완료와 같이 묶음 전체를 함께 옮긴다.
-- 주문 상태 집계·구매확정 기한은 기존 트리거가 정상 배송완료와 같게 저장하므로 자동 구매확정·리뷰 자격도
-- 같은 흐름을 탄다. 택배 외 배송 건은 기존 트리거가 일회 수령 확인값을 요구하므로 대상이 아니다.

-- 주문번호는 형식만 가볍게 본다(새 주문번호 형식이 와도 정확히 일치하는 주문만 찾는다).
create function private.forced_delivery_order_number(p_order_number text) returns text
language plpgsql immutable set search_path='' as $$
begin
 if p_order_number is null or btrim(p_order_number)!~'^[0-9]{8,32}$' then raise invalid_parameter_value using message='invalid_forced_delivery';end if;
 return btrim(p_order_number);
end $$;
revoke all on function private.forced_delivery_order_number(text) from public,anon,authenticated,service_role;

-- 확인창에 보일 대상과 막는 사유. 읽기만 하고 잠그지 않는다 — 실행 함수가 잠근 뒤 같은 조건을 다시 본다.
create function public.admin_force_order_delivery_preview(p_order_number text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare purchase public.orders;targets uuid[];scope uuid[];blockers text[]:='{}'::text[];
begin
 perform private.require_operator_capability('sales.manage',false);
 select * into purchase from public.orders where order_number=private.forced_delivery_order_number(p_order_number);
 if not found then raise no_data_found using message='forced_delivery_order_not_found';end if;
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into targets from public.order_shipments where order_id=purchase.id and status in('ready','shipping');
 scope:=case when cardinality(targets)>0 then private.shipment_pack_scope(targets) else '{}'::uuid[] end;
 if cardinality(targets)=0 then
  blockers:=blockers||case when purchase.status in('confirmed','shipping') then 'nothing_to_deliver' else 'requires_confirmed' end;
 else
  if exists(select 1 from public.orders o where o.id in(select order_id from public.order_shipments where id=any(scope)) and o.status not in('confirmed','shipping')) then
   blockers:=blockers||'requires_confirmed'::text;end if;
  if exists(select 1 from public.order_shipments s where s.id=any(scope) and (exists(select 1 from public.order_cancellation_requests r where r.order_id=s.order_id and r.status in('requested','processing','needs_review'))
   or exists(select 1 from public.order_cancellation_claims c where c.order_id=s.order_id))) then blockers:=blockers||'claim_in_progress'::text;end if;
  if exists(select 1 from public.order_shipments where id=any(scope) and status in('ready','shipping') and delivery_method<>'parcel') then
   blockers:=blockers||'parcel_only'::text;end if;
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
    'originName',s.origin_name_snapshot,'status',s.status,'method',s.delivery_method,'carrier',s.carrier,'trackingNumber',s.tracking_number) order by s.id)
   from public.order_shipments s join public.orders o on o.id=s.order_id where s.id=any(scope) and s.status in('ready','shipping')),'[]'::jsonb),
  'blockers',to_jsonb(blockers));
end $$;
revoke all on function public.admin_force_order_delivery_preview(text) from public,anon,authenticated,service_role;
grant execute on function public.admin_force_order_delivery_preview(text) to authenticated;

create function public.admin_force_order_delivered(p_order_number text,p_reason text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;order_number_value text;reason_value text:=nullif(btrim(coalesce(p_reason,'')),'');purchase public.orders;
 targets uuid[];ids uuid[];shipment record;related record;delivered integer:=0;at_value timestamptz;request jsonb;receipt jsonb;
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
 select coalesce(array_agg(id order by id),'{}'::uuid[]) into targets from public.order_shipments where order_id=purchase.id and status in('ready','shipping');
 if cardinality(targets)=0 then
  select * into purchase from public.orders where id=purchase.id for update;
  if purchase.status not in('confirmed','shipping') then raise check_violation using message='forced_delivery_requires_confirmed';end if;
  raise check_violation using message='forced_delivery_nothing_to_deliver';
 end if;
 -- 주문 id 순 → 배송 건 id 순으로 묶음 전체를 잠근다(운영 배송완료와 같은 잠금).
 ids:=private.lock_shipment_pack_scope(targets);
 if exists(select 1 from public.order_shipments where order_id=purchase.id and status in('ready','shipping') and id<>all(ids)) then
  raise sqlstate 'PT409' using message='shipment_pack_changed';end if;
 if exists(select 1 from public.orders o where o.id in(select order_id from public.order_shipments where id=any(ids)) and o.status not in('confirmed','shipping')) then
  raise check_violation using message='forced_delivery_requires_confirmed';end if;
 perform private.assert_order_dispatch_allowed(packed.order_id) from (select distinct order_id from public.order_shipments where id=any(ids) order by order_id) packed;
 if exists(select 1 from public.order_shipments where id=any(ids) and status in('ready','shipping') and delivery_method<>'parcel') then
  raise check_violation using message='forced_delivery_parcel_only';end if;
 at_value:=clock_timestamp();
 for shipment in select id from public.order_shipments where id=any(ids) and status in('ready','shipping') order by id loop
  perform private.assert_shipment_preorder_ready(shipment.id);
  update public.order_shipments set status='delivered',shipped_at=coalesce(shipped_at,at_value),delivered_at=at_value,updated_at=at_value where id=shipment.id;
  delivered:=delivered+1;
 end loop;
 if delivered=0 then raise check_violation using message='forced_delivery_nothing_to_deliver';end if;
 select * into purchase from public.orders where id=purchase.id;
 receipt:=jsonb_build_object('orderId',purchase.id,'orderNumber',purchase.order_number,'status',purchase.status,'deliveredShipments',delivered,
  'orderCount',(select count(distinct order_id) from public.order_shipments where id=any(ids))::integer,'deliveredAt',at_value);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.order.forced_delivered','order:'||purchase.id,
  jsonb_build_object('request',request,'result',receipt,'forced',true,'reason',reason_value,'shipmentIds',to_jsonb(ids)));
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

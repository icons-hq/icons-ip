begin;
-- 스테이징 전용 '테스트 배송완료'(구매확정·리뷰 테스트용). DB에는 자신이 운영인지 알려 주는
-- 기존 표식이 없으므로 기본 거절하고, 검증된 스테이징 세션에서만 실행되는 시드
-- (supabase/seeds/admin-ops-staging.sql, app.staging_seed_enabled 표식)가 아래 허용 행을
-- 넣는다. 운영 DB는 이 시드를 실행하지 않으므로 허용 행이 없다. 운영 프로젝트 ref가 담긴
-- 토큰도 함께 거절한다(심층 방어).
create table private.staging_test_tools (
 singleton boolean primary key default true check(singleton),
 marker text not null check(marker='admin-ops-v1'),
 enabled_at timestamptz not null default clock_timestamp()
);
alter table private.staging_test_tools enable row level security;
revoke all on private.staging_test_tools from public,anon,authenticated,service_role;

create function private.staging_test_tools_available() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.staging_test_tools where singleton and marker='admin-ops-v1')
  and position('sbutbsghcxmxmxgrshwq' in coalesce(auth.jwt()->>'iss',''))=0
  and coalesce(auth.jwt()->>'ref','')<>'sbutbsghcxmxmxgrshwq';
$$;
revoke all on function private.staging_test_tools_available() from public,anon,authenticated,service_role;

create function public.admin_staging_test_tools() returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform private.require_operator_capability('sales.manage',false);
 return jsonb_build_object('testDelivery',private.staging_test_tools_available());
end $$;
revoke all on function public.admin_staging_test_tools() from public,anon,authenticated,service_role;
grant execute on function public.admin_staging_test_tools() to authenticated;

-- 발주확인 이후 택배 주문의 남은 배송 건을 운송장 없이 배송완료로 기록한다. 발송 메일 대기열은
-- 준비 → 배송중 전이에서만 생기므로 준비 → 배송완료로 바로 옮기면 메일이 생기지 않는다.
-- 주문 상태는 기존 배송 건 집계 트리거가 파생하고, 구매확정 기한도 기존 트리거가 저장한다.
create function public.admin_mark_staging_test_delivered(p_order_number text,p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;purchase public.orders;shipment record;delivered integer:=0;at_value timestamptz;request jsonb;receipt jsonb;
begin
 actor:=private.require_operator_capability('sales.manage',false);
 if not private.staging_test_tools_available() then raise insufficient_privilege using message='staging_test_delivery_unavailable';end if;
 if p_order_number is null or p_order_number!~'^[0-9]{8}1[0-9]{7}$' or p_operation_id is null then
  raise invalid_parameter_value using message='invalid_staging_test_delivery';end if;
 request:=jsonb_build_object('orderNumber',p_order_number);
 perform pg_advisory_xact_lock(hashtextextended('staging-test-delivery:'||p_operation_id::text,0));
 receipt:=private.operator_lifecycle_replay(actor,p_operation_id,'admin.staging.test_delivered',request);
 if receipt is not null then return receipt;end if;
 select * into purchase from public.orders where order_number=p_order_number for update;
 if not found then raise no_data_found using message='order_not_found';end if;
 perform id from public.order_shipments where order_id=purchase.id order by id for update;
 if purchase.status not in ('confirmed','shipping') then raise check_violation using message='staging_test_delivery_requires_confirmed';end if;
 perform private.assert_order_dispatch_allowed(purchase.id);
 if exists(select 1 from public.order_shipments where order_id=purchase.id and status in ('ready','shipping') and delivery_method<>'parcel') then
  raise check_violation using message='staging_test_delivery_parcel_only';end if;
 at_value:=clock_timestamp();
 for shipment in select id from public.order_shipments where order_id=purchase.id and status in ('ready','shipping') order by id loop
  perform private.assert_shipment_preorder_ready(shipment.id);
  update public.order_shipments set status='delivered',shipped_at=coalesce(shipped_at,at_value),delivered_at=at_value where id=shipment.id;
  delivered:=delivered+1;
 end loop;
 if delivered=0 then raise check_violation using message='staging_test_delivery_nothing_to_deliver';end if;
 select * into purchase from public.orders where id=purchase.id;
 receipt:=jsonb_build_object('orderId',purchase.id,'orderNumber',purchase.order_number,'status',purchase.status,
  'deliveredShipments',delivered,'deliveredAt',at_value);
 insert into public.audit_log(id,actor_id,action,target,diff) values(p_operation_id,actor,'admin.staging.test_delivered','order:'||purchase.id,
  jsonb_build_object('request',request,'result',receipt,'staging',true));
 return receipt;
end $$;
revoke all on function public.admin_mark_staging_test_delivered(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_mark_staging_test_delivered(text,uuid) to authenticated;

select private.register_operator_rpc_contract('public.admin_staging_test_tools()'::regprocedure,'sales.manage','read',false);
select private.register_operator_rpc_contract('public.admin_mark_staging_test_delivered(text,uuid)'::regprocedure,'sales.manage','write',false);
commit;

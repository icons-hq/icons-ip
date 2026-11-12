\set ON_ERROR_STOP on
-- 1014-084 물류 전용 출고 권한(사용자 결정 2026-11-11 "물류 전용 출고 권한").
-- 물류출고관리는 출고지시 내려받기·운송장 회신·발송·배송완료만 하고, 다른 역할의 권한은 넓어지지도 좁아지지도 않는다.
-- 합성 계정·주문만 쓰고 끝에서 모두 되돌린다. legacy fixture 없이, 역할 설정 전(configured=false) DB에서 돈다.
begin;
do $$ begin
 if to_regclass('private.operator_legacy_fixture_control') is not null then
  raise exception 'Logistics dispatch tests must run without the legacy fixture helper';end if;
end $$;
update private.operator_access_state set configured=false,revision=1 where id;

create function pg_temp.ld_id(kind integer,n integer) returns uuid language sql immutable as $$
 select ('f5d10000-0000-'||lpad(kind::text,4,'0')||'-8000-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.ld_assert(ok boolean,label text) returns void language plpgsql as $$begin
 if ok is distinct from true then raise exception 'Logistics dispatch assertion: %',label;end if;
end $$;
-- 기대 오류는 SQLSTATE 또는 메시지로 맞춘다. 다른 오류는 그대로 올린다.
create function pg_temp.ld_error(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;
 exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error % from %',expected,statement;
end $$;
create function pg_temp.ld_as(n integer) returns void language sql as $$
 select set_config('request.jwt.claim.sub',pg_temp.ld_id(1,n)::text,true);
$$;

-- 계정: 1 통합 매니저(관리자), 2 주매니저, 3 부매니저, 4 인플루언서, 5 대행사, 6 물류출고관리,
-- 7·8 역할 설정 전 기존 직원·관리자, 9·10 구매자.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select pg_temp.ld_id(1,n),'authenticated','authenticated','logistics-dispatch-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,10) n;
update public.profiles set role=(case when right(id::text,2) in ('01','08') then 'admin' when right(id::text,2) in ('09','10') then 'user' else 'staff' end)::public.user_role,
 nickname='logistics_dispatch_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
where id::text like 'f5d10000-0000-0001-8000-%';
update public.profiles set nickname='합성물류구매자',email='ld-buyer-oracle-77@example.test' where id=pg_temp.ld_id(1,9);
insert into private.operator_memberships(profile_id,manager_role)
select pg_temp.ld_id(1,n),(array['owner','primary','deputy','influencer','agency','logistics'])[n] from generate_series(1,6) n;
insert into private.operator_legacy_cohort(profile_id,legacy_role) values(pg_temp.ld_id(1,7),'staff'),(pg_temp.ld_id(1,8),'admin');

-- A. 기존 역할은 한 글자도 바뀌지 않는다. 아래 배열은 20261020085213의 역할 정의 그대로다.
select pg_temp.ld_assert(
 private.operator_role_capabilities('owner')=array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage',
  'sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read',
  'promotion.manage','operators.manage','operators.transfer','platform.manage']
 and private.operator_role_capabilities('primary')=array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage',
  'sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read',
  'promotion.manage','operators.manage','platform.manage']
 and private.operator_role_capabilities('deputy')=array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage']
 and private.operator_role_capabilities('influencer')=array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','sales.read','sales.restrictions','stats.read']
 and private.operator_role_capabilities('agency')=array['home','catalog.read','catalog.manage','catalog.announcements','cs.manage','store.manage','seller.read','promotion.manage','stats.read'],
 'existing role capability lists are byte-identical');
select pg_temp.ld_assert(private.operator_role_capabilities('logistics')=array['home','catalog.announcements','sales.dispatch'],
 'logistics adds only the dispatch capability');
-- 역할 설정 전 운영자의 응답 목록도 그대로다(주매니저 목록, 직원은 매니저 관리 제외).
select pg_temp.ld_assert(
 (select array_agg(value order by ordinality) from jsonb_array_elements_text(private.operator_access_for(pg_temp.ld_id(1,8))->'capabilities') with ordinality)
  =private.operator_role_capabilities('primary')
 and (select array_agg(value order by ordinality) from jsonb_array_elements_text(private.operator_access_for(pg_temp.ld_id(1,7))->'capabilities') with ordinality)
  =array_remove(private.operator_role_capabilities('primary'),'operators.manage'),
 'legacy operator snapshots are unchanged');

-- 판정: sales.dispatch만 sales.manage에서 함의된다. 그 밖의 능력은 목록 그대로다.
do $$ declare actor_n integer; cap text; raw jsonb; expected boolean;
begin
 for actor_n in 1..8 loop
  raw:=private.operator_access_for(pg_temp.ld_id(1,actor_n))->'capabilities';
  foreach cap in array array['home','catalog.read','catalog.manage','catalog.announcements','sales.read','sales.manage','sales.dispatch',
   'sales.restrictions','cs.manage','store.manage','seller.read','seller.manage','marketing.manage','stats.read','promotion.manage',
   'operators.manage','operators.transfer','platform.manage'] loop
   expected:=raw ? cap or (cap='sales.dispatch' and raw ? 'sales.manage');
   if private.has_operator_capability(pg_temp.ld_id(1,actor_n),cap) is distinct from expected then
    raise exception 'capability judgement changed for actor % capability %',actor_n,cap;end if;
  end loop;
  if actor_n<>6 and private.has_operator_capability(pg_temp.ld_id(1,actor_n),'sales.dispatch')
   is distinct from private.has_operator_capability(pg_temp.ld_id(1,actor_n),'sales.manage') then
   raise exception 'existing actor % dispatch access differs from its previous sales.manage access',actor_n;end if;
 end loop;
end $$;

-- 계약: 정확히 이 27개 출고 RPC만 sales.dispatch를 쓴다(택배 외 인계·수령 기록과 그 읽기 포함).
-- 앞 22개는 T05가 sales.manage에서 옮겼고, 4개는 같은 웨이브의 새 출고 RPC를 통합 migration(20261112200000)이 맞췄다:
-- 발송처리 화면의 배송 방법·택배 외 일괄 인계(T04), ICONS 표준 양식 바코드 경고(T03), 출고지시 전 재고 차이 경고(T07).
-- 마지막 1개는 발송·배송현황 화면의 착불 요약(20261112200400, 2026-11-12 "착불 금액은 보이게")이다.
-- before_capability는 통합 전 능력이다(재고 차이 경고만 sales.read였고, 새 착불 요약은 출고 RPC와 같이 sales.manage 기준으로 본다).
create temp table ld_dispatch_contracts(signature text primary key,before_capability text not null default 'sales.manage');
insert into ld_dispatch_contracts(signature,before_capability) values
 ('public.admin_dispatch_delivery_options(uuid[])','sales.manage'),('public.admin_dispatch_apply_delivery(jsonb,text,text,jsonb,uuid)','sales.manage'),
 ('public.admin_smartstore_shipment_barcode_gaps(uuid[],uuid)','sales.manage'),('public.admin_stock_dispatch_warnings(uuid,integer)','sales.read');
insert into ld_dispatch_contracts(signature) values
 ('public.admin_search_shipments_notice_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text,text)'),
 ('public.admin_search_shipments_console(text,uuid,text,date,date,integer,integer,text,text,text,text,text)'),
 ('public.admin_shipment_pack_summaries(uuid[])'),('public.admin_shipment_production_summaries(uuid[])'),
 ('public.admin_shipment_collect_summaries(uuid[])'),
 ('public.admin_smartstore_shipment_export(uuid[])'),('public.admin_shipment_export(uuid[])'),
 ('public.admin_mark_shipments_exported(jsonb)'),('public.admin_mark_seowon_shipments_exported(jsonb,uuid,jsonb)'),
 ('public.admin_origin_pending_export_ids(uuid)'),('public.admin_shipment_barcode_gaps(uuid[],uuid)'),
 ('public.admin_origin_tracking_candidates(uuid,text[],text[])'),('public.admin_import_seowon_tracking_batch(uuid,jsonb)'),
 ('public.admin_import_warehouse_tracking_batch(uuid,jsonb)'),('public.admin_import_shipment_tracking_batch(jsonb)'),
 ('public.admin_import_item_tracking_batch(jsonb)'),('public.admin_import_shipment_tracking(text,text,text)'),
 ('public.admin_update_shipment_status(uuid,text,text,text)'),('public.admin_update_shipment_tracking(uuid,text,text)'),
 ('public.admin_complete_shipments(uuid[])'),('public.admin_enqueue_shipment_emails(jsonb)'),
 ('public.admin_read_shipment_delivery(uuid)'),('public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)');
select pg_temp.ld_assert(
 (select array_agg(signature order by signature) from private.operator_rpc_contracts where capability='sales.dispatch')
  =(select array_agg(signature order by signature) from ld_dispatch_contracts)
 and not exists(select 1 from ld_dispatch_contracts d join private.operator_rpc_contracts c using(signature) where c.guard_kind not in ('read','write') or c.legacy_admin_only)
 and (select array_agg(policy_name) from private.operator_policy_contracts where capability='sales.dispatch')=array['fulfillment_origins_dispatch_read'],
 'only the dispatch RPCs and the origin read policy use sales.dispatch');
-- 기존 역할마다 모든 RPC 계약의 허용 여부가 변경 전(출고 RPC = sales.manage)과 같다.
-- 유일한 의도된 차이: 출고지시 전 재고 차이 경고는 sales.read에서 sales.dispatch로 옮겨, sales.read만 있는 인플루언서가
-- 더는 부르지 못한다. 그 경고를 그리는 발주·발송 화면 자체가 sales.dispatch로 열려 인플루언서는 원래 볼 수 없다.
do $$ declare role_name text; caps text[]; effective text[]; contract record; before_capability text;
begin
 foreach role_name in array array['owner','primary','deputy','influencer','agency'] loop
  caps:=private.operator_role_capabilities(role_name);
  effective:=caps||case when 'sales.manage'=any(caps) then array['sales.dispatch'] else array[]::text[] end;
  for contract in select c.signature,c.capability from private.operator_rpc_contracts c loop
   before_capability:=coalesce((select d.before_capability from ld_dispatch_contracts d where d.signature=contract.signature),contract.capability);
   if (contract.capability=any(effective)) is distinct from (before_capability=any(caps))
    and not (role_name='influencer' and contract.signature='public.admin_stock_dispatch_warnings(uuid,integer)') then
    raise exception 'role % access changed for %',role_name,contract.signature;end if;
  end loop;
 end loop;
 if not 'sales.read'=any(private.operator_role_capabilities('influencer')) or 'sales.manage'=any(private.operator_role_capabilities('influencer'))
  or exists(select 1 from private.operator_rpc_contracts where signature='public.admin_stock_dispatch_warnings(uuid,integer)' and capability<>'sales.dispatch') then
  raise exception 'the only intended access change is influencer losing the dispatch-screen stock warning';end if;
end $$;
-- 물류출고관리가 닿는 주문·판매 RPC는 출고 RPC뿐이다. 발주확인·배송 방식 변경·취소·환불·클레임·고객·상품·목록 엑셀은 없다.
select pg_temp.ld_assert(
 not exists(select 1 from private.operator_rpc_contracts c where c.capability=any(private.operator_role_capabilities('logistics'))
  and c.capability not in ('home','catalog.announcements') and not exists(select 1 from ld_dispatch_contracts d where d.signature=c.signature))
 and not exists(select 1 from private.operator_rpc_contracts c join ld_dispatch_contracts d using(signature)
  where c.signature ~ '(order_status|cancellation|refund|claim|customer|goods|delivery_list|allocation|dispatch_delay|shipment_pack\(|auto_order|select_shipment_delivery_method|delivery_polic)'),
 'logistics reaches no order management, refund, claim, customer, goods or list-export RPC');
select pg_temp.ld_assert(
 (select capability from private.operator_rpc_contracts where signature='public.admin_update_order_status(uuid,public.order_status,text,text)')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_delivery_list_export_lines(uuid[])')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_upsert_order_dispatch_delay(uuid,text,date)')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_change_shipment_pack(uuid[],text,text,text,uuid,uuid,uuid)')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_record_shipment_delivery(uuid,text,jsonb,text,timestamp with time zone,uuid)')='sales.dispatch'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_read_shipment_delivery(uuid)')='sales.dispatch'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_select_shipment_delivery_method(uuid,text,uuid,text,text,boolean,timestamp with time zone,uuid)')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_list_delivery_policies(uuid)')='sales.manage'
 and (select capability from private.operator_rpc_contracts where signature='public.admin_order_item_allocation_inputs(uuid[])')='sales.read',
 'order confirmation, list export, delay memo, packing, delivery method changes and allocations keep their capability; non-parcel handover is dispatch');

-- B. 합성 주문. 1 발주확인된 김포 택배 건, 2 결제만 된 신규주문, 3 같은 구매자의 두 번째 발주확인 건, 4 남양주(서원) 건.
insert into public.ips(id,title,vertical_key) values('logistics-dispatch-ip','합성 물류 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('logistics-dispatch-good','logistics-dispatch-ip','합성 물류 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select pg_temp.ld_id(2,n),pg_temp.ld_id(1,case when n=2 then 10 else 9 end),(case when n=2 then 'paid' else 'confirmed' end)::public.order_status,5000,3000,
 jsonb_build_object('recipientName','합성수령인'||n,'phone','0101234567'||n,'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote','문 앞'),
 case when n=2 then null else now() end
from generate_series(1,4) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select pg_temp.ld_id(3,n),pg_temp.ld_id(2,n),'logistics-dispatch-good',v.id,1,1000,'합성 물류 상품','문구','logistics-dispatch-ip'
from generate_series(1,4) n cross join (select id from public.goods_variants where good_id='logistics-dispatch-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
select pg_temp.ld_id(4,n),pg_temp.ld_id(2,n),
 case when n=4 then '00000000-0000-4000-8000-000000042202'::uuid else '00000000-0000-4000-8000-000000042201'::uuid end,
 case when n=4 then '남양주' else '김포' end,3000,'{}'
from generate_series(1,4) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select pg_temp.ld_id(2,n),pg_temp.ld_id(4,n),pg_temp.ld_id(3,n),1 from generate_series(1,4) n;

-- C. 물류출고관리의 출고 흐름.
-- 사용자 결정(2026-11-11) "수령인 정보만": 주문 조회 권한이 있는 주매니저의 목록·표준 양식 자료는 지금과 같고,
-- 물류출고관리에게는 구매자·주문 총액·결제수단·결제일·품목 금액·선결제 배송비가 비어 온다(착불 배송비·착불 수납 정보는 보인다, 2026-11-12 결정).
set local role authenticated;
select pg_temp.ld_as(2);
select public.admin_search_shipments_notice_console('ready',p_query=>'합성수령인1',p_field=>'recipient') as manager_ready \gset
select public.admin_search_shipments_console('ready',p_query=>'합성수령인1',p_field=>'recipient') as manager_shipping \gset
select public.admin_smartstore_shipment_export(array[pg_temp.ld_id(4,1)]) as manager_export \gset
select pg_temp.ld_assert(:'manager_ready'::jsonb#>>'{rows,0,buyerName}'='합성물류구매자' and :'manager_ready'::jsonb#>>'{rows,0,total}'='5000'
 and :'manager_ready'::jsonb#>>'{rows,0,paymentMethod}'='card' and :'manager_ready'::jsonb#>>'{rows,0,shippingFee}'='3000'
 and :'manager_shipping'::jsonb#>>'{rows,0,buyerName}'='합성물류구매자' and :'manager_shipping'::jsonb#>>'{rows,0,total}'='5000'
 and :'manager_export'::jsonb#>>'{shipments,0,lines,0,smartstore,buyerName}'='합성물류구매자'
 and :'manager_export'::jsonb#>>'{shipments,0,lines,0,smartstore,buyerId}'=pg_temp.ld_id(1,9)::text
 and :'manager_export'::jsonb#>>'{shipments,0,lines,0,smartstore,paymentMethod}'='card'
 and :'manager_export'::jsonb#>>'{shipments,0,lines,0,smartstore,itemTotal}'='1000'
 and :'manager_export'::jsonb#>>'{shipments,0,shippingFee}'='3000' and :'manager_export'::jsonb#>>'{shipments,0,lines,0,unitPrice}'='1000',
 'primary keeps buyer, totals, payment and item amounts in lists and the standard export');
select pg_temp.ld_assert((public.admin_search_shipments_notice_console('ready',p_query=>'합성물류구매자',p_field=>'buyer')->>'total')='3'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'ld-buyer-oracle-77',p_field=>'buyer')->>'total')='3'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment',p_payment_method=>'bank_transfer')->>'total')='0'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment',p_date_field=>'paid',p_from=>(now() at time zone 'Asia/Seoul')::date)->>'total')='0',
 'primary keeps buyer search, payment filter and payment-date filter');
select pg_temp.ld_as(6);
select pg_temp.ld_assert(public.admin_current_operator_access()->>'managerRole'='logistics'
 and public.admin_current_operator_access()->'capabilities'='["home","catalog.announcements","sales.dispatch"]'::jsonb,'logistics snapshot');
-- 회신 대조에 필요한 출고지 설정은 읽고, 주문·결제·고객 원본은 직접 읽지 못한다.
select pg_temp.ld_assert((select count(*) from public.fulfillment_origins where id in('00000000-0000-4000-8000-000000042201','00000000-0000-4000-8000-000000042202'))=2,'origin settings readable for dispatch');
select pg_temp.ld_assert((select count(*) from public.orders where id::text like 'f5d10000-0000-0002-%')=0
 and (select count(*) from public.order_items where id::text like 'f5d10000-0000-0003-%')=0
 and (select count(*) from public.order_shipments where id::text like 'f5d10000-0000-0004-%')=0
 and (select count(*) from public.profiles where id=pg_temp.ld_id(1,9))=0,'raw order, item, shipment and buyer rows stay hidden');
-- 발송 처리 목록: 수령인과 상품은 보이고, 구매자·금액·결제는 비어 있다. 구매자로 찾거나 결제로 거르거나 금액으로 정렬하지 못한다.
select public.admin_search_shipments_notice_console('ready',p_query=>'합성수령인1',p_field=>'recipient') as ready_page \gset
select public.admin_search_shipments_console('ready',p_query=>'합성수령인1',p_field=>'recipient') as shipping_page \gset
select pg_temp.ld_assert((:'ready_page'::jsonb->>'total')='1' and :'ready_page'::jsonb#>>'{rows,0,recipientName}'='합성수령인1'
 and :'ready_page'::jsonb#>>'{rows,0,items,0,name}'='합성 물류 상품'
 and :'ready_page'::jsonb#>'{rows,0}' @> '{"buyerName":null,"total":null,"paymentMethod":null,"shippingFee":null}'::jsonb
 and :'shipping_page'::jsonb#>>'{rows,0,recipientName}'='합성수령인1'
 and :'shipping_page'::jsonb#>'{rows,0}' @> '{"buyerName":null,"total":null,"paymentMethod":null,"shippingFee":null}'::jsonb
 and (:'ready_page'::jsonb - 'rows')=(:'manager_ready'::jsonb - 'rows')
 and ((:'ready_page'::jsonb#>'{rows,0}') - array['buyerName','total','paymentMethod','shippingFee'])=((:'manager_ready'::jsonb#>'{rows,0}') - array['buyerName','total','paymentMethod','shippingFee']),
 'dispatch lists show recipient and items, and blank only buyer, totals, payment and shipping fee');
select pg_temp.ld_assert((public.admin_search_shipments_notice_console('new',p_query=>'합성수령인2',p_field=>'recipient')->>'total')='1','new orders are visible to plan dispatch');
select pg_temp.ld_assert((public.admin_search_shipments_notice_console('ready',p_query=>'ld-buyer-oracle-77',p_field=>'buyer')->>'total')='0'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'ld-buyer-oracle-77',p_field=>'all')->>'total')='0'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'합성물류구매자',p_field=>'buyer')->>'total')='0'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'합성물류구매자',p_field=>'all')->>'total')='0'
 and (public.admin_search_shipments_console('ready',p_query=>'합성물류구매자',p_field=>'buyer')->>'total')='0'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment',p_payment_method=>'bank_transfer')->>'total')='3'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment',p_date_field=>'paid',p_from=>(now() at time zone 'Asia/Seoul')::date)->>'total')='3'
 and (public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment',p_sort=>'amount_high')->>'total')='3',
 'buyer, payment and amount are not search, filter or sort oracles for dispatch-only operators');
select public.admin_smartstore_shipment_export(array[pg_temp.ld_id(4,1)]) as logistics_export \gset
select pg_temp.ld_assert(:'logistics_export'::jsonb#>'{shipments,0,lines,0,smartstore}' @> '{"buyerName":null,"buyerId":null,"paidAt":null,"paymentMethod":null,
 "productPrice":null,"optionPrice":null,"itemTotal":null,"itemDiscount":null,"sellerDiscount":null,"regionalShippingFee":null,"shippingDiscount":null}'::jsonb
 and :'logistics_export'::jsonb#>>'{shipments,0,lines,0,recipient}'='합성수령인1'
 and :'logistics_export'::jsonb#>>'{shipments,0,lines,0,smartstore,orderNumber}'=:'manager_export'::jsonb#>>'{shipments,0,lines,0,smartstore,orderNumber}'
 and (:'logistics_export'::jsonb#>'{shipments,0,lines,0}')-'smartstore'=(:'manager_export'::jsonb#>'{shipments,0,lines,0}')-'smartstore'
 -- 배송 건의 착불 배송비·착불 수납 정보는 DB가 비우지 않는다(사용자 결정 2026-11-12 "착불 금액은 보이게"). 선결제 배송비는 표준 양식 파일에서 앱이 비운다.
 and :'logistics_export'::jsonb#>'{shipments,0,shippingCollectFee}' is not null
 and :'logistics_export'::jsonb#>'{shipments,0,shippingCollectFee}'=:'manager_export'::jsonb#>'{shipments,0,shippingCollectFee}'
 and (:'logistics_export'::jsonb#>'{shipments,0,collector}') is not distinct from (:'manager_export'::jsonb#>'{shipments,0,collector}'),
 'standard export detail blanks buyer, payment and item amounts for dispatch-only operators');
-- 발주확인은 하지 못하고, 발주확인 전 주문은 내보내지 못한다.
select pg_temp.ld_error(format('select public.admin_update_order_status(%L,%L,null,null)',pg_temp.ld_id(2,2),'confirmed'),'42501');
select pg_temp.ld_error(format('select public.admin_shipment_export(array[%L]::uuid[])',pg_temp.ld_id(4,2)),'shipment_not_ready');
-- 출고지시 내려받기: 표준·창고 양식 자료, 바코드 공백 경고, 제작·합포장 요약, 출고지별 대기 건.
select pg_temp.ld_assert(jsonb_array_length(public.admin_smartstore_shipment_export(array[pg_temp.ld_id(4,1)])->'shipments')=1
 and public.admin_shipment_export(array[pg_temp.ld_id(4,1)])#>>'{shipments,0,lines,0,recipient}'='합성수령인1'
 and public.admin_shipment_barcode_gaps(array[pg_temp.ld_id(4,1)],null)>=0
 and public.admin_shipment_pack_summaries(array[pg_temp.ld_id(4,1)]) ? pg_temp.ld_id(4,1)::text
 and public.admin_shipment_production_summaries(array[pg_temp.ld_id(4,1)]) ? pg_temp.ld_id(4,1)::text
 and public.admin_origin_pending_export_ids('00000000-0000-4000-8000-000000042201')->'ids' ? pg_temp.ld_id(4,1)::text,'instruction export reads');
-- 같은 웨이브의 새 출고 읽기도 출고 권한으로 열린다(통합 migration 20261112200000): ICONS 표준 양식 바코드 경고(T03),
-- 출고지시 전 재고 차이 경고(T07), 발송처리 화면의 배송 방법 팝업 자료(T04).
select pg_temp.ld_assert(public.admin_smartstore_shipment_barcode_gaps(array[pg_temp.ld_id(4,1)],null)>=0
 and jsonb_typeof(public.admin_stock_dispatch_warnings(null))='object'
 and jsonb_array_length(public.admin_dispatch_delivery_options(array[pg_temp.ld_id(4,1)])->'shipments')=1,'same-wave dispatch reads');
select jsonb_agg(jsonb_build_object('id',row_value->>'id','updatedAt',row_value->>'updatedAt')) as gimpo_versions
from jsonb_array_elements(public.admin_search_shipments_notice_console('ready',p_query=>'f5d10000-0000-0004',p_field=>'shipment')->'rows') row_value
where (row_value->>'id')::uuid in (pg_temp.ld_id(4,1),pg_temp.ld_id(4,3)) \gset
select pg_temp.ld_assert(public.admin_mark_shipments_exported(:'gimpo_versions')=2,'instruction handover recorded');
select jsonb_build_array(jsonb_build_object('id',row_value->>'id','updatedAt',row_value->>'updatedAt')) as seowon_versions
from jsonb_array_elements(public.admin_search_shipments_notice_console('ready',p_query=>'합성수령인4',p_field=>'recipient')->'rows') row_value \gset
select pg_temp.ld_assert(public.admin_mark_seowon_shipments_exported(:'seowon_versions',pg_temp.ld_id(5,1),
 jsonb_build_array(jsonb_build_object('shipmentId',pg_temp.ld_id(4,4),'suffix','')))=1,'seowon handover recorded');
-- 송장 회신 업로드: 회신 대조 후보, 일반·상품주문번호·서원 회신. 발송 안내 메일 대기열까지 같은 권한이다.
select pg_temp.ld_assert(public.admin_origin_tracking_candidates('00000000-0000-4000-8000-000000042202','{}',array['01012345674'])#>>'{shipments,0,id}'=pg_temp.ld_id(4,4)::text,'reply candidates');
select public.admin_import_shipment_tracking_batch(jsonb_build_array(jsonb_build_object('line',1,'reference',pg_temp.ld_id(4,1)::text,'carrier','hanjin','trackingNumber','LD100000001'))) as reply_one \gset
select pg_temp.ld_assert(:'reply_one'::jsonb#>>'{0,ok}'='true' and :'reply_one'::jsonb#>>'{0,dispatched}'='true','generic reply dispatches');
reset role;
select (select product_order_number from public.order_items where id=pg_temp.ld_id(3,3)) as item_number \gset
set local role authenticated;
select pg_temp.ld_as(6);
select public.admin_import_item_tracking_batch(jsonb_build_array(jsonb_build_object('line',1,'reference',:'item_number','carrier','hanjin','trackingNumber','LD100000003'))) as reply_three \gset
select pg_temp.ld_assert(:'reply_three'::jsonb#>>'{0,ok}'='true','ICONS standard reply dispatches by product order number');
select public.admin_import_seowon_tracking_batch('00000000-0000-4000-8000-000000042202',
 jsonb_build_array(jsonb_build_object('line',1,'reference',pg_temp.ld_id(4,4)::text,'carrier','epost','trackingNumber','LD100000004'))) as reply_four \gset
select pg_temp.ld_assert(:'reply_four'::jsonb#>>'{0,ok}'='true','seowon reply dispatches');
select pg_temp.ld_assert((public.admin_enqueue_shipment_emails(jsonb_build_array(jsonb_build_object('orderId',pg_temp.ld_id(2,1)::text,'shipmentId',pg_temp.ld_id(4,1)::text)))->>'queued')='1','shipped email queued');
-- 운송장 정정과 배송완료.
select public.admin_update_shipment_tracking(pg_temp.ld_id(4,3),'hanjin','LD100000033');
select public.admin_complete_shipments(array[pg_temp.ld_id(4,1)]) as completed \gset
select pg_temp.ld_assert(:'completed'::jsonb#>>'{0,ok}'='true','delivery completed');
select pg_temp.ld_assert((public.admin_search_shipments_console('transit',p_query=>'합성수령인3',p_field=>'recipient')->>'total')='1'
 and (public.admin_search_shipments_console('delivered',p_query=>'합성수령인1',p_field=>'recipient')->>'total')='1'
 and (public.admin_search_shipments_console('transit',p_query=>'ld-buyer-oracle-77',p_field=>'buyer')->>'total')='0','shipping list reads');
-- 출고 외 업무는 거절한다: 목록 엑셀, 금액 배분, 주문 검색·상세, 고객 이력, 취소, 지연 메모, 합포장, 자동 발주확인, 배송 방식 변경·정책 목록.
select pg_temp.ld_error(format('select public.admin_delivery_list_export_lines(array[%L]::uuid[])',pg_temp.ld_id(4,1)),'42501');
select pg_temp.ld_error(format('select public.admin_order_item_allocation_inputs(array[%L]::uuid[])',pg_temp.ld_id(2,1)),'42501');
select pg_temp.ld_error('select public.admin_search_orders_console()','42501');
select pg_temp.ld_error(format('select public.admin_operator_customer_history(%L,%L,1)',pg_temp.ld_id(1,9),'orders'),'42501');
select pg_temp.ld_error(format('select public.admin_start_order_cancellation(%L,%L,null,false)',pg_temp.ld_id(2,3),'out_of_stock'),'42501');
select pg_temp.ld_error(format('select public.admin_upsert_order_dispatch_delay(%L,%L,null)',pg_temp.ld_id(2,3),'합성 지연'),'42501');
select pg_temp.ld_error('select public.admin_change_shipment_pack(null,null,null,null,null,null,null)','42501');
select pg_temp.ld_error('select public.admin_get_auto_order_confirmation()','42501');
select pg_temp.ld_error('select public.admin_select_shipment_delivery_method(null,null,null,null,null,null,null,null)','42501');
select pg_temp.ld_error('select public.admin_list_delivery_policies(''00000000-0000-4000-8000-000000042201'')','42501');
select pg_temp.ld_error(format('select public.admin_update_order_tracking(%L,%L,%L)',pg_temp.ld_id(2,3),'hanjin','LD100000039'),'42501');
reset role;
select pg_temp.ld_assert((select status from public.order_shipments where id=pg_temp.ld_id(4,1))='delivered'
 and (select status from public.order_shipments where id=pg_temp.ld_id(4,3))='shipping'
 and (select tracking_number from public.order_shipments where id=pg_temp.ld_id(4,3))='LD100000033'
 and (select status from public.order_shipments where id=pg_temp.ld_id(4,4))='shipping'
 and (select status from public.orders where id=pg_temp.ld_id(2,2))='paid'
 and (select count(*) from public.audit_log where actor_id=pg_temp.ld_id(1,6) and action in ('admin.shipment.exported','admin.shipment.status_updated','admin.shipment.tracking_updated'))>=7,
 'dispatch changes are audited and the unconfirmed order is untouched');

-- 판정 함수는 주문 조회 권한이 있으면 응답을 그대로 돌려주고, 판정이 비면 닫힌 쪽(비움)으로 간다. 클라이언트는 직접 부르지 못한다.
select set_config('request.jwt.claim.sub',pg_temp.ld_id(1,2)::text,true);
select pg_temp.ld_assert(private.shipment_console_for_reader(:'manager_ready'::jsonb)=:'manager_ready'::jsonb
 and private.shipment_export_detail_for_reader('{"buyerName":"x","itemTotal":1,"orderNumber":"n"}'::jsonb,true)='{"buyerName":"x","itemTotal":1,"orderNumber":"n"}'::jsonb
 and private.shipment_export_detail_for_reader('{"buyerName":"x","itemTotal":1,"orderNumber":"n"}'::jsonb,null)@>'{"buyerName":null,"itemTotal":null,"orderNumber":"n"}'::jsonb
 and not has_function_privilege('authenticated','private.shipment_console_for_reader(jsonb)','execute')
 and not has_function_privilege('authenticated','private.shipment_export_detail_for_reader(jsonb,boolean)','execute'),
 'reader helpers keep order readers unchanged, fail closed and stay sealed');
select set_config('request.jwt.claim.sub','',true);

-- C-2. 택배 외 배송도 발송·배송완료다. 물류출고관리는 주문 상세 없이 퀵 인계와 수령 완료를 기록하고,
-- 배송 방식 변경 자료(출고지 정책 목록, 고객 요청·배송비 동의 근거)는 받지 않는다.
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,return_address,is_active)
 values(pg_temp.ld_id(8,1),'ld-quick-origin','합성 퀵 출고지','hanjin',1000,null,'합성 반송 주소',true);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at) values(pg_temp.ld_id(2,5),pg_temp.ld_id(1,9),'confirmed',5000,3000,
 '{"recipientName":"합성수령인5","phone":"01012345675","postalCode":"00123","address1":"합성 주소","address2":"5층","deliveryNote":"문 앞"}',now());
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ld_id(3,5),pg_temp.ld_id(2,5),'logistics-dispatch-good',id,1,1000,'합성 물류 상품','문구','logistics-dispatch-ip'
 from public.goods_variants where good_id='logistics-dispatch-good' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
 values(pg_temp.ld_id(4,5),pg_temp.ld_id(2,5),pg_temp.ld_id(8,1),'합성 퀵 출고지',3000,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(pg_temp.ld_id(2,5),pg_temp.ld_id(4,5),pg_temp.ld_id(3,5),1);
select updated_at as quick_version from public.order_shipments where id=pg_temp.ld_id(4,5) \gset
set local role authenticated;
select pg_temp.ld_as(2);
select public.admin_save_delivery_policy(pg_temp.ld_id(8,1),'quick',null,jsonb_build_object('state','active','contactName','합성 운영 담당',
 'contactPhone','02-0000-0000','handoffLocation','합성 인계 장소','handoffInstructions','합성 인계 안내','appointmentInstructions','합성 예약 안내',
 'allowDelegate',false,'completionInstructions','합성 수령 기록','cancellationInstructions','합성 취소 안내','approvalReference','합성 운영 승인'),null)->>'id' as quick_policy \gset
select public.admin_select_shipment_delivery_method(pg_temp.ld_id(4,5),'quick',:'quick_policy','합성 고객 요청 메모 010-0000-0005','합성 배송비 유지 동의',true,
 :'quick_version',pg_temp.ld_id(9,1));
select public.admin_read_shipment_delivery(pg_temp.ld_id(4,5)) as manager_view \gset
select pg_temp.ld_assert(jsonb_array_length(:'manager_view'::jsonb->'policies')=1 and :'manager_view'::jsonb->>'shippingFee'='3000'
 and :'manager_view'::jsonb#>>'{history,0,evidence,customerRequestReference}'='합성 고객 요청 메모 010-0000-0005','sales managers keep method-change material');
select pg_temp.ld_as(6);
select public.admin_read_shipment_delivery(pg_temp.ld_id(4,5)) as logistics_view \gset
select pg_temp.ld_assert(:'logistics_view'::jsonb->'policies'='[]'::jsonb and :'logistics_view'::jsonb->'shippingFee'='null'::jsonb
 and not (:'logistics_view'::jsonb#>'{history,0,evidence}' ?| array['customerRequestReference','feeConsentReference'])
 -- 방식 변경 이력의 선결제 배송비·주문 총액도 비운다(통합 migration 20261112200200, 수령인 정보만).
 and not (:'logistics_view'::jsonb#>'{history,0,evidence}' ?| array['shippingFee','orderTotal'])
 and (:'manager_view'::jsonb#>'{history,0,evidence}' ?& array['shippingFee','orderTotal'])
 and :'logistics_view'::jsonb#>>'{history,0,evidence,toMethod}'='quick'
 and :'logistics_view'::jsonb#>>'{summary,method}'='quick' and :'logistics_view'::jsonb#>>'{summary,policy,handoffLocation}'='합성 인계 장소'
 and (:'logistics_view'::jsonb->>'canTransition')::boolean,'dispatch-only operators read handoff conditions without method-change material');
select pg_temp.ld_error(format('select public.admin_select_shipment_delivery_method(%L,%L,%L,%L,%L,true,%L,%L)',pg_temp.ld_id(4,5),'parcel',null,'요청','동의',
 :'logistics_view'::jsonb->>'updatedAt',pg_temp.ld_id(9,2)),'42501');
select public.admin_record_shipment_delivery(pg_temp.ld_id(4,5),'quick_handoff',jsonb_build_object('operatorName','합성 물류 담당','providerName','합성 퀵 업체',
 'providerPhone','010-0000-0000','handoffReference','합성 퀵 인계','occurredAt',clock_timestamp()),null,(:'logistics_view'::jsonb->>'updatedAt')::timestamptz,pg_temp.ld_id(9,3)) as handoff \gset
select pg_temp.ld_assert(:'handoff'::jsonb->>'ok'='true','logistics records the non-parcel handoff');
select pg_temp.ld_as(9);
select public.issue_shipment_receipt_confirmation(pg_temp.ld_id(4,5))->>'code' as receipt_code \gset
select pg_temp.ld_as(6);
select public.admin_read_shipment_delivery(pg_temp.ld_id(4,5))->>'updatedAt' as in_transit_version \gset
select public.admin_record_shipment_delivery(pg_temp.ld_id(4,5),'quick_receive',jsonb_build_object('operatorName','합성 물류 담당','receiptReference','합성 퀵 수령',
 'recipientKind','self','occurredAt',clock_timestamp()),:'receipt_code',:'in_transit_version',pg_temp.ld_id(9,4)) as receipt \gset
select pg_temp.ld_assert(:'receipt'::jsonb->>'ok'='true','logistics records the non-parcel receipt');
-- 출고 업무가 없는 매니저는 전처럼 읽지도 기록하지도 못한다.
select pg_temp.ld_as(3);
select pg_temp.ld_error(format('select public.admin_read_shipment_delivery(%L)',pg_temp.ld_id(4,5)),'42501');
select pg_temp.ld_error('select public.admin_record_shipment_delivery(null,null,null,null,null,null)','42501');
reset role;
select pg_temp.ld_assert((select status='delivered' and delivery_method='quick' and shipped_at is not null and delivered_at is not null
  from public.order_shipments where id=pg_temp.ld_id(4,5))
 and (select count(*) from public.audit_log where actor_id=pg_temp.ld_id(1,6) and action='admin.shipment.delivery_evidence_recorded')=2,
 'non-parcel handoff and receipt are recorded as the logistics operator');

-- D. 다른 역할의 출고 화면 접근은 변경 전과 같다.
set local role authenticated;
-- 주매니저는 그대로 처리하고, 주문 조회 권한이 있어 구매자 이메일 검색도 그대로다.
select pg_temp.ld_as(2);
select pg_temp.ld_assert((public.admin_search_shipments_notice_console('transit',p_query=>'ld-buyer-oracle-77',p_field=>'buyer')->>'total')='2'
 and (public.admin_search_shipments_console('transit',p_query=>'ld-buyer-oracle-77',p_field=>'buyer')->>'total')='2'
 and (select count(*) from public.fulfillment_origins where id='00000000-0000-4000-8000-000000042201')=1,'primary keeps buyer email search and origin settings');
select pg_temp.ld_assert(jsonb_array_length(public.admin_origin_pending_export_ids('00000000-0000-4000-8000-000000042201')->'ids')>=0,'primary keeps dispatch reads');
-- 역할 설정 전 직원도 같다.
select pg_temp.ld_as(7);
select pg_temp.ld_assert((public.admin_search_shipments_console('transit',p_query=>'합성수령인3',p_field=>'recipient')->>'total')='1','legacy staff keeps dispatch');
-- 부매니저·인플루언서·대행사는 전처럼 출고 화면을 쓰지 못하고 출고지 설정도 보지 못한다.
do $$ declare actor_n integer;
begin
 foreach actor_n in array array[3,4,5] loop
  perform pg_temp.ld_as(actor_n);
  perform pg_temp.ld_error('select public.admin_search_shipments_notice_console(''ready'')','42501');
  perform pg_temp.ld_error('select public.admin_search_shipments_console(''transit'')','42501');
  perform pg_temp.ld_error(format('select public.admin_complete_shipments(array[%L]::uuid[])',pg_temp.ld_id(4,3)),'42501');
  if (select count(*) from public.fulfillment_origins)<>0 then raise exception 'actor % reads origin settings',actor_n;end if;
 end loop;
end $$;
reset role;

-- E. 매니저 초대 화면에서 물류출고관리를 고르고, 수락하면 출고 전용 권한이 적용된다.
update private.operator_access_state set configured=true,revision=revision+1 where id;
delete from private.operator_memberships where profile_id=pg_temp.ld_id(1,6);
set constraints private.operator_owner_membership_invariant,private.operator_owner_setup_invariant immediate;
select revision as access_revision from private.operator_access_state where id \gset
set local role authenticated;
select pg_temp.ld_as(1);
select public.admin_create_operator_invitations(jsonb_build_array(jsonb_build_object('id',pg_temp.ld_id(6,1),'email','logistics-dispatch-6@example.test',
 'name','합성 물류 담당','managerRole','logistics','duty','logistics','tokenHash',encode(extensions.digest('ld-synthetic-token','sha256'),'hex'),
 'sourceDigest',encode(extensions.digest('ld-synthetic-source','sha256'),'hex'),'recipientDigest',encode(extensions.digest('ld-synthetic-recipient','sha256'),'hex'))),
 :access_revision,pg_temp.ld_id(7,1));
select pg_temp.ld_as(6);
select public.accept_operator_invitation(encode(extensions.digest('ld-synthetic-token','sha256'),'hex'),pg_temp.ld_id(7,2));
select pg_temp.ld_assert(public.admin_current_operator_access()->>'managerRole'='logistics'
 and public.has_operator_capability('sales.dispatch') and not public.has_operator_capability('sales.manage'),'invited logistics manager receives dispatch-only access');
reset role;

-- F. 합포장 요약의 묶음 착불 합계는 물류출고관리에게도 그대로 온다(사용자 결정 2026-11-12 "착불 금액은 보이게",
--    통합 migration 20261112200100). 창고가 수령인에게 받을 금액이라 출고에 필요한 정보다.
update public.order_shipments set shipping_collect_fee=4000 where id=pg_temp.ld_id(4,3);
insert into private.shipment_packs(id,created_by) values(pg_temp.ld_id(10,1),pg_temp.ld_id(1,2));
insert into private.shipment_pack_members(pack_id,shipment_id,identity_digest)
 values(pg_temp.ld_id(10,1),pg_temp.ld_id(4,1),'synthetic'),(pg_temp.ld_id(10,1),pg_temp.ld_id(4,3),'synthetic');
set local role authenticated;
select pg_temp.ld_as(2);
select public.admin_shipment_pack_summaries(array[pg_temp.ld_id(4,1),pg_temp.ld_id(4,4)]) as manager_packs \gset
select pg_temp.ld_as(6);
select public.admin_shipment_pack_summaries(array[pg_temp.ld_id(4,1),pg_temp.ld_id(4,4)]) as logistics_packs \gset
select pg_temp.ld_assert((:'manager_packs'::jsonb#>>array[pg_temp.ld_id(4,1)::text,'collectFee'])='4000'
 and (:'logistics_packs'::jsonb#>>array[pg_temp.ld_id(4,1)::text,'collectFee'])='4000'
 and :'logistics_packs'::jsonb=:'manager_packs'::jsonb
 and :'logistics_packs'::jsonb->pg_temp.ld_id(4,4)::text='null'::jsonb,'pack collect total is visible to dispatch-only operators');reset role;

-- G. 발송·배송현황 화면의 착불 요약(20261112200400): 배송 건별 착불 배송비와 착불 수납 정보도 물류출고관리에게 주매니저와 같게 온다
--    (사용자 결정 2026-11-12 "착불 금액은 보이게"는 화면에도 적용). 출처는 출고지시 파일과 같다(배송 건 착불 배송비, 주문 영수증의
--    그 출고지 묶음 collector). 착불이 없으면 null, 선결제 배송비는 담지 않는다. 읽기 전용이고 합포장 관리는 sales.manage 그대로다.
insert into private.order_goods_transactions(order_id,actor_id,source_kind,source_id,source_revision,quote_id,checkout_key,request_digest,request_salt,original_receipt)
values(pg_temp.ld_id(2,3),pg_temp.ld_id(1,9),'cart',pg_temp.ld_id(11,1),'synthetic',pg_temp.ld_id(11,2),pg_temp.ld_id(11,3),'synthetic',pg_temp.ld_id(11,4),
 jsonb_build_object('display',jsonb_build_object('shipping',jsonb_build_array(
  jsonb_build_object('originId','00000000-0000-4000-8000-000000042202','collector',jsonb_build_object('name','다른 출고지 수납','method','다른 방법','refundContact','다른 문의처','instructions','다른 안내')),
  jsonb_build_object('originId','00000000-0000-4000-8000-000000042201','collector',jsonb_build_object('name','합성 택배사','method','수령 시 기사에게 현금',
   'refundContact','합성 고객센터','instructions','착불 배송비는 수령 때 지급합니다.'))))));
insert into private.order_goods_transactions(order_id,actor_id,source_kind,source_id,source_revision,quote_id,checkout_key,request_digest,request_salt,original_receipt)
values(pg_temp.ld_id(2,4),pg_temp.ld_id(1,9),'cart',pg_temp.ld_id(11,5),'synthetic',pg_temp.ld_id(11,6),pg_temp.ld_id(11,7),'synthetic',pg_temp.ld_id(11,8),'{"display":{"shipping":{}}}');
update public.order_shipments set shipping_collect_fee=2500 where id=pg_temp.ld_id(4,4);
set local role authenticated;
select pg_temp.ld_as(2);
select public.admin_shipment_collect_summaries(array[pg_temp.ld_id(4,1),pg_temp.ld_id(4,3),pg_temp.ld_id(4,4)]) as manager_collect \gset
select pg_temp.ld_as(6);
select public.admin_shipment_collect_summaries(array[pg_temp.ld_id(4,1),pg_temp.ld_id(4,3),pg_temp.ld_id(4,4)]) as logistics_collect \gset
select pg_temp.ld_assert(:'logistics_collect'::jsonb=:'manager_collect'::jsonb
 and :'logistics_collect'::jsonb->pg_temp.ld_id(4,1)::text='null'::jsonb
 and :'logistics_collect'::jsonb->pg_temp.ld_id(4,3)::text=jsonb_build_object('collectFee',4000,'collector',jsonb_build_object('name','합성 택배사',
   'method','수령 시 기사에게 현금','refundContact','합성 고객센터','instructions','착불 배송비는 수령 때 지급합니다.'))
 -- 영수증 모양이 배열이 아니면 금액만 보이고 수납 정보는 null이다(목록을 깨지 않는다).
 and :'logistics_collect'::jsonb->pg_temp.ld_id(4,4)::text='{"collectFee":2500,"collector":null}'::jsonb
 and not (:'logistics_collect'::jsonb)::text ~ '"(shippingFee|total|buyerName|paymentMethod)"',
 'per-shipment collect fee and collection terms are visible on the dispatch screen to dispatch-only operators');
select pg_temp.ld_error('select public.admin_shipment_collect_summaries(array[]::uuid[])','22023');
-- 출고 권한이 없는 역할(부매니저)은 읽지 못한다.
select pg_temp.ld_as(3);
select pg_temp.ld_error(format('select public.admin_shipment_collect_summaries(array[%L]::uuid[])',pg_temp.ld_id(4,3)),'42501');
reset role;
rollback;

\set ON_ERROR_STOP on
-- 결제 전 주문 내용 확인·구매 조건 동의 기록(원장 PAY-015, 트랙 H) — 봉인·멱등·남의 주문 거절·제한 굿즈 스냅샷·운영자 읽기 권한.
-- 데이터는 끝에서 rollback 한다.
begin;
create function pg_temp.ack_id(kind text,n integer) returns uuid language sql immutable as $$
 select (substr(md5('order-purchase-ack:'||kind),1,8)||'-2222-4222-8222-'||lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.ack_assert(condition boolean,label text) returns void language plpgsql as $$begin
 if condition is distinct from true then raise exception 'Assertion failed: %',label;end if;
end $$;
create function pg_temp.ack_expect(statement text,expected text) returns void language plpgsql as $$begin
 begin execute statement;exception when others then if sqlstate=expected or sqlerrm=expected then return;end if;raise;end;
 raise exception 'Expected error: %',expected;
end $$;

-- ── 봉인(선언) ─────────────────────────────────────────────────────────
select pg_temp.ack_assert(
  has_function_privilege('service_role','public.record_order_purchase_acknowledgement(uuid,uuid,text,jsonb)','execute')
  and not has_function_privilege('authenticated','public.record_order_purchase_acknowledgement(uuid,uuid,text,jsonb)','execute')
  and not has_function_privilege('anon','public.record_order_purchase_acknowledgement(uuid,uuid,text,jsonb)','execute')
  and not has_function_privilege('public','public.record_order_purchase_acknowledgement(uuid,uuid,text,jsonb)','execute'),
  'record rpc is service_role only');
select pg_temp.ack_assert(
  has_function_privilege('authenticated','public.admin_order_purchase_acknowledgement(uuid)','execute')
  and not has_function_privilege('anon','public.admin_order_purchase_acknowledgement(uuid)','execute')
  and not has_function_privilege('service_role','public.admin_order_purchase_acknowledgement(uuid)','execute')
  and not has_function_privilege('public','public.admin_order_purchase_acknowledgement(uuid)','execute'),
  'admin reader is authenticated only');
select pg_temp.ack_assert(
  (select relrowsecurity from pg_class where oid='private.order_purchase_acknowledgements'::regclass)
  and not has_table_privilege('authenticated','private.order_purchase_acknowledgements','select,insert,update,delete')
  and not has_table_privilege('anon','private.order_purchase_acknowledgements','select,insert,update,delete')
  and not has_table_privilege('service_role','private.order_purchase_acknowledgements','select,insert,update,delete'),
  'table sealed');

-- ── 픽스처 ─────────────────────────────────────────────────────────────
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select pg_temp.ack_id('actor',n),'authenticated','authenticated','order-purchase-ack-'||n||'@example.test',now(),'{}','{}'
 from generate_series(1,3)n;
update public.profiles set role='staff' where id=pg_temp.ack_id('actor',3);
insert into private.operator_memberships(profile_id,manager_role) values(pg_temp.ack_id('actor',3),'primary');
insert into public.ips(id,title,vertical_key) values('order-purchase-ack-ip','동의 기록 합성 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty)
 values('order-purchase-ack-free','order-purchase-ack-ip','제한 없는 상품','문구',1000,'ok',100),
        ('order-purchase-ack-limited','order-purchase-ack-ip','제한 있는 상품','문구',1000,'ok',100);
update public.goods set claim_return_allowed=false,claim_restriction_reason='각인 주문 제작 상품' where id='order-purchase-ack-limited';

insert into public.orders(id,user_id,status,total)
 values(pg_temp.ack_id('order',1),pg_temp.ack_id('actor',1),'pending',2000),
        (pg_temp.ack_id('order',2),pg_temp.ack_id('actor',1),'pending',1000),
        (pg_temp.ack_id('order',3),pg_temp.ack_id('actor',1),'pending',1000);
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
 select pg_temp.ack_id('item',x.n),pg_temp.ack_id('order',x.o),g.id,v.id,1,1000,g.name,g.type,g.ip_id
 from (values(1,1,'order-purchase-ack-free'),(2,1,'order-purchase-ack-limited'),(3,2,'order-purchase-ack-free'),(4,3,'order-purchase-ack-limited'))x(n,o,gid)
 join public.goods g on g.id=x.gid join public.goods_variants v on v.good_id=g.id and v.is_default;

-- ── 기록: 첫 호출 true, 재호출 false(첫 기록 유지) ─────────────────────
select pg_temp.ack_assert(public.record_order_purchase_acknowledgement(pg_temp.ack_id('actor',1),pg_temp.ack_id('order',1),'2026-11-19') is true,'first record true');
select pg_temp.ack_assert(public.record_order_purchase_acknowledgement(pg_temp.ack_id('actor',1),pg_temp.ack_id('order',1),'2099-01-01') is false,'second record false');
select pg_temp.ack_assert((select count(*)=1 and min(notice_version)='2026-11-19' from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',1)),'first record kept');
-- 제한 굿즈만 스냅샷에 남는다(주문 품목 × 굿즈 행에서 DB가 읽는다).
select pg_temp.ack_assert((select jsonb_array_length(restricted_goods)=1
   and restricted_goods->0->>'goodId'='order-purchase-ack-limited'
   and restricted_goods->0->>'reason'='각인 주문 제작 상품'
   and restricted_goods->0->>'name'='제한 있는 상품'
   and (restricted_goods->0->>'returnAllowed')::boolean is false
  from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',1)),'restricted snapshot');
select pg_temp.ack_assert(public.record_order_purchase_acknowledgement(pg_temp.ack_id('actor',1),pg_temp.ack_id('order',2),'2026-11-19') is true,'second order records');
select pg_temp.ack_assert((select restricted_goods='[]'::jsonb from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',2)),'no restricted goods -> empty array');

-- 화면이 보인 고지는 그대로 남는다(알 수 없으면 null).
select pg_temp.ack_assert((select screen_notice is null from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',1)),'screen notice null by default');
select pg_temp.ack_assert(public.record_order_purchase_acknowledgement(pg_temp.ack_id('actor',1),pg_temp.ack_id('order',3),'2026-11-19','{"goodIds":["order-purchase-ack-limited"]}') is true,'record with screen notice');
select pg_temp.ack_assert((select screen_notice->'goodIds'->>0='order-purchase-ack-limited' from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',3)),'screen notice kept');
select pg_temp.ack_expect(format('select public.record_order_purchase_acknowledgement(%L,%L,%L,%L::jsonb)',pg_temp.ack_id('actor',1),pg_temp.ack_id('order',1),'2026-11-19','[1]'),'22023');
-- 남의 주문·없는 주문·잘못된 입력은 거절한다.
select pg_temp.ack_expect(format('select public.record_order_purchase_acknowledgement(%L,%L,%L)',pg_temp.ack_id('actor',2),pg_temp.ack_id('order',1),'2026-11-19'),'P0002');
select pg_temp.ack_expect(format('select public.record_order_purchase_acknowledgement(%L,%L,%L)',pg_temp.ack_id('actor',1),pg_temp.ack_id('order',99),'2026-11-19'),'P0002');
select pg_temp.ack_expect(format('select public.record_order_purchase_acknowledgement(%L,%L,%L)',pg_temp.ack_id('actor',1),pg_temp.ack_id('order',1),''),'22023');
select pg_temp.ack_expect(format('select public.record_order_purchase_acknowledgement(%L,%L,%L)',pg_temp.ack_id('actor',1),pg_temp.ack_id('order',1),repeat('x',41)),'22023');

-- ── 운영자 읽기: 고객은 거절, sales.read 운영자는 일시·버전·제한 굿즈를 본다 ──
set local role authenticated;
select set_config('request.jwt.claim.sub',pg_temp.ack_id('actor',1)::text,true);
select pg_temp.ack_expect(format('select public.admin_order_purchase_acknowledgement(%L)',pg_temp.ack_id('order',1)),'42501');
select set_config('request.jwt.claim.sub',pg_temp.ack_id('actor',3)::text,true);
select pg_temp.ack_assert((public.admin_order_purchase_acknowledgement(pg_temp.ack_id('order',1))->>'noticeVersion')='2026-11-19'
  and (public.admin_order_purchase_acknowledgement(pg_temp.ack_id('order',1))->>'acknowledgedAt') is not null
  and jsonb_array_length(public.admin_order_purchase_acknowledgement(pg_temp.ack_id('order',1))->'restrictedGoods')=1,'operator reads ack');
select pg_temp.ack_assert(public.admin_order_purchase_acknowledgement(pg_temp.ack_id('order',99)) is null,'missing -> null');
reset role;

-- 주문이 지워지면 기록도 함께 지워진다(보존은 거래기록과 같다).
delete from public.orders where id=pg_temp.ack_id('order',2);
select pg_temp.ack_assert(not exists(select 1 from private.order_purchase_acknowledgements where order_id=pg_temp.ack_id('order',2)),'cascade with order');

rollback;

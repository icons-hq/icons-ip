\set ON_ERROR_STOP on
-- Prepend goods_kc_fixture.sql. Every identity, amount and address is synthetic.
begin;

-- ============================================================================
-- ICONS · 19금 굿즈 판매 개방 (20261028235318, ADR-0024)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 판정 helper는 브라우저 롤에 열려 있지 않고, 제한 없음은 누구에게나, 성인 상품은
--      유효한 성인 인증 계정에게만 참이다
--   2. 장바구니 담기(상세의 본품 담기 포함)·견적·새 거래 계산·주문 생성은 인증 성인만
--      성인 상품을 통과시키고, 미인증은 일반 품절과 구분되는 오류로 막힌다
--   3. 인증 성인의 성인 상품 주문은 카드 provider가 코페이로 파생된다(#392 그대로)
--   4. 상세 RPC·가격 계산·검색은 인증 성인에게만 성인 상품을 돌려준다
--   5. 증거가 만료되면 같은 계정이 다시 막힌다
-- ============================================================================

create function pg_temp.adult_gate_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) > 0 then return; end if;
    raise;
  end;
  raise exception 'Expected error: %', expected;
end $$;

select 1 / case when (
  has_function_privilege('anon', 'public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)', 'execute')
  and has_function_privilege('authenticated', 'public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)', 'execute')
  and not has_function_privilege('service_role', 'public.good_sale_restriction_visible_to_viewer(public.goods_sale_restriction)', 'execute')
  and not has_function_privilege('anon', 'private.good_sale_restriction_visible(public.goods_sale_restriction, uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.good_sale_restriction_visible(public.goods_sale_restriction, uuid)', 'execute')
  and not has_function_privilege('service_role', 'private.good_sale_restriction_visible(public.goods_sale_restriction, uuid)', 'execute')
) then 1 else 0 end as assert_visibility_helper_is_closed;

-- ---------------------------------------------------------------------------
-- Fixtures — 인증 성인(V)·미인증(U)·운영자(A), 일반 굿즈와 성인 굿즈
-- ---------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('a0190000-0000-4000-8000-000000000001','authenticated','authenticated','adult-gate-admin@example.test',now(),'{}','{}',now(),now()),
 ('a0190000-0000-4000-8000-000000000002','authenticated','authenticated','adult-gate-verified@example.test',now(),'{}','{}',now(),now()),
 ('a0190000-0000-4000-8000-000000000003','authenticated','authenticated','adult-gate-unverified@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='TEST 성인 게이트 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
 role=case when id='a0190000-0000-4000-8000-000000000001' then 'admin'::public.user_role else 'user'::public.user_role end
 where id in('a0190000-0000-4000-8000-000000000001','a0190000-0000-4000-8000-000000000002','a0190000-0000-4000-8000-000000000003');
insert into private.operator_memberships(profile_id,manager_role) values('a0190000-0000-4000-8000-000000000001','primary');
update private.operator_access_state set configured=true where id;
update private.goods_transaction_runtime set enabled=true where singleton;

insert into public.ips(id,title,vertical_key,published_at) values('adult-gate-ip','TEST 성인 게이트 IP','character',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('a0190000-0000-4000-8000-000000000010','adult-gate-origin','TEST 성인 게이트 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,shipping_fee_type,individual_fee) values
 ('adult-gate-plain','adult-gate-ip','TEST 일반 굿즈 성인게이트','문구',10000,'ok',20,'a0190000-0000-4000-8000-000000000010','policy',0),
 ('adult-gate-adult','adult-gate-ip','TEST 성인 굿즈 성인게이트','문구',20000,'ok',20,'a0190000-0000-4000-8000-000000000010','policy',0);
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
 select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','adult-gate-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
 from public.goods where ip_id='adult-gate-ip';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where ip_id='adult-gate-ip';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where ip_id='adult-gate-ip';
select id as plain_variant from public.goods_variants where good_id='adult-gate-plain' and is_default \gset
select id as adult_variant from public.goods_variants where good_id='adult-gate-adult' and is_default \gset

insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
 select ('a0190000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('a0190000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour'
 from generate_series(1,3)n;
create function pg_temp.adult_gate_actor(n integer) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub','a0190000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a0190000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated','session_id','a0190000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;

-- 운영 스위치로 성인 상품을 지정한다(감사 기록이 남는 staff setter).
select pg_temp.adult_gate_actor(1);
set local role authenticated;
select public.admin_set_good_sale_restriction('adult-gate-adult','adult'::public.goods_sale_restriction);
reset role;

-- V의 유효한 성인 인증 증거. 확정 경로는 adult_verification.sql이 따로 고정한다.
insert into private.adult_verification_sessions(
  user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at
) values (
  'a0190000-0000-4000-8000-000000000002','test','IV'||repeat('a',32),repeat('a',64),'page','/my',
  'REGADULTGATE00000001',repeat('c',64),'verified',now(),now()+interval '30 minutes',now()
);
insert into private.adult_verifications(
  user_id, session_id, provider, provider_mode, subject_digest, transaction_digest, policy_version, verified_at, expires_at
)
select 'a0190000-0000-4000-8000-000000000002', id, 'kcp', 'test', repeat('d',64), repeat('5',64),
  'adult_19_youth_protection_act@2026-10-23', now(), now()+interval '1 year'
from private.adult_verification_sessions where provider_order_id='IV'||repeat('a',32);

select 1 / case when (
  private.good_sale_restriction_visible('none','a0190000-0000-4000-8000-000000000003')
  and not private.good_sale_restriction_visible('adult','a0190000-0000-4000-8000-000000000003')
  and private.good_sale_restriction_visible('adult','a0190000-0000-4000-8000-000000000002')
  and not private.good_sale_restriction_visible('adult',null)
) then 1 else 0 end as assert_visibility_follows_adult_evidence;

-- ---------------------------------------------------------------------------
-- 상세·가격·검색 — 인증 성인에게만 성인 상품 데이터가 나온다
-- ---------------------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claims','',true);
select 1 / case when (
  public.get_good_media('adult-gate-adult') is null
  and public.get_good_media('adult-gate-plain') is not null
  and (select public.goods_variant_pricing(v) from public.goods_variants v where v.id=:'adult_variant') is null
  and (select public.goods_variant_pricing(v) from public.goods_variants v where v.id=:'plain_variant') is not null
  and not exists(select 1 from public.search_public_content('성인게이트',6) where kind='good' and id='adult-gate-adult')
  and exists(select 1 from public.search_public_content('성인게이트',6) where kind='good' and id='adult-gate-plain')
  and not exists(select 1 from public.goods_variants where good_id='adult-gate-adult')
  and exists(select 1 from public.goods_variants where good_id='adult-gate-plain')
) then 1 else 0 end as assert_anonymous_sees_no_adult_good_data;
reset role;

select pg_temp.adult_gate_actor(3);
set local role authenticated;
select 1 / case when (
  public.get_good_media('adult-gate-adult') is null
  and (select public.goods_variant_pricing(v) from public.goods_variants v where v.id=:'adult_variant') is null
  and not exists(select 1 from public.search_public_content('성인게이트',6) where kind='good' and id='adult-gate-adult')
  and not exists(select 1 from public.goods_variants where good_id='adult-gate-adult')
) then 1 else 0 end as assert_unverified_member_sees_no_adult_good_data;
reset role;

select pg_temp.adult_gate_actor(2);
set local role authenticated;
select 1 / case when (
  public.get_good_media('adult-gate-adult') is not null
  and (select public.goods_variant_pricing(v) from public.goods_variants v where v.id=:'adult_variant') is not null
  and exists(select 1 from public.search_public_content('성인게이트',6) where kind='good' and id='adult-gate-adult')
  and exists(select 1 from public.goods_variants where good_id='adult-gate-adult')
) then 1 else 0 end as assert_verified_adult_sees_adult_good_data;
reset role;

-- ---------------------------------------------------------------------------
-- 장바구니 — 미인증은 성인 인증 오류로, 인증 성인은 담긴다
-- ---------------------------------------------------------------------------
select pg_temp.adult_gate_actor(3);
set local role authenticated;
select public.set_cart_item_quantity('adult-gate-plain',:'plain_variant',1);
select pg_temp.adult_gate_expect_error(
  format($sql$select public.set_cart_item_quantity('adult-gate-adult',%L::uuid,1)$sql$, :'adult_variant'),
  'adult_verification_required'
);
-- 상세의 담기·구매하기(본품+추가 구성 한 번에)도 같은 오류로 막힌다.
select pg_temp.adult_gate_expect_error(
  format($sql$select public.add_cart_selection('adult-gate-adult', jsonb_build_array(jsonb_build_object(
    'good_id','adult-gate-adult','variant_id',%L,'qty',1,'expected_qty',0)))$sql$, :'adult_variant'),
  'adult_verification_required'
);
reset role;

select pg_temp.adult_gate_actor(2);
set local role authenticated;
select public.add_cart_selection('adult-gate-adult', jsonb_build_array(jsonb_build_object(
  'good_id','adult-gate-adult','variant_id',:'adult_variant','qty',1,'expected_qty',0)));
select public.set_cart_item_quantity('adult-gate-adult',:'adult_variant',1);
reset role;

select 1 / case when (
  exists(select 1 from public.cart_items where user_id='a0190000-0000-4000-8000-000000000002' and good_id='adult-gate-adult')
  and not exists(select 1 from public.cart_items where user_id='a0190000-0000-4000-8000-000000000003' and good_id='adult-gate-adult')
) then 1 else 0 end as assert_only_verified_adult_can_cart_adult_good;

-- 쿠폰 소계도 같은 판정이다 — 인증 성인의 성인 상품은 소계에 들어간다.
select 1 / case when (
  private.cart_subtotal('a0190000-0000-4000-8000-000000000002') = 20000
) then 1 else 0 end as assert_verified_cart_subtotal_counts_adult_good;

-- ---------------------------------------------------------------------------
-- 새 거래 계산 — 미인증 장바구니에 성인 상품이 섞이면 성인 인증 이슈로 막힌다
-- ---------------------------------------------------------------------------
-- 브라우저 롤로는 담을 수 없으니, 증거가 사라진 계정의 남은 장바구니를 흉내 내 직접 넣는다.
insert into public.cart_items(user_id,good_id,variant_id,qty)
values('a0190000-0000-4000-8000-000000000003','adult-gate-adult',:'adult_variant',1);

select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id)
  as unverified_cart from public.cart_items where user_id='a0190000-0000-4000-8000-000000000003' \gset
select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id)
  as verified_cart from public.cart_items where user_id='a0190000-0000-4000-8000-000000000002' \gset
select '{"recipientName":"TEST 성인 게이트 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}' as address \gset

set local role service_role;
select public.quote_cart_goods_transaction('a0190000-0000-4000-8000-000000000003',:'unverified_cart',:'address','{}',null,0) as unverified_quote \gset
select public.quote_cart_goods_transaction('a0190000-0000-4000-8000-000000000002',:'verified_cart',:'address','{}',null,0) as verified_quote \gset
reset role;

select 1 / case when (
  :'unverified_quote'::jsonb ->> 'state' = 'blocked'
  and :'unverified_quote'::jsonb #>> '{issues,0,code}' = 'adult_verification_required'
  and :'unverified_quote'::jsonb #>> '{issues,0,goodId}' = 'adult-gate-adult'
) then 1 else 0 end as assert_transaction_blocks_unverified_adult_line;

select 1 / case when (
  coalesce(:'verified_quote'::jsonb #>> '{issues,0,code}', '') not in ('adult_verification_required', 'goods_unavailable')
) then 1 else 0 end as assert_transaction_accepts_verified_adult_line;

-- ---------------------------------------------------------------------------
-- 주문 생성 — 인증 성인은 주문하고 카드는 코페이로 파생된다, 미인증은 막힌다
-- ---------------------------------------------------------------------------
select public.place_order(
  'a0190000-0000-4000-8000-000000000002'::uuid,
  '{"recipientName":"TEST 성인 게이트 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'::jsonb,
  'a0190000-0000-4000-8000-000000000101'::uuid,
  'card'::public.order_payment_method
) as adult_order \gset

select 1 / case when (
  select status = 'pending' and payment_method = 'card'
  from public.orders where id = :'adult_order'::uuid
) and exists(
  select 1 from public.order_items where order_id = :'adult_order'::uuid and good_id = 'adult-gate-adult'
) then 1 else 0 end as assert_verified_adult_orders_adult_good;

select pg_temp.adult_gate_expect_error(
  format($sql$select public.prepare_goods_payment_attempt('a0190000-0000-4000-8000-000000000002'::uuid,%L::uuid,'toss'::public.payment_provider)$sql$, :'adult_order'),
  'goods_payment_provider_mismatch'
);
select 1 / case when (
  public.prepare_goods_payment_attempt('a0190000-0000-4000-8000-000000000002'::uuid, :'adult_order'::uuid, 'korpay'::public.payment_provider) ->> 'provider' = 'korpay'
) then 1 else 0 end as assert_adult_order_derives_korpay;

select pg_temp.adult_gate_expect_error(
  $sql$select public.place_order('a0190000-0000-4000-8000-000000000003'::uuid,
    '{"recipientName":"TEST 성인 게이트 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'::jsonb,
    'a0190000-0000-4000-8000-000000000102'::uuid,'card'::public.order_payment_method)$sql$,
  'adult verification required: adult-gate-adult'
);

select 1 / case when not exists(
  select 1 from public.orders where user_id='a0190000-0000-4000-8000-000000000003' and checkout_key='a0190000-0000-4000-8000-000000000102'
) then 1 else 0 end as assert_unverified_adult_order_is_not_created;

-- ---------------------------------------------------------------------------
-- 만료 — 1년이 지난 증거로는 다시 담을 수 없다
-- ---------------------------------------------------------------------------
update private.adult_verifications
set verified_at = now() - interval '2 years', expires_at = now() - interval '1 second'
where user_id = 'a0190000-0000-4000-8000-000000000002';

select pg_temp.adult_gate_actor(2);
set local role authenticated;
select pg_temp.adult_gate_expect_error(
  format($sql$select public.set_cart_item_quantity('adult-gate-adult',%L::uuid,2)$sql$, :'adult_variant'),
  'adult_verification_required'
);
select 1 / case when (
  public.get_good_media('adult-gate-adult') is null
) then 1 else 0 end as assert_expired_evidence_closes_adult_detail;
reset role;

rollback;

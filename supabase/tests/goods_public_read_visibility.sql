\set ON_ERROR_STOP on
-- Prepend helpers/goods_kc_fixture.sql. Run as postgres. Every identity, amount and address is synthetic.
begin;

-- ============================================================================
-- ICONS · 공개 Data API의 상품 읽기 경계 (20261118160000 · CAT-063 · CUS-045)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 익명·회원은 공개 상품만 직접 읽는다 — 초안·보관·초안 IP 아래·19금(인증 전)은 행이 없다.
--      19금은 유효한 성인 인증이 있는 본인만 읽는다. 옵션도 부모 상품을 따른다.
--   2. 운영자(catalog.read)는 전부 읽고, catalog.read가 없는 운영자(물류)는 공개만 읽는다.
--   3. 좁은 읽기 RPC: 가림 카드 열(이름·이미지 없음), 본인 주문 품목 줄 보강(남의 주문 없음),
--      선물 랜덤 판매 여부(넘긴 id만). 권한·보안 정의자·빈 search_path.
--   4. 주문·장바구니 RPC는 상품이 내려가도 본인 행을 그대로 다룬다.
--   5. 브라우저 롤이 부르는 public 함수 중 goods를 읽는 security invoker 함수는 허용 목록뿐이다
--      (새 invoker 함수가 RLS 강화로 조용히 비지 않게 한다).
-- ============================================================================

create function pg_temp.gprv_expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception when others then
    if position(expected in sqlerrm) > 0 or sqlstate = expected then return; end if;
    raise;
  end;
  raise exception 'Expected error: %', expected;
end $$;

-- ---------------------------------------------------------------------------
-- 0. 정책·함수 표면
-- ---------------------------------------------------------------------------
select 1 / case when (
  not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename in ('goods', 'goods_variants') and cmd in ('SELECT', 'ALL')
      and permissive = 'PERMISSIVE' and btrim(coalesce(qual, '')) in ('', 'true')
  )
  and exists (
    select 1 from private.operator_policy_contracts
    where schema_name = 'public' and table_name = 'goods' and policy_name = 'goods_operator_read' and capability = 'catalog.read'
  )
) then 1 else 0 end as assert_goods_have_no_open_select_policy;

select 1 / case when (
  has_function_privilege('anon', 'public.get_masked_adult_goods(text)', 'execute')
  and has_function_privilege('authenticated', 'public.get_masked_adult_goods(text)', 'execute')
  and not has_function_privilege('service_role', 'public.get_masked_adult_goods(text)', 'execute')
  and has_function_privilege('authenticated', 'public.my_order_line_goods(text[])', 'execute')
  and not has_function_privilege('anon', 'public.my_order_line_goods(text[])', 'execute')
  and not has_function_privilege('service_role', 'public.my_order_line_goods(text[])', 'execute')
  and has_function_privilege('anon', 'public.get_random_option_good_ids(text[])', 'execute')
  and has_function_privilege('authenticated', 'public.get_random_option_good_ids(text[])', 'execute')
  and not has_function_privilege('service_role', 'public.get_random_option_good_ids(text[])', 'execute')
  and not exists (
    select 1
    from pg_catalog.pg_proc as procedure
    cross join lateral pg_catalog.aclexplode(procedure.proacl) as privilege
    where procedure.oid in ('public.get_masked_adult_goods(text)'::regprocedure, 'public.my_order_line_goods(text[])'::regprocedure,
      'public.get_random_option_good_ids(text[])'::regprocedure)
      and privilege.grantee = 0
  )
  and (select bool_and(procedure.prosecdef and procedure.provolatile = 's' and procedure.proconfig = array['search_path=""'])
    from pg_catalog.pg_proc as procedure
    where procedure.oid in ('public.get_masked_adult_goods(text)'::regprocedure, 'public.my_order_line_goods(text[])'::regprocedure,
      'public.get_random_option_good_ids(text[])'::regprocedure))
) then 1 else 0 end as assert_narrow_read_rpcs_are_sealed;

-- 가림 카드 RPC는 이름·이미지·배지·설명 열을 돌려주지 않는다.
select 1 / case when (
  select coalesce(array_agg(name order by name), '{}') = array['category_id','created_at','display_order','id','ip_id','price','stock','stock_qty']
  from pg_catalog.pg_proc procedure
  cross join lateral unnest(procedure.proargnames, procedure.proargmodes) as argument(name, mode)
  where procedure.oid = 'public.get_masked_adult_goods(text)'::regprocedure and argument.mode = 't'
) then 1 else 0 end as assert_masked_rpc_returns_only_card_columns;

-- 브라우저 롤이 부르는 goods 읽기 함수는 security definer여야 한다(허용 목록: 운영자 전용 계산 열·내보내기,
-- 공개 조건을 본문에 둔 홈 리뷰 후보). 새 invoker 함수는 공개 상품만 보게 되므로 의도를 여기서 밝힌다.
select 1 / case when not exists (
  select 1
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.prokind = 'f' and not procedure.prosecdef
    and (has_function_privilege('anon', procedure.oid, 'execute') or has_function_privilege('authenticated', procedure.oid, 'execute'))
    and (procedure.prosrc ~* 'public\.goods\M' or procedure.prosrc ~* '\mgoods_variants\M')
    and procedure.oid::regprocedure::text not in (
      'admin_goods_active_stock_qty(goods)', 'admin_goods_low_stock_option_count(goods)',
      'admin_goods_export_candidates(text,text,text,text)', 'get_home_review_candidates(text[])')
) then 1 else 0 end as assert_browser_goods_readers_are_definers;

-- ---------------------------------------------------------------------------
-- 1. 픽스처 — 운영자(1)·인증 성인(2)·회원(3)·물류 운영자(4)
-- ---------------------------------------------------------------------------
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('a5160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','gprv-'||n||'@example.test',now(),'{}','{}',now(),now()
from generate_series(1,4) n;
update public.profiles set nickname='TEST 공개읽기 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}',
  role=case right(id::text,1) when '1' then 'admin'::public.user_role when '4' then 'staff'::public.user_role else 'user'::public.user_role end
where id::text like 'a5160000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values
  ('a5160000-0000-4000-8000-000000000001','primary'),
  ('a5160000-0000-4000-8000-000000000004','logistics');
update private.operator_access_state set configured=true where id;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select ('a5160000-0000-4000-9000-'||lpad(n::text,12,'0'))::uuid,('a5160000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now(),now(),now()+interval '1 hour'
from generate_series(1,4) n;
create function pg_temp.gprv_actor(n integer) returns void language plpgsql as $$begin
  if n = 0 then
    perform set_config('request.jwt.claim.sub','',true);
    perform set_config('request.jwt.claims','',true);
    return;
  end if;
  perform set_config('request.jwt.claim.sub','a5160000-0000-4000-8000-'||lpad(n::text,12,'0'),true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub','a5160000-0000-4000-8000-'||lpad(n::text,12,'0'),'role','authenticated',
    'session_id','a5160000-0000-4000-9000-'||lpad(n::text,12,'0'))::text,true);
end $$;

insert into public.ips(id,public_slug,title,vertical_key,published_at) values
  ('gprv-ip','gprv-ip','TEST 공개읽기 IP','character',now()),
  ('gprv-draft-ip','gprv-draft-ip','TEST 공개읽기 초안 IP','character',null);
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
  values('a5160000-0000-4000-8000-000000000010','gprv-origin','TEST 공개읽기 출고지','hanjin',3000,'TEST 합성 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id,image_path) values
  ('gprv-public','gprv-ip','TEST 공개읽기 공개','문구',10000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-public.webp'),
  ('gprv-draft','gprv-ip','TEST 공개읽기 초안','문구',10000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-draft.webp'),
  ('gprv-archived','gprv-ip','TEST 공개읽기 보관','문구',10000,'soldout',0,'a5160000-0000-4000-8000-000000000010','goods/gprv-archived.webp'),
  ('gprv-adult','gprv-ip','TEST 공개읽기 성인','문구',20000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-adult.webp'),
  ('gprv-unpublished','gprv-ip','TEST 공개읽기 내림','문구',10000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-unpublished.webp'),
  ('gprv-under-draft-ip','gprv-draft-ip','TEST 공개읽기 초안 IP 상품','문구',10000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-under.webp'),
  ('gprv-random','gprv-ip','TEST 공개읽기 랜덤 초안','문구',9000,'ok',20,'a5160000-0000-4000-8000-000000000010','goods/gprv-random.webp');
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at)
select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','gprv-kc-'||md5(id)||'@example.test','{"testFixture":"goods-kc"}',now(),now()
from public.goods where id like 'gprv-%';
insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id like 'gprv-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods
where id in ('gprv-public','gprv-archived','gprv-adult','gprv-unpublished','gprv-under-draft-ip');
-- 랜덤 판매 초안 굿즈. 랜덤 조건 검증은 커밋에서 도는 지연 제약이라 되돌리는 이 시험에는 닿지 않는다.
insert into public.goods_variants(good_id,name,price,code) values
  ('gprv-random','TEST 랜덤 옵션 X',9000,'GPRV-RANDOM-X'),('gprv-random','TEST 랜덤 옵션 Y',9000,'GPRV-RANDOM-Y');
update public.goods set option_sale_mode='random' where id='gprv-random';

select id as public_variant from public.goods_variants where good_id='gprv-public' and is_default \gset
select id as unpublished_variant from public.goods_variants where good_id='gprv-unpublished' and is_default \gset

-- 회원(3)이 지금은 공개인 상품을 담고, 19금·보관 예정 상품까지 주문한 상태를 만든다(19금 줄은 인증 만료 뒤 남은 주문을 흉내 낸다).
insert into public.cart_items(user_id,good_id,variant_id,qty) values
  ('a5160000-0000-4000-8000-000000000003','gprv-unpublished',:'unpublished_variant',1),
  ('a5160000-0000-4000-8000-000000000003','gprv-public',:'public_variant',1);
insert into public.orders(id,user_id,status,total,calculation_version) values
  ('a5160000-0000-4000-8000-000000000101','a5160000-0000-4000-8000-000000000003','paid',50000,1);
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('a5160000-0000-4000-8000-0000000002'||lpad(row_number() over (order by good.id)::text,2,'0'))::uuid,
  'a5160000-0000-4000-8000-000000000101', good.id, variant.id, 1, 10000, good.name, '문구', good.ip_id
from public.goods good join public.goods_variants variant on variant.good_id=good.id and variant.is_default
where good.id in ('gprv-unpublished','gprv-archived','gprv-adult');

-- 운영자 전환: 보관, 19금 지정, 게시 내림(감사가 남는 운영 RPC).
select pg_temp.gprv_actor(1);
set local role authenticated;
select public.admin_archive_good('gprv-archived');
select public.admin_set_good_sale_restriction('gprv-adult','adult'::public.goods_sale_restriction);
select public.admin_set_good_published('gprv-unpublished',false);
reset role;

-- 인증 성인(2)의 유효한 증거. 확정 경로는 adult_verification.sql이 따로 고정한다.
insert into private.adult_verification_sessions(
  user_id, provider_mode, provider_order_id, callback_nonce_digest, presentation, return_path,
  registration_key, completion_token_digest, state, created_at, expires_at, completed_at
) values (
  'a5160000-0000-4000-8000-000000000002','test','IV'||repeat('b',32),repeat('b',64),'page','/my',
  'REGGPRV0000000000001',repeat('e',64),'verified',now(),now()+interval '30 minutes',now()
);
insert into private.adult_verifications(
  user_id, session_id, provider, provider_mode, subject_digest, transaction_digest, policy_version, verified_at, expires_at
)
select 'a5160000-0000-4000-8000-000000000002', id, 'kcp', 'test', repeat('f',64), repeat('6',64),
  'adult_19_youth_protection_act@2026-10-23', now(), now()+interval '1 year'
from private.adult_verification_sessions where provider_order_id='IV'||repeat('b',32);

select 1 / case when (
  (select archived_at is not null and published_at is null from public.goods where id='gprv-archived')
  and (select sale_restriction='adult' and published_at is not null from public.goods where id='gprv-adult')
  and (select published_at is null and first_published_at is not null from public.goods where id='gprv-unpublished')
  and (select published_at is not null from public.goods where id='gprv-under-draft-ip')
  and (select published_at is null and option_sale_mode='random' from public.goods where id='gprv-random')
) then 1 else 0 end as assert_fixture_states;

-- ---------------------------------------------------------------------------
-- 2. 직접 읽기 — 익명·회원·인증 성인·물류 운영자·카탈로그 운영자
-- ---------------------------------------------------------------------------
create function pg_temp.gprv_visible_goods() returns text[] language sql as $$
  select coalesce(array_agg(id order by id), '{}') from public.goods where id like 'gprv-%'
$$;
create function pg_temp.gprv_visible_variant_goods() returns text[] language sql as $$
  select coalesce(array_agg(distinct good_id order by good_id), '{}') from public.goods_variants where good_id like 'gprv-%'
$$;

select pg_temp.gprv_actor(0);
set local role anon;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-public']
  and pg_temp.gprv_visible_variant_goods() = array['gprv-public']
  -- 열 하나만 골라도, 이름으로 찾아도 숨은 행은 나오지 않는다.
  and not exists (select 1 from public.goods where name like 'TEST 공개읽기 %' and id <> 'gprv-public')
  and not exists (select 1 from public.goods where image_path like 'goods/gprv-%' and id <> 'gprv-public')
) then 1 else 0 end as assert_anon_reads_only_public_goods;

-- 가림 카드: 공개 IP의 게시된 19금만, 카드 열만.
select 1 / case when (
  (select array_agg(id order by id) from public.get_masked_adult_goods() where id like 'gprv-%') = array['gprv-adult']
  and (select price = 20000 and ip_id = 'gprv-ip' and stock_qty = 20 from public.get_masked_adult_goods('gprv-adult'))
  and not exists (select 1 from public.get_masked_adult_goods('gprv-public'))
  and not exists (select 1 from public.get_masked_adult_goods('gprv-draft'))
  and not exists (select 1 from public.get_masked_adult_goods('gprv-missing'))
) then 1 else 0 end as assert_anon_masked_cards_hold_no_product_info;

-- 선물 랜덤 판매 여부: 상품이 초안이어도 판매 방식만 알려 준다. 넘기지 않은 id는 나오지 않는다.
select 1 / case when (
  (select array_agg(id order by id) from public.get_random_option_good_ids(array['gprv-random','gprv-public','gprv-missing']) id) = array['gprv-random']
  and not exists (select 1 from public.get_random_option_good_ids(array['gprv-public']))
  and not exists (select 1 from public.get_random_option_good_ids('{}'::text[]))
) then 1 else 0 end as assert_random_lookup_answers_only_requested_ids;
select pg_temp.gprv_expect_error($sql$select * from public.get_random_option_good_ids(null)$sql$, 'invalid_random_option_goods');
select pg_temp.gprv_expect_error(
  $sql$select * from public.get_random_option_good_ids((select array_agg('gprv-'||n) from generate_series(1,1001) n))$sql$,
  'invalid_random_option_goods');
reset role;

select pg_temp.gprv_actor(3);
set local role authenticated;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-public']
  and pg_temp.gprv_visible_variant_goods() = array['gprv-public']
) then 1 else 0 end as assert_member_reads_only_public_goods;
reset role;

select pg_temp.gprv_actor(2);
set local role authenticated;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-adult','gprv-public']
  and pg_temp.gprv_visible_variant_goods() = array['gprv-adult','gprv-public']
) then 1 else 0 end as assert_verified_adult_reads_adult_goods;
reset role;

-- catalog.read가 없는 운영자(물류)는 고객과 같은 공개 읽기다.
select pg_temp.gprv_actor(4);
set local role authenticated;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-public']
) then 1 else 0 end as assert_operator_without_catalog_read_sees_public_only;
reset role;

-- 카탈로그 운영자는 초안·보관·19금·초안 IP 아래·랜덤 초안까지 그대로 읽는다(어드민 목록·편집·미리보기).
select pg_temp.gprv_actor(1);
set local role authenticated;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-adult','gprv-archived','gprv-draft','gprv-public','gprv-random','gprv-under-draft-ip','gprv-unpublished']
  and pg_temp.gprv_visible_variant_goods() = array['gprv-adult','gprv-archived','gprv-draft','gprv-public','gprv-random','gprv-under-draft-ip','gprv-unpublished']
) then 1 else 0 end as assert_catalog_operator_reads_every_good;
reset role;

-- ---------------------------------------------------------------------------
-- 3. 본인 주문 줄 보강 — 내려간 상품도 본인 주문이면 보강된다, 남의 주문은 없다
-- ---------------------------------------------------------------------------
select pg_temp.gprv_actor(3);
set local role authenticated;
select 1 / case when (
  (select array_agg(id order by id) from public.my_order_line_goods(array['gprv-unpublished','gprv-archived','gprv-adult','gprv-public','gprv-draft']))
    = array['gprv-adult','gprv-archived','gprv-unpublished']
  and (select sale_restriction = 'adult' and image_path = 'goods/gprv-adult.webp' and ip_id = 'gprv-ip'
    from public.my_order_line_goods(array['gprv-adult']))
) then 1 else 0 end as assert_owner_line_goods_survive_unpublish;
select pg_temp.gprv_expect_error($sql$select * from public.my_order_line_goods(null)$sql$, 'invalid_order_line_goods');
select pg_temp.gprv_expect_error(
  $sql$select * from public.my_order_line_goods((select array_agg('gprv-'||n) from generate_series(1,1001) n))$sql$,
  'invalid_order_line_goods');

-- 주문 RPC는 RLS를 거치지 않고 본인 품목 스냅샷을 그대로 준다.
select 1 / case when (
  (select count(*) from public.my_order_items(array['a5160000-0000-4000-8000-000000000101'::uuid])) = 3
) then 1 else 0 end as assert_order_items_rpc_keeps_hidden_goods;

-- 장바구니: 내려간 상품 줄은 그대로 지울 수 있고, 다시 담을 수는 없다(기존 판매 차단).
select pg_temp.gprv_expect_error(
  format($sql$select public.set_cart_item_quantity('gprv-unpublished',%L::uuid,2)$sql$, :'unpublished_variant'),
  'catalog_item_unavailable');
select public.remove_cart_lines(jsonb_build_array(jsonb_build_object(
  'good_id','gprv-unpublished','variant_id',:'unpublished_variant','input_revision',0,'input_values','{}'::jsonb))) as removed_hidden_line \gset
reset role;
select 1 / case when (
  :removed_hidden_line = 1
  and not exists (select 1 from public.cart_items where user_id='a5160000-0000-4000-8000-000000000003' and good_id='gprv-unpublished')
  and exists (select 1 from public.cart_items where user_id='a5160000-0000-4000-8000-000000000003' and good_id='gprv-public')
) then 1 else 0 end as assert_cart_rpc_removes_hidden_line;

-- 다른 회원(인증 성인 2)은 남의 주문 상품을 이 RPC로 읽지 못한다.
select pg_temp.gprv_actor(2);
set local role authenticated;
select 1 / case when not exists (
  select 1 from public.my_order_line_goods(array['gprv-unpublished','gprv-archived','gprv-adult','gprv-draft'])
) then 1 else 0 end as assert_line_goods_never_leak_other_orders;
reset role;

select pg_temp.gprv_actor(0);
set local role anon;
select pg_temp.gprv_expect_error($sql$select * from public.my_order_line_goods(array['gprv-adult'])$sql$, '42501');
reset role;

-- ---------------------------------------------------------------------------
-- 4. 성인 인증 만료 — 같은 계정이 다시 19금 행을 읽지 못한다
-- ---------------------------------------------------------------------------
update private.adult_verifications
set verified_at = now() - interval '2 years', expires_at = now() - interval '1 second'
where user_id = 'a5160000-0000-4000-8000-000000000002';
select pg_temp.gprv_actor(2);
set local role authenticated;
select 1 / case when (
  pg_temp.gprv_visible_goods() = array['gprv-public']
  and pg_temp.gprv_visible_variant_goods() = array['gprv-public']
) then 1 else 0 end as assert_expired_adult_evidence_closes_adult_rows;
reset role;

rollback;

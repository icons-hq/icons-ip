\set ON_ERROR_STOP on

-- D-6 — 통계 RPC 3종: 시계열 · 축별 · 상품 (설계서 v2 §1-5)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000c001', 'authenticated', 'authenticated', 'stx-buyer1@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000c002', 'authenticated', 'authenticated', 'stx-buyer2@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000c003', 'authenticated', 'authenticated', 'stx-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  ('00000000-0000-4000-8000-00000000c001', 'stx-buyer1@example.test', 'stx_buyer1', '1996-05-05', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-00000000c002', 'stx-buyer2@example.test', 'stx_buyer2', '2004-05-05', '{"terms":true,"privacy":true}'::jsonb, now(), 'user'),
  ('00000000-0000-4000-8000-00000000c003', 'stx-staff@example.test', 'stx_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role;

insert into public.verticals (key, label, color) values ('stx', '통계 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values
  ('stx-ip-a', '통계 IP A', 'stx'), ('stx-ip-b', '통계 IP B', 'stx')
on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty) values
  ('stx-g1', 'stx-ip-a', '통계 굿즈 1', '키링', 10000, 'ok', 100),
  ('stx-g2', 'stx-ip-b', '통계 굿즈 2', '문구', 20000, 'ok', 100)
on conflict (id) do nothing;

-- 주문 셋: 서울/제주/서울, 카드/무통장/카드, 30대/20대/30대
insert into public.orders (id, user_id, status, total, payment_method, address, created_at, paid_at)
values
  ('c0000001-0000-4000-8000-00000000c001', '00000000-0000-4000-8000-00000000c001', 'paid', 10000, 'card',
   '{"recipientName":"김통계","phone":"01011112222","postalCode":"06236","address1":"서울특별시 강남구","address2":"1층"}'::jsonb,
   now() - interval '2 days', now() - interval '2 days'),
  ('c0000002-0000-4000-8000-00000000c002', '00000000-0000-4000-8000-00000000c002', 'paid', 40000, 'bank_transfer',
   '{"recipientName":"이통계","phone":"01033334444","postalCode":"63000","address1":"제주특별자치도","address2":"2층"}'::jsonb,
   now() - interval '1 day', now() - interval '1 day'),
  ('c0000003-0000-4000-8000-00000000c003', '00000000-0000-4000-8000-00000000c001', 'paid', 20000, 'card',
   '{"recipientName":"김통계","phone":"01011112222","postalCode":"06236","address1":"서울특별시 강남구","address2":"1층"}'::jsonb,
   now() - interval '1 day', now() - interval '1 day');

insert into public.order_items (order_id, good_id, good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, qty, unit_price)
values
  ('c0000001-0000-4000-8000-00000000c001', 'stx-g1', '통계 굿즈 1', '키링', 'stx-ip-a', 1, 10000),
  ('c0000002-0000-4000-8000-00000000c002', 'stx-g2', '통계 굿즈 2', '문구', 'stx-ip-b', 2, 20000),
  ('c0000003-0000-4000-8000-00000000c003', 'stx-g1', '통계 굿즈 1', '키링', 'stx-ip-a', 2, 10000);

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c003', true);

-- ---------------------------------------------------------------------------
-- A. 시계열 — 빈 버킷도 0으로 나온다(그래야 선이 끊기지 않는다)
-- ---------------------------------------------------------------------------
select public.admin_stats_timeseries(
  now() - interval '3 days', now() + interval '1 day', 'day', 'none', null
) as ts \gset
reset role;
select 1 / case when (
  select
    -- 버킷에 구멍이 없다: 처음과 끝 사이의 모든 날이 한 줄씩 있다.
    count(*) = (max((entry ->> 'bucket')::date) - min((entry ->> 'bucket')::date)) + 1
    -- 주문이 없는 날도 0 으로 나온다(그래야 선이 끊기지 않는다).
    and count(*) filter (where (entry ->> 'orderCount')::bigint = 0) >= 1
    and sum((entry ->> 'orderCount')::bigint) = 3
  from jsonb_array_elements(:'ts'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_timeseries_fills_every_bucket;

-- 「언제 기준 숫자인가」를 응답이 스스로 말한다.
select 1 / case when (:'ts'::jsonb ->> 'refreshedAt') is not null then 1 else 0 end as assert_timeseries_reports_its_own_freshness;

-- ---------------------------------------------------------------------------
-- B. 축별 — 같은 모집단을 나눈 것이라 축 합계가 시계열 합계와 같다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c003', true);
select public.admin_stats_breakdown(now() - interval '3 days', now() + interval '1 day', 'payment_method', null) as by_method \gset
select public.admin_stats_breakdown(now() - interval '3 days', now() + interval '1 day', 'region', null) as by_region \gset
select public.admin_stats_breakdown(now() - interval '3 days', now() + interval '1 day', 'remote_area', null) as by_remote \gset
select public.admin_stats_breakdown(now() - interval '3 days', now() + interval '1 day', 'age_band', null) as by_age \gset
select public.admin_stats_breakdown(now() - interval '3 days', now() + interval '1 day', 'buyer_type', null) as by_buyer \gset
reset role;

select 1 / case when (
  (select sum((entry ->> 'gross')::bigint) from jsonb_array_elements(:'by_method'::jsonb -> 'rows') as entry)
  = (select sum((entry ->> 'gross')::bigint) from jsonb_array_elements(:'ts'::jsonb -> 'rows') as entry)
) then 1 else 0 end as assert_axis_total_matches_the_timeseries_total;

-- 지역은 우편번호 앞 두 자리로 읽는다. 06=서울, 63=제주.
select 1 / case when (
  select bool_or(entry ->> 'label' = '서울' and (entry ->> 'gross')::bigint = 30000)
    and bool_or(entry ->> 'label' = '제주' and (entry ->> 'gross')::bigint = 40000)
  from jsonb_array_elements(:'by_region'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_region_axis_reads_the_postal_prefix;

-- 도서산간 판정은 지역 표와 같은 근거를 쓴다.
select 1 / case when (
  select bool_or(entry ->> 'label' = '도서산간' and (entry ->> 'gross')::bigint = 40000)
    and bool_or(entry ->> 'label' = '일반' and (entry ->> 'gross')::bigint = 30000)
  from jsonb_array_elements(:'by_remote'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_remote_area_axis_shares_the_lookup;

-- 연령대는 주문 시점 만 나이의 10년 단위다.
select 1 / case when (
  select bool_or(entry ->> 'label' = '30대') and bool_or(entry ->> 'label' = '20대')
  from jsonb_array_elements(:'by_age'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_age_band_uses_order_time_age;

-- 첫구매/재구매는 「이 주문 전에 결제한 주문이 있었나」로 가른다.
select 1 / case when (
  select bool_or(entry ->> 'label' = '재구매' and (entry ->> 'orderCount')::bigint = 1)
    and bool_or(entry ->> 'label' = '첫구매' and (entry ->> 'orderCount')::bigint = 2)
  from jsonb_array_elements(:'by_buyer'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_buyer_type_looks_backwards_in_time;

-- ---------------------------------------------------------------------------
-- C. 상품 — 판매 순위와 IP 필터
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c003', true);
select public.admin_stats_products(now() - interval '3 days', now() + interval '1 day', 'sales', 20, null) as products \gset
select public.admin_stats_products(now() - interval '3 days', now() + interval '1 day', 'sales', 20, 'stx-ip-a') as products_a \gset
select public.admin_stats_timeseries(now() - interval '3 days', now() + interval '1 day', 'day', 'none', 'stx-ip-a') as ts_a \gset
reset role;

select 1 / case when (
  select bool_or(entry ->> 'key' = 'stx-g1' and (entry ->> 'qty')::bigint = 3 and (entry ->> 'revenue')::bigint = 30000)
    and bool_or(entry ->> 'key' = 'stx-g2' and (entry ->> 'qty')::bigint = 2 and (entry ->> 'revenue')::bigint = 40000)
  from jsonb_array_elements(:'products'::jsonb -> 'rows') as entry
) then 1 else 0 end as assert_product_ranking_sums_lines;

-- IP 필터는 상품 목록과 시계열에 같은 모집단을 준다.
select 1 / case when (
  (select count(*) from jsonb_array_elements(:'products_a'::jsonb -> 'rows') as entry where entry ->> 'key' = 'stx-g2') = 0
  and (select sum((entry ->> 'gross')::bigint) from jsonb_array_elements(:'ts_a'::jsonb -> 'rows') as entry) = 30000
) then 1 else 0 end as assert_ip_filter_narrows_both_views;

-- ---------------------------------------------------------------------------
-- D. 비교 구간 · 입력 검증 · 권한
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c003', true);
select public.admin_stats_timeseries(
  now() - interval '3 days', now() + interval '1 day', 'day', 'previous_period', null
) as ts_cmp \gset

do $$
begin
  perform public.admin_stats_breakdown(now() - interval '3 days', now(), '없는축', null);
  raise exception 'unknown axis must be rejected';
exception when check_violation then null;
end $$;

do $$
begin
  perform public.admin_stats_timeseries(now(), now() - interval '1 day', 'day', 'none', null);
  raise exception 'inverted range must be rejected';
exception when check_violation then null;
end $$;
reset role;

select 1 / case when (
  jsonb_array_length(:'ts_cmp'::jsonb -> 'compare') = jsonb_array_length(:'ts_cmp'::jsonb -> 'rows')
) then 1 else 0 end as assert_compare_returns_the_same_shape;

select 1 / case when (
  has_function_privilege('authenticated', 'public.admin_stats_timeseries(timestamptz,timestamptz,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_stats_breakdown(timestamptz,timestamptz,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_stats_products(timestamptz,timestamptz,text,integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.stats_sales_scope(timestamptz,timestamptz,text)', 'execute')
) then 1 else 0 end as assert_stats_acl;

-- 스태프가 아니면 막힌다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000c001', true);
do $$
begin
  perform public.admin_stats_timeseries(now() - interval '1 day', now(), 'day', 'none', null);
  raise exception 'non-staff must not read stats';
exception when insufficient_privilege then null;
end $$;
reset role;

rollback;

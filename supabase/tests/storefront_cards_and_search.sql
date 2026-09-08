\set ON_ERROR_STOP on

-- 규모 후속 — 카드 페이징 · 바인더 집계 · 굿즈 검색

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000a01', 'authenticated', 'authenticated', 'binder@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values ('00000000-0000-4000-8000-000000000a01', 'binder@example.test', 'binder_user', '1990-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user')
on conflict (id) do nothing;

insert into public.verticals (key, label, color) values ('sfc', '카드 페이징', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values
  ('sfc-a', '카드 IP 에이', 'sfc'),
  ('sfc-b', '카드 IP 비', 'sfc')
on conflict (id) do nothing;
insert into public.cards (id, ip_id, name, no, rarity)
values
  ('sfc-c10', 'sfc-a', '열 번', '010', 'N'),
  ('sfc-c2', 'sfc-a', '두 번', '002', 'HOLO'),
  ('sfc-c1', 'sfc-b', '한 번', '001', 'SSR'),
  ('sfc-c3', 'sfc-b', '보관', '003', 'N')
on conflict (id) do nothing;
update public.cards set archived_at = now() where id = 'sfc-c3';
insert into public.user_cards (user_id, card_id, qty)
values ('00000000-0000-4000-8000-000000000a01', 'sfc-c2', 1), ('00000000-0000-4000-8000-000000000a01', 'sfc-c3', 1)
on conflict do nothing;

-- 검색 순위 판: 질의는 「파우치」. 유형은 goods_type_check 의 허용 값이어야 한다.
insert into public.ips (id, title, vertical_key) values ('sfc-pouch', '파우치 나라', 'sfc') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('sfc-g-name', 'sfc-b', '파우치 세트', '문구', 1000, 'ok', 5),    -- 이름 일치
  ('sfc-g-ip', 'sfc-pouch', '키링', '키링', 1000, 'ok', 5),          -- IP 이름 일치
  ('sfc-g-type', 'sfc-b', '무관', '파우치', 1000, 'ok', 5),           -- 유형 일치
  ('sfc-g-hidden', 'sfc-b', '파우치 숨김', '문구', 1000, 'ok', 5)
on conflict (id) do nothing;
update public.goods set hidden_at = now() where id = 'sfc-g-hidden';

-- ---------------------------------------------------------------------------
-- A. 카드 페이지 — IP 순 → 자연 순서(c2 < c10), 보관 제외, 등급·IP 필터, total 은 거른 전체
-- ---------------------------------------------------------------------------
set local role anon;
select 1 / case when (
  (select pg_catalog.string_agg(id, ',' order by ord)
   from (select id, pg_catalog.row_number() over () as ord
         from public.storefront_cards_page(p_ip_ids => array['sfc-a', 'sfc-b'], p_limit => 500)) as page)
  = 'sfc-c2,sfc-c10,sfc-c1'
  and (select count(*) from public.storefront_cards_page(p_ip_ids => array['sfc-a', 'sfc-b'], p_rarity => 'HOLO')) = 1
  and (select total_count from public.storefront_cards_page(p_ip_ids => array['sfc-a', 'sfc-b'], p_limit => 1) limit 1) = 3
  and (select id from public.storefront_cards_page(p_ip_ids => array['sfc-a', 'sfc-b'], p_limit => 1, p_offset => 2)) = 'sfc-c1'
) then 1 else 0 end as assert_cards_page_order_filters_total;

-- id 조회는 보관도 돌려준다 — 보유 행·라인업이 가리키는 카드가 빈칸이 되면 안 된다.
select 1 / case when (
  (select count(*) from public.storefront_cards_by_ids(array['sfc-c1', 'sfc-c3', 'nope'])) = 2
  and (select archived_at is not null from public.storefront_cards_by_ids(array['sfc-c3']))
) then 1 else 0 end as assert_cards_by_ids_keeps_archived;

-- 로그인 전 집계: 보유는 0, signed_in false. (표 전체 기준이라 시드 카드가 섞여도 관계식으로 본다.)
select 1 / case when (
  select owned_cards = 0 and owned_ips = 0 and holo_owned = 0 and signed_in = false
     and total_cards = (select count(*) from public.cards where archived_at is null)
  from public.storefront_binder_overview()
) then 1 else 0 end as assert_overview_anonymous_has_no_ownership;
reset role;

-- ---------------------------------------------------------------------------
-- B. 로그인 집계 — 보관된 보유 카드는 세지 않는다(도감에 없는 칸을 「보유」로 세면 달성률이 100%를 넘는다)
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a01', true);
select 1 / case when (
  select owned_cards = 1 and owned_ips = 1 and holo_owned = 1 and signed_in = true
  from public.storefront_binder_overview()
) then 1 else 0 end as assert_overview_counts_only_live_owned_cards;

select 1 / case when (
  (select total_cards || '/' || owned_cards from public.storefront_binder_ip_progress(array['sfc-a'])) = '2/1'
  and (select total_cards || '/' || owned_cards from public.storefront_binder_ip_progress(array['sfc-b'])) = '1/0'
) then 1 else 0 end as assert_ip_progress_per_ip;
reset role;

-- ---------------------------------------------------------------------------
-- C. 굿즈 검색 — 이름 → IP 이름 → 유형 순, 숨긴 상품 제외, 빈 질의는 빈 결과
-- ---------------------------------------------------------------------------
set local role anon;
select 1 / case when (
  (select pg_catalog.string_agg(id, ',' order by ord)
   from (select id, pg_catalog.row_number() over () as ord from public.storefront_goods_search('파우치')) as page
   where id like 'sfc-%')
  = 'sfc-g-name,sfc-g-ip,sfc-g-type'
  and (select count(*) from public.storefront_goods_search('파우치') where id = 'sfc-g-hidden') = 0
  and (select count(*) from public.storefront_goods_search('   ')) = 0
  and (select filtered_total from public.storefront_goods_search('파우치', p_limit => 1) limit 1)
      = (select count(*) from public.storefront_goods_search('파우치', p_limit => 500))
) then 1 else 0 end as assert_goods_search_rank_hidden_empty;
reset role;

select 1 / case when (
  has_function_privilege('anon', 'public.storefront_cards_page(text[],text,integer,integer)', 'execute')
  and has_function_privilege('anon', 'public.storefront_goods_search(text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.storefront_binder_overview()', 'execute')
  and not has_function_privilege('service_role', 'public.storefront_binder_overview()', 'execute')
  and not has_function_privilege('service_role', 'public.storefront_cards_by_ids(text[])', 'execute')
) then 1 else 0 end as assert_cards_search_acl;

rollback;

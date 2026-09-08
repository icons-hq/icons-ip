\set ON_ERROR_STOP on

-- 규모 슬라이스 ② — 어드민 카탈로그 검색 RPC 5종 (설계서 v2 §1-4 · 보고서 D §7-4 테스트 포인트)

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000871',
    'authenticated', 'authenticated', 'catalog-search-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000872',
    'authenticated', 'authenticated', 'catalog-search-fan@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000871',
    'catalog-search-staff@example.test', 'catalog_search_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000872',
    'catalog-search-fan@example.test', 'catalog_search_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

insert into public.verticals (key, label, color)
values ('admin-cs-test', '카탈로그 검색 테스트', '#000000')
on conflict (key) do nothing;

insert into public.ips (id, title, vertical_key, fans_count)
values
  ('admin-cs-ip-a', '화산귀환 검색 테스트', 'admin-cs-test', 500),
  ('admin-cs-ip-b', 'Alpha Beta', 'admin-cs-test', 900),
  ('admin-cs-ip-z', '보관 IP', 'admin-cs-test', 0)
on conflict (id) do update set title = excluded.title, fans_count = excluded.fans_count;

update public.ips set archived_at = now() where id = 'admin-cs-ip-z';

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('admin-cs-g-a1', 'admin-cs-ip-a', '아크릴 스탠드 100%', '아크릴', 12000, 'ok', 10),
  ('admin-cs-g-a2', 'admin-cs-ip-a', '키링 (부족)', '키링', 8000, 'low', 3),
  ('admin-cs-g-a3', 'admin-cs-ip-a', '품절 인형', '인형', 30000, 'soldout', 5),
  ('admin-cs-g-a4', 'admin-cs-ip-a', '수량 0 쿠션', '쿠션', 15000, 'ok', 0),
  ('admin-cs-g-a5', 'admin-cs-ip-a', '보관 세트', '세트', 50000, 'soldout', 0),
  ('admin-cs-g-b1', 'admin-cs-ip-b', 'under_score item', '문구', 3000, 'ok', 7)
on conflict (id) do nothing;

update public.goods set archived_at = now() where id = 'admin-cs-g-a5';

-- 1,100건 대량 — PostgREST max_rows(1,000) 너머의 행이 RPC 페이지로 닿는지 본다.
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
select
  'admin-cs-bulk-' || lpad(i::text, 4, '0'),
  'admin-cs-ip-a',
  '대량 굿즈 ' || i,
  '파우치',
  1000 + i,
  'ok',
  1
from generate_series(1, 1100) as g(i)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 파생 상태: 보관 › 품절(soldout 또는 수량 0) › 부족 › 판매중
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select list_status from public.goods where id = 'admin-cs-g-a1') = 'selling'
  and (select list_status from public.goods where id = 'admin-cs-g-a2') = 'low'
  and (select list_status from public.goods where id = 'admin-cs-g-a3') = 'soldout'
  and (select list_status from public.goods where id = 'admin-cs-g-a4') = 'soldout'
  and (select list_status from public.goods where id = 'admin-cs-g-a5') = 'archived'
) then 1 else 0 end as assert_list_status_priority;

-- ---------------------------------------------------------------------------
-- ACL: authenticated 만 execute, anon·service_role 거부
-- ---------------------------------------------------------------------------
select 1 / case when (
  not has_function_privilege('anon', 'public.admin_search_goods(text,text,text,text,text,text,text,text,integer,integer,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_goods(text,text,text,text,text,text,text,text,integer,integer,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_goods(text,text,text,text,text,text,text,text,integer,integer,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_goods_tab_counts(text,text,text,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_goods_tab_counts(text,text,text,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_goods_tab_counts(text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_search_ips(text,text,text,text,text,integer,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_search_ips(text,text,text,text,text,integer,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_search_ips(text,text,text,text,text,integer,integer)', 'execute')
  and not has_function_privilege('anon', 'public.admin_ips_tab_counts(text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_ips_tab_counts(text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_ips_tab_counts(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_pick_ips(text,text,integer)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_pick_ips(text,text,integer)', 'execute')
  and not has_function_privilege('service_role', 'public.admin_pick_ips(text,text,integer)', 'execute')
) then 1 else 0 end as assert_catalog_search_rpcs_are_authenticated_only;

-- 일반 회원은 RPC 안에서 거부된다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000872', true);

do $$
begin
  perform count(*) from public.admin_search_goods();
  raise exception 'member must not search goods';
exception when insufficient_privilege then null;
end $$;

do $$
begin
  perform count(*) from public.admin_pick_ips();
  raise exception 'member must not pick ips';
exception when insufficient_privilege then null;
end $$;

-- 스태프
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000871', true);

-- 인자 검증: 화이트리스트 밖은 check_violation
do $$
begin
  perform count(*) from public.admin_search_goods(p_tab => 'nope');
  raise exception 'invalid tab must fail';
exception when check_violation then null;
end $$;

do $$
begin
  perform count(*) from public.admin_search_goods(p_sort => 'id; drop table public.goods');
  raise exception 'sort key outside whitelist must fail';
exception when check_violation then null;
end $$;

do $$
begin
  perform count(*) from public.admin_search_goods(p_dir => 'sideways');
  raise exception 'invalid direction must fail';
exception when check_violation then null;
end $$;

do $$
begin
  perform count(*) from public.admin_search_goods(p_query => repeat('a', 101));
  raise exception 'query over 100 chars must fail';
exception when check_violation then null;
end $$;

do $$
begin
  perform count(*) from public.admin_search_ips(p_sort => 'fans_count desc');
  raise exception 'ip sort key outside whitelist must fail';
exception when check_violation then null;
end $$;

-- limit 클램프: 0 → 1, 999 → 200. offset 이 총 건수를 넘으면 0행.
select 1 / case when (
  (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_limit => 0)) = 1
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_limit => 999)) = 200
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_offset => 100000)) = 0
) then 1 else 0 end as assert_limit_offset_clamp;

-- 1,001번째 행이 닿는다: 판매중 1,101건 중 offset 1,000 → 101행, total_count 는 페이지와 무관.
select 1 / case when (
  (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_tab => 'selling', p_limit => 200, p_offset => 1000)) = 101
  and (select max(total_count) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_tab => 'selling', p_limit => 1)) = 1101
) then 1 else 0 end as assert_rows_beyond_1000_are_reachable;

-- 탭 건수 = 검색·필터 적용, 탭 미적용. 합이 전체와 같다.
select 1 / case when (
  select all_count = 1105 and selling_count = 1101 and low_count = 1 and soldout_count = 2 and archived_count = 1
    and selling_count + low_count + soldout_count + archived_count = all_count
  from public.admin_goods_tab_counts(p_ip_id => 'admin-cs-ip-a')
) then 1 else 0 end as assert_goods_tab_counts;

-- 탭·재고 필터
select 1 / case when (
  (select string_agg(id, ',' order by id) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_tab => 'soldout')) = 'admin-cs-g-a3,admin-cs-g-a4'
  and (select string_agg(id, ',' order by id) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_stock => 'zero')) = 'admin-cs-g-a4,admin-cs-g-a5'
  and (select string_agg(id, ',' order by id) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_stock => 'soldout')) = 'admin-cs-g-a3,admin-cs-g-a5'
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_type => '키링')) = 1
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_type => '없는유형')) = 0
) then 1 else 0 end as assert_goods_tab_and_stock_filters;

-- 정렬: 가격 내림차순 1위 = 보관 세트(50,000) · 수량 내림차순 1위 = a1(10) · 같은 값은 id 순(a4 → a5)
select 1 / case when (
  (select id from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_sort => 'price', p_dir => 'desc', p_limit => 1)) = 'admin-cs-g-a5'
  and (select id from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_sort => 'stock_qty', p_dir => 'desc', p_limit => 1)) = 'admin-cs-g-a1'
  and (select string_agg(id, ',') from (
        select id from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_sort => 'stock_qty', p_dir => 'asc', p_limit => 2)
      ) as first_two) = 'admin-cs-g-a4,admin-cs-g-a5'
  and (select id from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_sort => 'ip', p_dir => 'asc', p_limit => 1)) = 'admin-cs-bulk-0001'
) then 1 else 0 end as assert_goods_sort_and_tiebreak;

-- 검색: 특수문자는 리터럴 · 필드 한정 · 2자 한글 부분 일치 · NFD 입력이 NFC 행과 일치
select 1 / case when (
  -- 로컬 seed 굿즈가 섞이므로 검색 결과는 이 테스트의 행(admin-cs-*)만 센다.
  (select string_agg(id, ',') from public.admin_search_goods(p_query => '100%') where id like 'admin-cs-%') = 'admin-cs-g-a1'
  and (select string_agg(id, ',') from public.admin_search_goods(p_query => '_score') where id like 'admin-cs-%') = 'admin-cs-g-b1'
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_field => 'name', p_query => '키링')) = 1
  and (select count(*) from public.admin_search_goods(p_field => 'id', p_query => 'admin-cs-g-a')) = 5
  and (select max(total_count) from public.admin_search_goods(p_field => 'ip', p_query => '귀환', p_limit => 1)) = 1105
  and (select max(total_count) from public.admin_search_goods(p_field => 'ip', p_query => normalize('화산', NFD), p_limit => 1)) = 1105
  and (select max(total_count) from public.admin_search_goods(p_field => 'ip', p_query => 'ADMIN-CS-IP-B', p_limit => 1)) = 1
  and (select count(*) from public.admin_search_goods(p_ip_id => 'admin-cs-ip-a', p_field => 'name', p_query => '귀환')) = 0
) then 1 else 0 end as assert_goods_search_semantics;

-- IP 목록: 굿즈 수(보관 포함 / 활성) · 버티컬 라벨 · 정렬 · 탭 건수
select 1 / case when (
  (select goods_count = 1105 and active_goods_count = 1104 and vertical_label = '카탈로그 검색 테스트' and total_count = 3
     from public.admin_search_ips(p_query => 'admin-cs') where id = 'admin-cs-ip-a')
  and (select id from public.admin_search_ips(p_query => 'admin-cs', p_sort => 'goods', p_dir => 'desc', p_limit => 1)) = 'admin-cs-ip-a'
  and (select id from public.admin_search_ips(p_query => 'admin-cs', p_sort => 'fans', p_dir => 'desc', p_limit => 1)) = 'admin-cs-ip-b'
  and (select id from public.admin_search_ips(p_query => 'admin-cs', p_sort => 'title', p_dir => 'asc', p_limit => 1)) = 'admin-cs-ip-b'
  and (select count(*) from public.admin_search_ips(p_query => 'admin-cs', p_tab => 'archived')) = 1
  and (select count(*) from public.admin_search_ips(p_vertical => 'admin-cs-test', p_tab => 'active')) = 2
  and (select all_count = 3 and active_count = 2 and archived_count = 1 from public.admin_ips_tab_counts(p_query => 'admin-cs')) 
) then 1 else 0 end as assert_ip_list_semantics;

-- 선택기: 보관 IP 기본 제외 · 선택된 IP 는 보관이어도 첫 행 · 접두 일치가 부분 일치보다 앞 · 검색어 없으면 팬 순
select 1 / case when (
  (select count(*) from public.admin_pick_ips(p_query => 'admin-cs') where id = 'admin-cs-ip-z') = 0
  and (select id from public.admin_pick_ips(p_query => 'admin-cs', p_limit => 1)) = 'admin-cs-ip-b'
  and (select rank from public.admin_pick_ips(p_query => 'admin-cs', p_selected_id => 'admin-cs-ip-z') where id = 'admin-cs-ip-z') = 0
  and (select id from public.admin_pick_ips(p_query => 'admin-cs', p_selected_id => 'admin-cs-ip-z', p_limit => 1)) = 'admin-cs-ip-z'
  and (select id || ':' || rank from public.admin_pick_ips(p_query => 'alp', p_limit => 1)) = 'admin-cs-ip-b:1'
  and (select id || ':' || rank from public.admin_pick_ips(p_query => 'beta', p_limit => 1)) = 'admin-cs-ip-b:2'
  and (select count(*) from public.admin_pick_ips(p_limit => 999)) <= 50
  and (select bool_and(rank = 3 and archived_at is null) from public.admin_pick_ips()) 
) then 1 else 0 end as assert_ip_picker_semantics;

-- 바코드 축 (현업 슬라이스 5 마무리 — 「굿즈 조회: 상품번호·바코드·상품명」).
-- 열만 있고 검색 축이 없으면 적어 둔 값이 아무 일도 하지 않는다.
reset role;
update public.goods set barcode = '8801234567890' where id = 'admin-cs-g-a1';
set local role authenticated;
select 1 / case when (
  (select id from public.admin_search_goods(p_field => 'barcode', p_query => '8801234567890')) = 'admin-cs-g-a1'
  -- 전체 검색에도 걸린다: 스캐너로 찍은 값을 그대로 붙여 넣는다.
  and (select id from public.admin_search_goods(p_query => '8801234567890')) = 'admin-cs-g-a1'
  -- 이름 축으로 고르면 바코드는 안 걸린다 — 축을 골랐으면 그 축만 본다.
  and (select count(*) from public.admin_search_goods(p_field => 'name', p_query => '8801234567890')) = 0
  -- 목록과 탭 집계가 같은 조건을 본다. 한쪽만 고치면 「검색하면 나오는데 탭 수는 0」이 된다.
  and (select all_count from public.admin_goods_tab_counts(p_field => 'barcode', p_query => '8801234567890')) = 1
) then 1 else 0 end as assert_goods_barcode_search_axis;

-- anon 은 거부
reset role;
set local role anon;
do $$
begin
  perform count(*) from public.admin_search_goods();
  raise exception 'anon must not search goods';
exception when insufficient_privilege then null;
end $$;

reset role;

rollback;

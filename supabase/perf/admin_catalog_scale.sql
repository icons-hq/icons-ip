\set ON_ERROR_STOP on
\timing on
-- 규모 검증 — 1만 IP + 5만 굿즈를 트랜잭션 안에서 심고 RPC 지연·실행 계획을 본 뒤 되돌린다.
-- 실행: scratchpad/db.sh < supabase/perf/admin_catalog_scale.sql (로컬 전용, 기본 seed 에 넣지 않는다)
begin;

insert into public.verticals (key, label, color) values ('perf', '규모 테스트', '#000000') on conflict (key) do nothing;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('00000000-0000-4000-8000-000000000108', 'authenticated', 'authenticated', 'perf-staff@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;
insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values ('00000000-0000-4000-8000-000000000108', 'perf-staff@example.test', 'perf_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff')
on conflict (id) do update set role = excluded.role;

\echo '--- seed 10,000 ips'
insert into public.ips (id, title, vertical_key, sub, fans_count)
select 'perf-ip-' || lpad(i::text, 5, '0'),
       (array['화산','귀환','달빛','조각사','전지적','독자','나혼자','레벨업'])[1 + (i % 8)] || ' ' ||
       (array['시점','귀환','기록','연대기','외전','시즌2'])[1 + (i % 6)] || ' ' || i,
       'perf', '테스트', (i * 7919) % 100000
from generate_series(1, 10000) as g(i);

\echo '--- seed 50,000 goods (row triggers run)'
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
select 'perf-g-' || lpad(i::text, 6, '0'), 'perf-ip-' || lpad((1 + (i % 10000))::text, 5, '0'),
       (array['아크릴 스탠드','포토카드','키링','엽서 세트','쿠션','파우치'])[1 + (i % 6)] || ' ' || i,
       (array['피규어','인형','키링','아크릴','문구','쿠션','파우치','세트'])[1 + (i % 8)],
       (1 + (i % 40)) * 1000,
       case when i % 17 = 0 then 'soldout' when i % 5 = 0 then 'low' else 'ok' end,
       case when i % 17 = 0 then 0 else 1 + (i % 50) end
from generate_series(1, 50000) as g(i);

analyze public.ips;
analyze public.goods;

select (select count(*) from public.goods) as goods, (select count(*) from public.ips) as ips;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000108', true);

\echo '--- RPC timings (staff) — 목록 1페이지 / 마지막 페이지 / 탭 건수 / 이름 2자 검색 / 코드 접두 / IP 선택기'
select count(*) from public.admin_search_goods(p_limit => 20);
select count(*) from public.admin_search_goods(p_limit => 20);
select count(*) from public.admin_search_goods(p_limit => 200, p_offset => 49800);
select * from public.admin_goods_tab_counts();
select count(*) from public.admin_search_goods(p_field => 'name', p_query => '포토', p_limit => 20);
select count(*) from public.admin_search_goods(p_field => 'name', p_query => '포토', p_limit => 20);
select count(*) from public.admin_search_goods(p_field => 'id', p_query => 'perf-g-0100', p_limit => 20);
select count(*) from public.admin_search_goods(p_tab => 'soldout', p_sort => 'price', p_dir => 'desc', p_limit => 20);
select count(*) from public.admin_search_goods(p_ip_id => 'perf-ip-00042', p_limit => 20);
select count(*) from public.admin_search_ips(p_sort => 'goods', p_dir => 'desc', p_limit => 20);
select count(*) from public.admin_search_ips(p_sort => 'goods', p_dir => 'desc', p_limit => 20);
select * from public.admin_ips_tab_counts();
select count(*) from public.admin_pick_ips(p_query => '달');
select count(*) from public.admin_pick_ips(p_query => '달');
select count(*) from public.admin_pick_ips();

reset role;

\echo '--- EXPLAIN: 이름 검색(trgm) / 탭+IP / 마지막 페이지 정렬'
explain (analyze, buffers, summary off, timing off)
select goods.id, count(*) over() from public.goods join public.ips on ips.id = goods.ip_id
where goods.name ilike '%포토%' escape '\' order by goods.id limit 20;

explain (analyze, buffers, summary off, timing off)
select goods.id, count(*) over() from public.goods join public.ips on ips.id = goods.ip_id
where goods.list_status = 'soldout' order by goods.price desc, goods.id limit 20;

explain (analyze, buffers, summary off, timing off)
select goods.id from public.goods join public.ips on ips.id = goods.ip_id order by goods.id limit 200 offset 49800;

rollback;

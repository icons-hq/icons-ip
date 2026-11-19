\set ON_ERROR_STOP on
-- 스펙 C §4.2: 카테고리 전시 목록 정렬에 인기도순·판매량순·리뷰 많은순을 더한다. Rollback-only.
-- 같은 psql 세션에서 helpers/goods_kc_fixture.sql 을 앞에 붙여 실행한다.
-- 고정하는 것: 세 정렬이 받아들여지고 이름이 다른 정렬은 지금처럼 거절되는 것, 원수치(최근 30일 판매+위시 / 누적 판매 / 공개 리뷰)
-- 기준 순서와 동률이 구성 순서로 떨어지는 것, 기존 정렬·필터·미리보기·공개 ACL 불변, 원수치 헬퍼가 앱 롤에 열리지 않는 것.
begin;

create function pg_temp.cl_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'category listing sort assertion: %', label; end if; end $$;
create function pg_temp.cl_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-0000000176'||lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.cl_query(extra jsonb default '{}') returns jsonb language sql immutable as $$
  select '{"ips":[],"types":[],"min":null,"max":null,"sort":"recommended"}'::jsonb || extra $$;
create function pg_temp.cl_ids(page jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(item->>'id' order by ordinality), '{}') from jsonb_array_elements(page->'rows') with ordinality as rows(item, ordinality) $$;

-- 사용자: 1 = 운영자(전시 저장), 2 = 구매자, 3~5 = 위시·리뷰 작성자.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.cl_uid(n), 'authenticated', 'authenticated', 'category-sorts-' || n || '@example.test', now(), '{}', '{}' from generate_series(1, 5) n;
update public.profiles set role = 'staff' where id = pg_temp.cl_uid(1);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.cl_uid(1), 'primary');
update private.operator_access_state set configured = true where id;
update public.category_activation_control set customer_enabled = true where id = 'catalog';

insert into public.catalog_categories(id, code, name, parent_id, sort_order) values (pg_temp.cl_uid(10), 'cl-sort-source', '정렬 검증 원천', null, 0);
insert into public.ips(id, title, vertical_key, published_at) values ('cl-ip', '전시 정렬 검증 IP', 'character', now());
insert into public.goods(id, ip_id, name, price, stock, stock_qty, category_id, created_at)
select 'cl-' || n, 'cl-ip', '전시 정렬 ' || n, 1000 * n, 'ok', 100, pg_temp.cl_uid(10),
 timestamptz '2026-03-01 00:00:00+00' + (n || ' days')::interval
from generate_series(1, 6) n;
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select ('47c47700' || left(md5(id), 24))::uuid, 'authenticated', 'authenticated', 'kc-cl-' || md5(id) || '@example.test', now(), '{"testFixture":"goods-kc"}', '{}'
from public.goods where id like 'cl-%';
insert into private.operator_memberships(profile_id, manager_role)
select ('47c47700' || left(md5(id), 24))::uuid, 'primary' from public.goods where id like 'cl-%';
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'cl-%';

-- 합성 주문 원장: 사용자 2 의 결제 승인 주문.
create function pg_temp.cl_order(target integer, good_key text, quantity integer, approved timestamptz) returns uuid language plpgsql as $$
declare purchase uuid := ('10000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
 payment uuid := ('20000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
 attempt uuid := ('30000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
begin
 insert into public.orders(id, user_id, status, total, address, created_at, payment_method)
 values(purchase, pg_temp.cl_uid(2), 'paid', quantity::bigint * 1000, '{}', now() - interval '90 days', 'card');
 insert into public.order_items(order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot)
 select purchase, 'cl-' || good_key, id, quantity, 1000, '합성 집계 상품', 'cl-ip'
 from public.goods_variants where good_id = 'cl-' || good_key and is_default;
 insert into public.payments(id, user_id, purpose, ref_id, provider, amount, status, idempotency_key)
 values(payment, pg_temp.cl_uid(2), 'order', purchase, 'korpay', quantity::bigint * 1000, 'paid', 'cl-payment-' || target);
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values(attempt, 'korpay', pg_temp.cl_uid(2), 'order', purchase, quantity::bigint * 1000, 'approved', 'cl-attempt-' || target,
  'cl-order-' || target, 'cl-product-' || target, payment, now() + interval '10 minutes');
 insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, approved_at) values(attempt, 'confirm', approved);
 return purchase;
end $$;
select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as cl_today \gset
select pg_temp.cl_order(1, '1', 5, :'cl_today'::timestamptz - interval '3 days');
select pg_temp.cl_order(2, '2', 1, :'cl_today'::timestamptz - interval '3 days');
select pg_temp.cl_order(3, '3', 50, :'cl_today'::timestamptz - interval '40 days');
-- cl-2 는 위시 3개, cl-4 는 리뷰 2개, cl-5 는 리뷰 1개(숨김 리뷰 1개는 세지 않는다).
insert into public.wishlists(user_id, good_id) select pg_temp.cl_uid(n), 'cl-2' from generate_series(3, 5) n;
insert into public.reviews(user_id, good_id, order_id, rating, body) values
 (pg_temp.cl_uid(3), 'cl-4', '10000000-0000-4000-8000-000000000001', 5, '합성 공개 리뷰 일'),
 (pg_temp.cl_uid(4), 'cl-4', '10000000-0000-4000-8000-000000000001', 4, '합성 공개 리뷰 이'),
 (pg_temp.cl_uid(3), 'cl-5', '10000000-0000-4000-8000-000000000001', 5, '합성 공개 리뷰 삼');
insert into public.reviews(user_id, good_id, order_id, rating, body, status, hidden_reason, hidden_at) values
 (pg_temp.cl_uid(4), 'cl-5', '10000000-0000-4000-8000-000000000001', 1, '합성 숨김 리뷰 사', 'hidden', '합성 검수', now());

-- 전시 노드: 위 원천 분류의 상품 6개를 구성 순서(진열 순서·자연 키 = cl-1 … cl-6)로 보여 주는 공개 전시.
insert into private.category_display_nodes(id, parent_id, name, sort_order) values (pg_temp.cl_uid(20), null, '정렬 전시', 0);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cl_uid(1)::text, true);
do $$ declare v jsonb; begin
 v := public.admin_get_category_display(pg_temp.cl_uid(20))->'values';
 perform public.admin_save_category_display(pg_temp.cl_uid(20), v || jsonb_build_object('enabled', true, 'categoryIds', jsonb_build_array(pg_temp.cl_uid(10))), 0, gen_random_uuid());
end $$;
reset role;

-- 선언 단언: 앱 롤이 private 정렬 함수와 원수치 헬퍼를 직접 실행할 수 없고, 공개 래퍼의 ACL 은 그대로다.
select pg_temp.cl_assert(
 (select bool_and(not has_function_privilege(r, 'private.category_display_page(uuid,jsonb,jsonb,integer,text,bigint)', 'execute')
   and not has_function_privilege(r, 'private.goods_listing_metrics()', 'execute'))
  from unnest(array['anon', 'authenticated', 'service_role']) r)
 and has_function_privilege('anon', 'public.get_category_display_page(uuid,jsonb,integer,text)', 'execute')
 and has_function_privilege('authenticated', 'public.get_category_display_page(uuid,jsonb,integer,text)', 'execute')
 and not has_function_privilege('service_role', 'public.get_category_display_page(uuid,jsonb,integer,text)', 'execute'),
 'sort helpers stay sealed and the public wrapper keeps its ACL');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ declare page jsonb; seen text;
begin
 -- 기존 정렬은 그대로: 추천 = 구성 순서, 가격·최신 불변.
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query());
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-1', 'cl-2', 'cl-3', 'cl-4', 'cl-5', 'cl-6'], 'recommended keeps the composition order: ' || array_to_string(pg_temp.cl_ids(page), ','));
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"price_desc"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-6', 'cl-5', 'cl-4', 'cl-3', 'cl-2', 'cl-1'], 'price descending is unchanged');
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"newest"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-6', 'cl-5', 'cl-4', 'cl-3', 'cl-2', 'cl-1'], 'newest is unchanged');

 -- 인기도순 = 최근 30일 판매 + 위시: cl-1(5)·cl-2(1+3=4), 30일 밖 판매·리뷰만 있는 굿즈는 0 점이라 구성 순서로 뒤에 온다.
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"popular"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-1', 'cl-2', 'cl-3', 'cl-4', 'cl-5', 'cl-6'], 'popular: 30 day sales plus wishes, ties in composition order: ' || array_to_string(pg_temp.cl_ids(page), ','));
 -- 판매량순 = 누적 판매: 30일 밖 50개가 맨 위.
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"sales"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-3', 'cl-1', 'cl-2', 'cl-4', 'cl-5', 'cl-6'], 'sales: total effective quantity: ' || array_to_string(pg_temp.cl_ids(page), ','));
 -- 리뷰 많은순 = 공개 리뷰 수(숨김 제외): cl-4(2) → cl-5(1, 숨김은 세지 않는다) → 나머지는 구성 순서.
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"reviews"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-4', 'cl-5', 'cl-1', 'cl-2', 'cl-3', 'cl-6'], 'reviews: visible review count: ' || array_to_string(pg_temp.cl_ids(page), ','));

 -- 필터와 함께: 가격 필터가 걸러도 정렬은 남은 굿즈 안에서 같은 기준이다. 합계 필드는 정렬과 무관하다.
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"sales","max":5000}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-3', 'cl-1', 'cl-2', 'cl-4', 'cl-5'] and page->>'filteredTotal' = '5' and page->>'total' = '6', 'filters compose with the new sorts');
 page := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"reviews","min":3000,"max":5000}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-4', 'cl-5', 'cl-3'], 'price range plus reviews sort: ' || array_to_string(pg_temp.cl_ids(page), ','));

 -- 조회 토큰은 정렬 이름이 질의에 들어 있어 정렬마다 다르고, 같은 정렬·같은 토큰이면 통과한다(세 정렬은 순위가 아니라 구성을 해시한다 — category_display_metric_sort_token.sql).
 perform pg_temp.cl_assert((public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"sales"}'))->>'token')
  is distinct from (public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"popular"}'))->>'token'), 'token differs per sort');
 seen := public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"popular"}'))->>'token';
 perform public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"popular"}'), 0, seen);
 -- 나머지 필드(전체 건수·가격 상한·배너 슬롯)는 정렬과 무관하다.
 perform pg_temp.cl_assert((public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"reviews"}')) - 'rows' - 'token')
  = (public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query()) - 'rows' - 'token'), 'only rows and token depend on the sort');

end $$;
reset role;

-- 거절: 허용 목록에 없는 정렬 이름·대소문자·빈 문자열·숫자 타입.
do $$ declare bad text; got text;
begin
 foreach bad in array array['rating', 'Popular', 'POPULAR', 'sales ', '', 'name', 'popular;'] loop
  got := null;
  begin perform public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query(jsonb_build_object('sort', bad)));
  exception when invalid_parameter_value then got := sqlerrm; end;
  if got is distinct from 'invalid_category_display_query' then raise exception 'unknown sort "%" returned %', bad, coalesce(got, 'success'); end if;
 end loop;
 begin perform public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":3}'));
  raise exception 'numeric sort accepted';
 exception when invalid_parameter_value then null; end;
end $$;

-- 운영자 미리보기(저장 전 구성)도 같은 정렬 규칙을 쓴다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cl_uid(1)::text, true);
do $$ declare v jsonb; page jsonb;
begin
 v := public.admin_get_category_display(pg_temp.cl_uid(20))->'values';
 page := public.admin_preview_category_display(pg_temp.cl_uid(20), v, pg_temp.cl_query('{"sort":"sales"}'));
 perform pg_temp.cl_assert(pg_temp.cl_ids(page) = array['cl-3', 'cl-1', 'cl-2', 'cl-4', 'cl-5', 'cl-6'], 'operator preview sorts by sales too');
 begin perform public.admin_preview_category_display(pg_temp.cl_uid(20), v, pg_temp.cl_query('{"sort":"rating"}'));
  raise exception 'preview accepted unknown sort';
 exception when invalid_parameter_value then null; end;
end $$;
reset role;

-- 수동 구성(mode=manual)에서도 같은 정렬이 구성 순서를 동률 기준으로 쓴다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.cl_uid(1)::text, true);
select public.admin_save_category_display(pg_temp.cl_uid(20),
 (public.admin_get_category_display(pg_temp.cl_uid(20))->'values') || '{"mode":"manual","goodIds":["cl-6","cl-5","cl-1","cl-4"]}'::jsonb,
 (public.admin_get_category_display(pg_temp.cl_uid(20))->>'revision')::bigint, gen_random_uuid()) is not null as manual_saved;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.cl_assert(pg_temp.cl_ids(public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query())) = array['cl-6', 'cl-5', 'cl-1', 'cl-4'], 'manual recommended order is the configured order');
select pg_temp.cl_assert(pg_temp.cl_ids(public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"popular"}'))) = array['cl-1', 'cl-6', 'cl-5', 'cl-4'],
 'manual popular: metric first, ties in configured order');
select pg_temp.cl_assert(pg_temp.cl_ids(public.get_category_display_page(pg_temp.cl_uid(20), pg_temp.cl_query('{"sort":"reviews"}'))) = array['cl-4', 'cl-5', 'cl-6', 'cl-1'],
 'manual reviews: metric first, ties in configured order');
reset role;

rollback;

\set ON_ERROR_STOP on
-- PR2 리뷰 C M1: 카테고리 전시 인기도순·판매량순·리뷰 많은순의 VIEW MORE 조회 토큰. Rollback-only.
-- 같은 psql 세션에서 helpers/goods_kc_fixture.sql 을 앞에 붙여 실행한다.
-- 고정하는 것: 세 정렬은 위시·판매·리뷰가 순위를 바꿔도 첫 페이지 토큰으로 둘째 페이지가 이어지고(구성 해시),
-- 구성(굿즈 가격·재고·수정 시각, 굿즈 집합)이 바뀌면 지금처럼 PT409 인 것, 추천순 등 다른 정렬은 순서가 바뀌면 PT409 인 것(불변).
begin;

create function pg_temp.mt_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'metric sort token assertion: %', label; end if; end $$;
create function pg_temp.mt_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-0000000178'||lpad(n::text, 2, '0'))::uuid $$;
create function pg_temp.mt_query(sort text) returns jsonb language sql immutable as $$
  select jsonb_build_object('ips', '[]'::jsonb, 'types', '[]'::jsonb, 'min', null, 'max', null, 'sort', sort) $$;
create function pg_temp.mt_ids(page jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(item->>'id' order by ordinality), '{}') from jsonb_array_elements(page->'rows') with ordinality as rows(item, ordinality) $$;
create function pg_temp.mt_head(page jsonb) returns text language sql immutable as $$
  select array_to_string((pg_temp.mt_ids(page))[1:3], ',') $$;
-- 둘째 페이지(offset 20)를 첫 페이지 토큰으로 읽는다: 성공이면 'ok <행 수>', 아니면 SQLSTATE 와 메시지.
create function pg_temp.mt_more(sort text, tok text) returns text language plpgsql as $$
declare page jsonb;
begin
 page := public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query(sort), 20, tok);
 return 'ok ' || jsonb_array_length(page->'rows');
exception when others then return sqlstate || ' ' || sqlerrm;
end $$;

-- 사용자: 1 = 운영자(전시 저장), 2 = 구매자·리뷰어, 3~4 = 위시.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.mt_uid(n), 'authenticated', 'authenticated', 'metric-token-' || n || '@example.test', now(), '{}', '{}' from generate_series(1, 4) n;
update public.profiles set role = 'staff' where id = pg_temp.mt_uid(1);
insert into private.operator_memberships(profile_id, manager_role) values (pg_temp.mt_uid(1), 'primary');
update private.operator_access_state set configured = true where id;
update public.category_activation_control set customer_enabled = true where id = 'catalog';

-- 굿즈 25개(= 첫 페이지 20 + 둘째 페이지 5). 구성 순서·id 순서 = mt-01 … mt-25.
insert into public.catalog_categories(id, code, name, parent_id, sort_order) values (pg_temp.mt_uid(10), 'mt-token-source', '정렬 토큰 원천', null, 0);
insert into public.ips(id, title, vertical_key, published_at) values ('mt-ip', '정렬 토큰 IP', 'character', now());
insert into public.goods(id, ip_id, name, price, stock, stock_qty, category_id, created_at, display_order)
select 'mt-' || lpad(n::text, 2, '0'), 'mt-ip', '정렬 토큰 상품 ' || n, 1000 + n, 'ok', 100, pg_temp.mt_uid(10),
 timestamptz '2026-03-01 00:00:00+00' + (n || ' days')::interval, n
from generate_series(1, 25) n;
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select ('47c47700' || left(md5(id), 24))::uuid, 'authenticated', 'authenticated', 'kc-mt-' || md5(id) || '@example.test', now(), '{"testFixture":"goods-kc"}', '{}'
from public.goods where id like 'mt-%';
insert into private.operator_memberships(profile_id, manager_role)
select ('47c47700' || left(md5(id), 24))::uuid, 'primary' from public.goods where id like 'mt-%';
select count(*) as published_goods from (select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'mt-%') s \gset
select pg_temp.mt_assert(:published_goods = 25, 'the 25 synthetic goods are published');

-- 합성 주문 원장: 사용자 2 의 결제 승인 주문(판매량순 변화용).
create function pg_temp.mt_order(target integer, good_key text, quantity integer, approved timestamptz) returns uuid language plpgsql as $$
declare purchase uuid := ('10000000-0000-4000-8000-' || lpad((target + 700)::text, 12, '0'))::uuid;
 payment uuid := ('20000000-0000-4000-8000-' || lpad((target + 700)::text, 12, '0'))::uuid;
 attempt uuid := ('30000000-0000-4000-8000-' || lpad((target + 700)::text, 12, '0'))::uuid;
begin
 insert into public.orders(id, user_id, status, total, address, created_at, payment_method)
 values(purchase, pg_temp.mt_uid(2), 'paid', quantity::bigint * 1000, '{}', now() - interval '90 days', 'card');
 insert into public.order_items(order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot)
 select purchase, 'mt-' || good_key, id, quantity, 1000, '합성 집계 상품', 'mt-ip'
 from public.goods_variants where good_id = 'mt-' || good_key and is_default;
 insert into public.payments(id, user_id, purpose, ref_id, provider, amount, status, idempotency_key)
 values(payment, pg_temp.mt_uid(2), 'order', purchase, 'korpay', quantity::bigint * 1000, 'paid', 'mt-payment-' || target);
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values(attempt, 'korpay', pg_temp.mt_uid(2), 'order', purchase, quantity::bigint * 1000, 'approved', 'mt-attempt-' || target,
  'mt-order-' || target, 'mt-product-' || target, payment, now() + interval '10 minutes');
 insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, approved_at) values(attempt, 'confirm', approved);
 return purchase;
end $$;
select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as mt_today \gset
-- 첫 주문(mt-01 5개, 사흘 전)은 모든 정렬의 기준 데이터가 되고 리뷰의 order_id 로도 쓴다.
select pg_temp.mt_order(1, '01', 5, :'mt_today'::timestamptz - interval '3 days') as mt_first_order \gset

-- 전시 노드: 원천 분류의 25개를 구성 순서(진열 순서·자연 키 = mt-01 … mt-25)로 보여 주는 공개 전시.
insert into private.category_display_nodes(id, parent_id, name, sort_order) values (pg_temp.mt_uid(20), null, '정렬 토큰 전시', 0);
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.mt_uid(1)::text, true);
do $$ declare v jsonb; begin
 v := public.admin_get_category_display(pg_temp.mt_uid(20))->'values';
 perform public.admin_save_category_display(pg_temp.mt_uid(20), v || jsonb_build_object('enabled', true, 'categoryIds', jsonb_build_array(pg_temp.mt_uid(10))), 0, gen_random_uuid());
end $$;
reset role;

-- 1) 비회원이 네 정렬의 첫 페이지를 읽어 토큰을 받는다. 첫 순위도 함께 적어 둔다.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('recommended')) as first_recommended \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('popular')) as first_popular \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('sales')) as first_sales \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('reviews')) as first_reviews \gset
reset role;
select pg_temp.mt_assert(
 (:'first_popular'::jsonb)->>'nextOffset' = '20' and (:'first_sales'::jsonb)->>'nextOffset' = '20' and (:'first_reviews'::jsonb)->>'nextOffset' = '20'
 and (:'first_recommended'::jsonb)->>'filteredTotal' = '25', 'every sort has a second page');
select pg_temp.mt_assert(
 pg_temp.mt_head(:'first_recommended'::jsonb) = 'mt-01,mt-02,mt-03' and pg_temp.mt_head(:'first_popular'::jsonb) = 'mt-01,mt-02,mt-03'
 and pg_temp.mt_head(:'first_sales'::jsonb) = 'mt-01,mt-02,mt-03' and pg_temp.mt_head(:'first_reviews'::jsonb) = 'mt-01,mt-02,mt-03',
 'first pages start in composition order before any change');
select (:'first_recommended'::jsonb)->>'token' as tok_recommended, (:'first_popular'::jsonb)->>'token' as tok_popular,
 (:'first_sales'::jsonb)->>'token' as tok_sales, (:'first_reviews'::jsonb)->>'token' as tok_reviews \gset

-- 2) 원수치가 움직인다: 위시(인기도) · 새 결제(판매량) · 새 공개 리뷰. 마지막 굿즈들이 맨 위로 올라와 첫 20개 구성이 통째로 바뀐다.
insert into public.wishlists(user_id, good_id) values (pg_temp.mt_uid(3), 'mt-25'), (pg_temp.mt_uid(4), 'mt-25');
select pg_temp.mt_order(2, '24', 9, :'mt_today'::timestamptz - interval '3 days');
insert into public.reviews(user_id, good_id, order_id, rating, body) values (pg_temp.mt_uid(3), 'mt-23', :'mt_first_order'::uuid, 5, '합성 공개 리뷰 토큰');

set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('popular')) as moved_popular \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('sales')) as moved_sales \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('reviews')) as moved_reviews \gset
select pg_temp.mt_more('popular', :'tok_popular') as more_popular, pg_temp.mt_more('sales', :'tok_sales') as more_sales,
 pg_temp.mt_more('reviews', :'tok_reviews') as more_reviews, pg_temp.mt_more('recommended', :'tok_recommended') as more_recommended \gset
reset role;
-- 순위는 실제로 움직였다(그래서 예전 토큰은 어긋났다).
select pg_temp.mt_assert(
 (pg_temp.mt_ids(:'moved_popular'::jsonb))[1] = 'mt-24' and pg_temp.mt_head(:'moved_popular'::jsonb) = 'mt-24,mt-01,mt-25' and (pg_temp.mt_ids(:'moved_sales'::jsonb))[1] = 'mt-24' and (pg_temp.mt_ids(:'moved_reviews'::jsonb))[1] = 'mt-23'
 and pg_temp.mt_ids(:'moved_popular'::jsonb) is distinct from pg_temp.mt_ids(:'first_popular'::jsonb)
 and pg_temp.mt_ids(:'moved_sales'::jsonb) is distinct from pg_temp.mt_ids(:'first_sales'::jsonb)
 and pg_temp.mt_ids(:'moved_reviews'::jsonb) is distinct from pg_temp.mt_ids(:'first_reviews'::jsonb),
 'the metric changes reordered the first page of all three sorts: ' || pg_temp.mt_head(:'moved_popular'::jsonb)
  || ' / ' || pg_temp.mt_head(:'moved_sales'::jsonb) || ' / ' || pg_temp.mt_head(:'moved_reviews'::jsonb));
-- 같은 구성이므로 토큰이 그대로고, 첫 페이지 토큰으로 둘째 페이지(남은 5개)가 이어진다.
select pg_temp.mt_assert(
 (:'moved_popular'::jsonb)->>'token' = :'tok_popular' and (:'moved_sales'::jsonb)->>'token' = :'tok_sales' and (:'moved_reviews'::jsonb)->>'token' = :'tok_reviews',
 'metric sort tokens do not depend on the ranking');
select pg_temp.mt_assert(:'more_popular' = 'ok 5', 'popular page two after a wish: ' || :'more_popular');
select pg_temp.mt_assert(:'more_sales' = 'ok 5', 'sales page two after a new paid order: ' || :'more_sales');
select pg_temp.mt_assert(:'more_reviews' = 'ok 5', 'reviews page two after a new public review: ' || :'more_reviews');
-- 추천순은 원수치와 무관한 순서라 그대로 통과한다.
select pg_temp.mt_assert(:'more_recommended' = 'ok 5', 'recommended page two is unaffected by metrics: ' || :'more_recommended');

-- 3) 구성이 바뀌면 지금처럼 PT409 다: 굿즈 가격(재고·수정 시각도 같은 지문 항목).
update public.goods_variants set price = price + 500 where good_id = 'mt-10' and is_default;
update public.goods set price = price + 500 where id = 'mt-10';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.mt_more('popular', :'tok_popular') as stale_popular, pg_temp.mt_more('sales', :'tok_sales') as stale_sales,
 pg_temp.mt_more('reviews', :'tok_reviews') as stale_reviews, pg_temp.mt_more('recommended', :'tok_recommended') as stale_recommended \gset
reset role;
select pg_temp.mt_assert(:'stale_popular' like 'PT409 category_display_page_changed' and :'stale_sales' like 'PT409 category_display_page_changed'
 and :'stale_reviews' like 'PT409 category_display_page_changed' and :'stale_recommended' like 'PT409 category_display_page_changed',
 'a price change is still a composition change for every sort: ' || :'stale_popular' || ' | ' || :'stale_sales' || ' | ' || :'stale_reviews' || ' | ' || :'stale_recommended');
update public.goods_variants set price = price - 500 where good_id = 'mt-10' and is_default;
update public.goods set price = price - 500 where id = 'mt-10';

-- 4) 굿즈가 빠져도(구성 집합 변경) 세 정렬 모두 PT409. 전시 노드의 구성(원천 분류)에서 mt-25 를 뺀다.
update public.goods set category_id = null where id = 'mt-25';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.mt_more('popular', :'tok_popular') as gone_popular, pg_temp.mt_more('sales', :'tok_sales') as gone_sales,
 pg_temp.mt_more('reviews', :'tok_reviews') as gone_reviews \gset
reset role;
select pg_temp.mt_assert(:'gone_popular' like 'PT409 %' and :'gone_sales' like 'PT409 %' and :'gone_reviews' like 'PT409 %',
 'a good leaving the display is a composition change: ' || :'gone_popular' || ' | ' || :'gone_sales' || ' | ' || :'gone_reviews');
update public.goods set category_id = pg_temp.mt_uid(10) where id = 'mt-25';

-- 5) 다른 정렬은 순서가 바뀌면 PT409 인 채 그대로다(불변): 진열 순서(display_order)를 바꾸면 추천순 토큰은 어긋나지만
--    세 정렬의 토큰은 구성 해시라 영향이 없다.
update public.goods set display_order = 1000 where id = 'mt-01';
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.mt_more('recommended', :'tok_recommended') as reordered_recommended, pg_temp.mt_more('popular', :'tok_popular') as reordered_popular \gset
select public.get_category_display_page(pg_temp.mt_uid(20), pg_temp.mt_query('recommended'))->>'token' as new_tok_recommended \gset
reset role;
select pg_temp.mt_assert(:'reordered_recommended' like 'PT409 %', 'recommended still detects an order change: ' || :'reordered_recommended');
select pg_temp.mt_assert(:'new_tok_recommended' is distinct from :'tok_recommended', 'recommended token still follows the order');
select pg_temp.mt_assert(:'reordered_popular' = 'ok 5', 'metric sorts ignore ranking order changes: ' || :'reordered_popular');

-- 6) 서로 다른 정렬의 토큰은 정렬 이름이 질의에 들어 있어 섞이지 않는다.
select pg_temp.mt_assert(:'tok_popular' <> :'tok_sales' and :'tok_sales' <> :'tok_reviews' and :'tok_popular' <> :'tok_reviews' and :'tok_popular' <> :'tok_recommended',
 'tokens of different sorts differ');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.mt_more('sales', :'tok_popular') as mixed \gset
reset role;
select pg_temp.mt_assert(:'mixed' like 'PT409 %', 'a popular token does not open the sales page: ' || :'mixed');

-- 7) 운영자 미리보기(저장 전 구성)도 같은 본문을 지나므로 세 정렬에서 여전히 토큰을 만든다.
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.mt_uid(1)::text, true);
do $$ declare v jsonb;
begin
 v := public.admin_get_category_display(pg_temp.mt_uid(20))->'values';
 perform pg_temp.mt_assert((public.admin_preview_category_display(pg_temp.mt_uid(20), v, pg_temp.mt_query('popular'))->>'token') ~ '^[0-9a-f]{32}$', 'operator preview still returns a token');
end $$;
reset role;

rollback;

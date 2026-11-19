\set ON_ERROR_STOP on
-- 스펙 C §4.1: 목록 정렬 3종(인기도·판매량·리뷰 많은순)과 BEST 기간 판매 랭킹. Rollback-only.
-- 같은 psql 세션에서 helpers/goods_kc_fixture.sql 을 앞에 붙여 실행한다(공개 경로를 그대로 지나는 합성 KC 검토).
-- 고정하는 것: 공개 함수 ACL(private 헬퍼는 어떤 앱 롤도 실행 불가), 원수치(유효 판매 수량·위시·공개 리뷰),
-- 세 정렬의 동률 규칙, 취소 완료·미승인·미래 승인·초안·초안 IP·보관·성인 굿즈 제외, 응답이 id 문자열 배열뿐인 것,
-- 기간 랭킹이 홈 판매 BEST(get_home_sales_rankings)와 같은 순서인 것, 잘못된 인자(22023).
begin;

create function pg_temp.lo_assert(ok boolean, label text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'listing orders assertion: %', label; end if; end $$;
create function pg_temp.lo_uid(n integer) returns uuid language sql immutable as $$ select ('00000000-0000-4000-8000-0000000175'||lpad(n::text, 2, '0'))::uuid $$;
-- 'lo-' 굿즈만 골라 배열 위치 순서대로 돌려준다(시드·다른 굿즈가 상대 순서를 흔들지 않게).
create function pg_temp.lo_only(ids jsonb) returns text[] language sql immutable as $$
  select coalesce(array_agg(v.id order by v.ord), '{}') from jsonb_array_elements_text(ids) with ordinality v(id, ord) where v.id like 'lo-%' $$;

-- 사용자: 1 = 구매자, 2~6 = 위시·리뷰 작성자(5명).
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select pg_temp.lo_uid(n), 'authenticated', 'authenticated', 'listing-orders-' || n || '@example.test', now(), '{}', '{}' from generate_series(1, 6) n;

insert into public.ips(id, title, vertical_key, published_at) values
 ('lo-ip', '정렬 검증 IP', 'character', now()),
 ('lo-draft-ip', '미공개 IP', 'character', null);
-- 대상 13개(lo-ip, 게시) + 제외 4개(초안·미공개 IP·성인·보관). created_at 은 동률 규칙을 고정하려고 일부러 하루씩 벌린다.
insert into public.goods(id, ip_id, name, price, stock, stock_qty, created_at)
select 'lo-' || g.key, case when g.key = 'draftip' then 'lo-draft-ip' else 'lo-ip' end, '정렬 검증 ' || g.key, 1000, 'ok', 100,
 timestamptz '2026-03-01 00:00:00+00' + (g.day || ' days')::interval
from (values ('now', 10), ('hot', 9), ('old', 8), ('recent', 7), ('w1', 6), ('w2', 5), ('w3', 4), ('wish', 3), ('r3a', 2), ('r3b', 1), ('r1', 0),
  ('plain1', -1), ('plain2', -2), ('cancel', -3), ('draft', 11), ('draftip', 12), ('adult', 13), ('archived', 14)) g(key, day);

-- KC 합성 검토자(상품마다 한 명)에게 운영자 멤버십을 주고 공개한다. draft 는 공개하지 않는다.
insert into auth.users(id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
select ('47c47700' || left(md5(id), 24))::uuid, 'authenticated', 'authenticated', 'kc-lo-' || md5(id) || '@example.test', now(), '{"testFixture":"goods-kc"}', '{}'
from public.goods where id like 'lo-%';
insert into private.operator_memberships(profile_id, manager_role)
select ('47c47700' || left(md5(id), 24))::uuid, 'primary' from public.goods where id like 'lo-%';
update private.operator_access_state set configured = true where id;
select pg_temp.publish_goods_kc_fixture(id) from public.goods where id like 'lo-%' and id <> 'lo-draft';
update public.goods set sale_restriction = 'adult' where id = 'lo-adult';

-- 합성 주문 원장(집계를 시험하지 결제 생성을 시험하지 않는다). 사용자 = 구매자(1).
create function pg_temp.lo_order(target integer, good_key text, quantity integer, approved timestamptz,
  order_state public.order_status default 'paid', bank boolean default false) returns uuid language plpgsql as $$
declare purchase uuid := ('10000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
 payment uuid := ('20000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
 attempt uuid := ('30000000-0000-4000-8000-' || lpad(target::text, 12, '0'))::uuid;
begin
 insert into public.orders(id, user_id, status, total, address, created_at, payment_method)
 values(purchase, pg_temp.lo_uid(1), order_state, quantity::bigint * 1000, '{}', now() - interval '90 days',
   case when bank then 'bank_transfer'::public.order_payment_method else 'card'::public.order_payment_method end);
 insert into public.order_items(order_id, good_id, variant_id, qty, unit_price, good_name_snapshot, good_ip_id_snapshot)
 select purchase, 'lo-' || good_key, id, quantity, 1000, '합성 집계 상품', 'lo-ip'
 from public.goods_variants where good_id = 'lo-' || good_key and is_default;
 insert into public.payments(id, user_id, purpose, ref_id, provider, amount, status, idempotency_key)
 values(payment, pg_temp.lo_uid(1), 'order', purchase,
  case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,
  quantity::bigint * 1000, 'paid', 'lo-payment-' || target);
 insert into public.payment_attempts(id, provider, user_id, purpose, ref_id, amount, state, idempotency_key, provider_order_id, provider_product_code, payment_id, expires_at)
 values(attempt, case when bank then 'bank_transfer'::public.payment_provider else 'korpay'::public.payment_provider end,
  pg_temp.lo_uid(1), 'order', purchase, quantity::bigint * 1000, 'approved', 'lo-attempt-' || target,
  'lo-order-' || target, 'lo-product-' || target, payment, now() + interval '10 minutes');
 if approved is not null then
  if bank then insert into public.bank_transfer_confirmations(order_id, attempt_id, confirmed_by, confirmed_at, memo)
   values(purchase, attempt, pg_temp.lo_uid(6), approved, '합성 계좌이체 확인');
  else insert into private.payment_provider_evidence(payment_attempt_id, evidence_kind, approved_at) values(attempt, 'confirm', approved); end if;
 end if;
 return purchase;
end $$;

select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' as lo_today \gset
-- 실시간(오늘 0시~지금) · 일간(어제) · 주간 · 월간 · 30일 밖 누적.
select pg_temp.lo_order(1, 'now', 7, :'lo_today'::timestamptz + (now() - :'lo_today'::timestamptz) / 2);
select pg_temp.lo_order(2, 'hot', 20, :'lo_today'::timestamptz - interval '3 days', 'shipping');
select pg_temp.lo_order(3, 'old', 100, :'lo_today'::timestamptz - interval '45 days', 'done');
select pg_temp.lo_order(4, 'recent', 4, :'lo_today'::timestamptz - interval '23 hours', 'delivered');
select pg_temp.lo_order(5, 'w1', 3, :'lo_today'::timestamptz - interval '5 days', 'confirmed');
select pg_temp.lo_order(6, 'w2', 2, :'lo_today'::timestamptz - interval '6 days');
select pg_temp.lo_order(7, 'w3', 1, :'lo_today'::timestamptz - interval '2 days', 'paid', true);
-- 집계에 들어가면 안 되는 주문: 완료된 취소·반품, 결제 대기, 미래 승인, 승인 증거 없음. 모두 같은 굿즈 'cancel' 에 건다.
select pg_temp.lo_order(11, 'cancel', 500, :'lo_today'::timestamptz - interval '2 days');
insert into public.order_cancellation_requests(order_id, requested_by, reason, claim_type, stage, status, completed_at)
 values('10000000-0000-4000-8000-000000000011', pg_temp.lo_uid(1), '합성 완료 취소', 'cancel', 'completed', 'completed', now());
select pg_temp.lo_order(12, 'cancel', 500, :'lo_today'::timestamptz - interval '2 days', 'pending');
select pg_temp.lo_order(13, 'cancel', 500, now() + interval '1 hour');
select pg_temp.lo_order(14, 'cancel', 500, null);
-- 대상이 아닌 굿즈의 정상 결제 주문: 초안·미공개 IP·성인·보관(수량이 커서 섞이면 맨 위로 올라온다).
select pg_temp.lo_order(21, 'draft', 1000, :'lo_today'::timestamptz - interval '2 days');
select pg_temp.lo_order(22, 'draftip', 1000, :'lo_today'::timestamptz - interval '2 days');
select pg_temp.lo_order(23, 'adult', 1000, :'lo_today'::timestamptz - interval '2 days');
select pg_temp.lo_order(24, 'archived', 1000, :'lo_today'::timestamptz - interval '2 days');
-- 보관은 주문이 걸린 뒤에 한다(보관된 굿즈에는 새 주문 품목을 걸 수 없다).
update public.goods_variants set stock_qty = 0 where good_id = 'lo-archived';
update public.goods set archived_at = now() where id = 'lo-archived';

-- 위시: wish = 5명 전부, old = 1명(구매자 아닌 2번). 초안·성인 굿즈 위시는 순위에 못 들어간다.
insert into public.wishlists(user_id, good_id)
select pg_temp.lo_uid(n), 'lo-wish' from generate_series(2, 6) n;
insert into public.wishlists(user_id, good_id) values (pg_temp.lo_uid(2), 'lo-old'), (pg_temp.lo_uid(2), 'lo-draft'), (pg_temp.lo_uid(2), 'lo-adult');
-- 리뷰: r3a = 5·5·5, r3b = 3·3·4(평균 3.33), r1 = 5 + 숨김 1(세지 않는다). 초안 굿즈의 리뷰는 대상이 아니다.
insert into public.reviews(user_id, good_id, order_id, rating, body) values
 (pg_temp.lo_uid(2), 'lo-r3a', '10000000-0000-4000-8000-000000000002', 5, '합성 공개 리뷰 일'),
 (pg_temp.lo_uid(3), 'lo-r3a', '10000000-0000-4000-8000-000000000002', 5, '합성 공개 리뷰 이'),
 (pg_temp.lo_uid(4), 'lo-r3a', '10000000-0000-4000-8000-000000000002', 5, '합성 공개 리뷰 삼'),
 (pg_temp.lo_uid(2), 'lo-r3b', '10000000-0000-4000-8000-000000000002', 3, '합성 공개 리뷰 사'),
 (pg_temp.lo_uid(3), 'lo-r3b', '10000000-0000-4000-8000-000000000002', 3, '합성 공개 리뷰 오'),
 (pg_temp.lo_uid(4), 'lo-r3b', '10000000-0000-4000-8000-000000000002', 4, '합성 공개 리뷰 육'),
 (pg_temp.lo_uid(2), 'lo-r1', '10000000-0000-4000-8000-000000000002', 5, '합성 공개 리뷰 칠'),
 (pg_temp.lo_uid(2), 'lo-draft', '10000000-0000-4000-8000-000000000002', 5, '합성 초안 리뷰 팔');
insert into public.reviews(user_id, good_id, order_id, rating, body, status, hidden_reason, hidden_at) values
 (pg_temp.lo_uid(3), 'lo-r1', '10000000-0000-4000-8000-000000000002', 1, '합성 숨김 리뷰 구', 'hidden', '합성 검수', now());

-- (a) ACL: 공개 두 RPC 는 anon·authenticated 가 실행하고 service_role 은 못 하며, private 헬퍼는 어떤 앱 롤도 실행하지 못한다.
select pg_temp.lo_assert(
 has_function_privilege('anon', 'public.get_goods_listing_orders()', 'execute')
 and has_function_privilege('authenticated', 'public.get_goods_listing_orders()', 'execute')
 and not has_function_privilege('service_role', 'public.get_goods_listing_orders()', 'execute')
 and has_function_privilege('anon', 'public.get_goods_sales_ranking(text,integer)', 'execute')
 and has_function_privilege('authenticated', 'public.get_goods_sales_ranking(text,integer)', 'execute')
 and not has_function_privilege('service_role', 'public.get_goods_sales_ranking(text,integer)', 'execute'),
 'public ranking RPCs are readable by guests and members only');
select pg_temp.lo_assert(
 (select bool_and(not has_function_privilege(r, p, 'execute'))
  from unnest(array['anon', 'authenticated', 'service_role']) r
  cross join unnest(array['private.goods_effective_sales(timestamptz,timestamptz)', 'private.goods_listing_metrics()']) p),
 'private aggregation helpers are sealed from every application role');
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$ begin
 begin perform * from private.goods_listing_metrics(); raise exception 'anon executed a private helper';
 exception when insufficient_privilege then null; end;
end $$;
reset role;

-- 원수치(private): 유효 판매 수량·위시·공개 리뷰가 기대값과 같고 제외 대상은 행이 없다.
select pg_temp.lo_assert((select count(*) from private.goods_listing_metrics() where good_id like 'lo-%') = 14, 'eligible goods only: '
 || (select string_agg(good_id, ',' order by good_id) from private.goods_listing_metrics() where good_id like 'lo-%'));
select pg_temp.lo_assert(not exists(select 1 from private.goods_listing_metrics() where good_id in ('lo-draft', 'lo-draftip', 'lo-adult', 'lo-archived')),
 'draft, unpublished IP, adult and archived goods have no metrics row');
select pg_temp.lo_assert((select (sales_total, sales_30d, wish_count, review_count) = (20, 20, 0, 0) from private.goods_listing_metrics() where good_id = 'lo-hot'), 'hot totals');
select pg_temp.lo_assert((select (sales_total, sales_30d, wish_count) = (100, 0, 1) from private.goods_listing_metrics() where good_id = 'lo-old'), 'old: outside 30 days still counts in total');
select pg_temp.lo_assert((select (sales_total, sales_30d) = (7, 0) from private.goods_listing_metrics() where good_id = 'lo-now'), 'today is in the total but not in the 30 day window ending today 0:00 KST');
select pg_temp.lo_assert((select (sales_total, sales_30d) = (1, 1) from private.goods_listing_metrics() where good_id = 'lo-w3'), 'bank transfer confirmation counts as payment evidence');
select pg_temp.lo_assert((select (sales_total, sales_30d, wish_count) = (0, 0, 5) from private.goods_listing_metrics() where good_id = 'lo-wish'), 'wish count');
select pg_temp.lo_assert((select (sales_total, sales_30d, wish_count, review_count) = (0, 0, 0, 0) and rating_average is null from private.goods_listing_metrics() where good_id = 'lo-cancel'),
 'completed cancel, pending, future-approved and evidence-less orders never count');
select pg_temp.lo_assert((select (review_count, rating_average) = (3, 5.00) from private.goods_listing_metrics() where good_id = 'lo-r3a'), 'review average 5.00');
select pg_temp.lo_assert((select (review_count, rating_average) = (3, 3.33) from private.goods_listing_metrics() where good_id = 'lo-r3b'), 'review average rounds to two decimals');
select pg_temp.lo_assert((select (review_count, rating_average) = (1, 5.00) from private.goods_listing_metrics() where good_id = 'lo-r1'), 'hidden review is not counted');

-- (b) 세 정렬의 순서와 동률 규칙. 비회원이 읽는다.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select public.get_goods_listing_orders() as listing_orders \gset
reset role;
-- 인기도 = 최근 30일 판매 + 위시 → 공개 리뷰 수 → 등록 최신. old(1)·w3(1) 동점은 등록 최신 old 먼저, 리뷰 3개 r3a·r3b 가 리뷰 없는 now 보다 앞.
select pg_temp.lo_assert(pg_temp.lo_only(:'listing_orders'::jsonb->'popular') = array['lo-hot', 'lo-wish', 'lo-recent', 'lo-w1', 'lo-w2', 'lo-old', 'lo-w3',
 'lo-r3a', 'lo-r3b', 'lo-r1', 'lo-now', 'lo-plain1', 'lo-plain2', 'lo-cancel'], 'popular order: ' || array_to_string(pg_temp.lo_only(:'listing_orders'::jsonb->'popular'), ','));
-- 판매량 = 누적 판매(오늘 포함, 30일 밖 포함) → 위시 → 등록 최신.
select pg_temp.lo_assert(pg_temp.lo_only(:'listing_orders'::jsonb->'sales') = array['lo-old', 'lo-hot', 'lo-now', 'lo-recent', 'lo-w1', 'lo-w2', 'lo-w3',
 'lo-wish', 'lo-r3a', 'lo-r3b', 'lo-r1', 'lo-plain1', 'lo-plain2', 'lo-cancel'], 'sales order: ' || array_to_string(pg_temp.lo_only(:'listing_orders'::jsonb->'sales'), ','));
-- 리뷰 많은순 = 공개 리뷰 수 → 평균 평점 → 등록 최신(리뷰 0개는 평점 0 으로 보고 등록 최신 순).
select pg_temp.lo_assert(pg_temp.lo_only(:'listing_orders'::jsonb->'reviews') = array['lo-r3a', 'lo-r3b', 'lo-r1', 'lo-now', 'lo-hot', 'lo-old', 'lo-recent',
 'lo-w1', 'lo-w2', 'lo-w3', 'lo-wish', 'lo-plain1', 'lo-plain2', 'lo-cancel'], 'reviews order: ' || array_to_string(pg_temp.lo_only(:'listing_orders'::jsonb->'reviews'), ','));

-- (c)(d) 응답 모양: 키 세 개, 값은 문자열 id 배열뿐(원수치 없음). 같은 대상 굿즈 전부가 세 배열에 한 번씩 들어 있고 제외 대상은 없다.
select pg_temp.lo_assert(
 (select count(*) from jsonb_object_keys(:'listing_orders'::jsonb)) = 3 and :'listing_orders'::jsonb ?& array['popular', 'sales', 'reviews']
 and not exists(select 1 from jsonb_each(:'listing_orders'::jsonb) e cross join jsonb_array_elements(e.value) v where jsonb_typeof(v) <> 'string'),
 'response holds only three id string arrays');
select pg_temp.lo_assert(
 (select bool_and(jsonb_array_length(e.value) = (select count(*) from private.goods_listing_metrics())
   and jsonb_array_length(e.value) = (select count(distinct v) from jsonb_array_elements_text(e.value) v)) from jsonb_each(:'listing_orders'::jsonb) e),
 'every array lists each eligible good exactly once');
select pg_temp.lo_assert(
 not exists(select 1 from jsonb_each(:'listing_orders'::jsonb) e cross join jsonb_array_elements_text(e.value) v
  where v in ('lo-draft', 'lo-draftip', 'lo-adult', 'lo-archived')),
 'draft, unpublished IP, adult and archived goods never appear in an order array');
-- 회원(구매자 포함)도 같은 결과를 본다(사람마다 같은 값 — 서버 캐시 전제).
set local role authenticated;
select set_config('request.jwt.claim.sub', pg_temp.lo_uid(1)::text, true);
select pg_temp.lo_assert(public.get_goods_listing_orders() = :'listing_orders'::jsonb, 'members read the same orders as guests');
reset role;

-- (e) 기간 랭킹 = 홈 판매 BEST. 홈은 기간마다 4개만 내므로 limit 4 와 비교하고, 더 긴 목록은 위시만 있는 굿즈까지 내는 것을 본다.
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select public.get_home_sales_rankings() as home_rankings \gset
select pg_temp.lo_assert(public.get_goods_sales_ranking(p, 4) = :'home_rankings'::jsonb->p, 'period ranking matches the home band: ' || p)
 from unnest(array['realtime', 'daily', 'weekly', 'monthly']) p;
select pg_temp.lo_assert(public.get_goods_sales_ranking('weekly', 2) = jsonb_path_query_array(:'home_rankings'::jsonb->'weekly', '$[0 to 1]')
 and jsonb_array_length(public.get_goods_sales_ranking('weekly', 2)) = 2, 'limit cuts the same order');
select pg_temp.lo_assert(public.get_goods_sales_ranking('weekly') = public.get_goods_sales_ranking('weekly', 100), 'limit defaults to 100');
reset role;
-- 어제(KST) 한 건·위시만 있는 굿즈는 수량 0 으로 뒤에 붙는다. 취소·미승인·미래 승인·대상 밖 굿즈는 어느 기간에도 없다.
select pg_temp.lo_assert(pg_temp.lo_only(public.get_goods_sales_ranking('realtime', 200)) = array['lo-now', 'lo-wish', 'lo-old'], 'realtime: today only, then wish-only goods: '
 || array_to_string(pg_temp.lo_only(public.get_goods_sales_ranking('realtime', 200)), ','));
select pg_temp.lo_assert(pg_temp.lo_only(public.get_goods_sales_ranking('daily', 200)) = array['lo-recent', 'lo-wish', 'lo-old'], 'daily: yesterday KST');
select pg_temp.lo_assert(pg_temp.lo_only(public.get_goods_sales_ranking('weekly', 200)) = array['lo-hot', 'lo-recent', 'lo-w1', 'lo-w2', 'lo-w3', 'lo-wish', 'lo-old'],
 'weekly: last 7 days ending yesterday: ' || array_to_string(pg_temp.lo_only(public.get_goods_sales_ranking('weekly', 200)), ','));
select pg_temp.lo_assert(pg_temp.lo_only(public.get_goods_sales_ranking('monthly', 200)) = array['lo-hot', 'lo-recent', 'lo-w1', 'lo-w2', 'lo-w3', 'lo-wish', 'lo-old'],
 'monthly: 45 day old sale is outside, its wish keeps it in');
select pg_temp.lo_assert(not exists(select 1 from unnest(array['realtime', 'daily', 'weekly', 'monthly']) p
  cross join jsonb_array_elements_text(public.get_goods_sales_ranking(p, 200)) v
  where v in ('lo-cancel', 'lo-draft', 'lo-draftip', 'lo-adult', 'lo-archived')), 'ineligible goods and orders never rank');
select pg_temp.lo_assert((select bool_and(jsonb_typeof(v) = 'string') from jsonb_array_elements(public.get_goods_sales_ranking('weekly', 200)) v), 'ranking holds id strings only');

-- (f) 잘못된 인자는 22023.
do $$ declare bad record; got text;
begin
 for bad in select * from (values ('yearly', 4), (null, 4), ('', 4), ('weekly', 0), ('weekly', 201), ('weekly', -1), ('weekly', null)) v(period, lim) loop
  got := null;
  begin perform public.get_goods_sales_ranking(bad.period, bad.lim);
  exception when others then got := sqlstate || ':' || sqlerrm; end;
  if got is distinct from '22023:invalid_sales_ranking' then
   raise exception 'bad ranking arguments (%, %) returned %', bad.period, bad.lim, coalesce(got, 'success');
  end if;
 end loop;
end $$;
select pg_temp.lo_assert(jsonb_array_length(public.get_goods_sales_ranking('weekly', 1)) = 1 and jsonb_array_length(public.get_goods_sales_ranking('weekly', 200)) >= 1, 'limit bounds 1 and 200 are accepted');

rollback;

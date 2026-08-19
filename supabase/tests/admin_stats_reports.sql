\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 통계 리포트 (#258)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 세 리포트는 staff 세션만 읽는다 — 조회 전용이어도 매출은 내부 정보다
--   2. 버킷 경계가 KST 자정이다 — 대시보드와 같은 날짜가 같은 값을 말해야 한다
--   3. 결제수단별 비중이 카드와 무통장을 실제로 가른다(#256이 해소한 것)
--   4. 분모가 0일 때 비율을 0으로 적지 않는다 — "클레임 없음"과 "판매 없음"은 다르다
--   5. 기간 밖 데이터가 새어 들어오지 않는다
-- ============================================================================

select 1 / case when (
  not has_function_privilege(
    'anon', 'public.admin_sales_report(timestamptz, timestamptz, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_sales_report(timestamptz, timestamptz, text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_claims_report(timestamptz, timestamptz)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_claims_report(timestamptz, timestamptz)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_customer_report(timestamptz, timestamptz)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_customer_report(timestamptz, timestamptz)', 'execute'
  )
) then 1 else 0 end as assert_reports_are_staff_session_only;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000f01',
    'authenticated', 'authenticated', 'stats-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000f02',
    'authenticated', 'authenticated', 'stats-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000f03',
    'authenticated', 'authenticated', 'stats-other@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role, created_at)
values
  (
    '00000000-0000-4000-8000-000000000f01',
    'stats-buyer@example.test', 'stats_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role,
    now() - interval '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000f02',
    'stats-staff@example.test', 'stats_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role,
    now() - interval '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000f03',
    'stats-other@example.test', 'stats_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role,
    now() - interval '400 days'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role,
  created_at = excluded.created_at;

insert into public.ips (id, title, vertical_key)
values ('stats-ip', '통계 IP', 'character'), ('stats-ip-b', '통계 IP B', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('stats-goods-a', 'stats-ip', '통계 굿즈 A', '테스트', 10000, 'ok', 100),
  ('stats-goods-b', 'stats-ip-b', '통계 굿즈 B', '테스트', 30000, 'ok', 100);

-- 기간 안 주문 셋(카드 2 · 무통장 1)과 기간 밖 주문 하나.
insert into public.orders (
  id, user_id, status, total, shipping_fee, address, payment_method, created_at
)
values
  (
    '42000000-0000-4000-8000-000000000f01',
    '00000000-0000-4000-8000-000000000f01', 'paid', 13000, 3000, '{}'::jsonb,
    'card', now() - interval '2 days'
  ),
  (
    '42000000-0000-4000-8000-000000000f02',
    '00000000-0000-4000-8000-000000000f01', 'delivered', 33000, 3000, '{}'::jsonb,
    'card', now() - interval '1 day'
  ),
  (
    '42000000-0000-4000-8000-000000000f03',
    '00000000-0000-4000-8000-000000000f03', 'done', 23000, 3000, '{}'::jsonb,
    'bank_transfer', now() - interval '1 day'
  ),
  -- 기간 밖. 새어 들어오면 매출·객단가·클레임율이 전부 틀어진다.
  (
    '42000000-0000-4000-8000-000000000f04',
    '00000000-0000-4000-8000-000000000f01', 'paid', 99000, 3000, '{}'::jsonb,
    'card', now() - interval '90 days'
  ),
  -- pending은 매출이 아니다.
  (
    '42000000-0000-4000-8000-000000000f05',
    '00000000-0000-4000-8000-000000000f01', 'pending', 50000, 3000, '{}'::jsonb,
    'bank_transfer', now() - interval '1 hour'
  );

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values
  (
    '42000000-0000-4000-8000-000000000f01', 'stats-goods-a', 1, 10000,
    '통계 굿즈 A', '테스트', 'stats-ip'
  ),
  (
    '42000000-0000-4000-8000-000000000f02', 'stats-goods-b', 1, 30000,
    '통계 굿즈 B', '테스트', 'stats-ip-b'
  ),
  (
    '42000000-0000-4000-8000-000000000f03', 'stats-goods-a', 2, 10000,
    '통계 굿즈 A', '테스트', 'stats-ip'
  ),
  (
    '42000000-0000-4000-8000-000000000f04', 'stats-goods-a', 9, 11000,
    '통계 굿즈 A', '테스트', 'stats-ip'
  );

-- 클레임 둘(취소 완료 · 반품 접수)과 환불 하나.
insert into public.payments (
  user_id, purpose, ref_id, provider, amount, status, idempotency_key
)
values (
  '00000000-0000-4000-8000-000000000f01', 'order',
  '42000000-0000-4000-8000-000000000f01', 'korpay', 13000, 'paid', 'stats:payment:1'
)
returning id as stats_payment_id \gset

insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, claim_type, stage, status,
  requested_at, completed_at
)
values
  (
    '43000000-0000-4000-8000-000000000f01',
    '42000000-0000-4000-8000-000000000f01',
    '00000000-0000-4000-8000-000000000f01',
    '단순 변심입니다', 'change_of_mind', 'cancel', 'completed', 'completed',
    now() - interval '2 days', now() - interval '2 days' + interval '10 hours'
  ),
  (
    '43000000-0000-4000-8000-000000000f02',
    '42000000-0000-4000-8000-000000000f02',
    '00000000-0000-4000-8000-000000000f01',
    '굿즈에 하자가 있습니다', 'defect', 'return', 'collecting', 'requested',
    now() - interval '1 day', null
  ),
  -- 기간 밖 클레임.
  (
    '43000000-0000-4000-8000-000000000f03',
    '42000000-0000-4000-8000-000000000f04',
    '00000000-0000-4000-8000-000000000f01',
    '오래된 클레임입니다', 'change_of_mind', 'cancel', 'completed', 'completed',
    now() - interval '90 days', now() - interval '89 days'
  );

insert into public.refunds (
  payment_id, amount, status, cancellation_request_id, completed_at
)
values (
  :'stats_payment_id'::uuid, 13000, 'done',
  '43000000-0000-4000-8000-000000000f01',
  now() - interval '2 days' + interval '10 hours'
);

-- 리뷰 셋. 블라인드된 하나는 평점 분포에서 빠져야 한다 — 공개 표면의 평균과
-- 같은 기준이어야 두 화면이 다른 평점을 말하지 않는다.
insert into public.reviews (
  user_id, good_id, order_id, rating, body, status, admin_reply, admin_reply_at,
  hidden_reason, hidden_at, created_at
)
values
  (
    '00000000-0000-4000-8000-000000000f01', 'stats-goods-a',
    '42000000-0000-4000-8000-000000000f01', 5, '아주 만족스럽습니다',
    'visible', '감사합니다', now(), null, null, now() - interval '2 days'
  ),
  (
    '00000000-0000-4000-8000-000000000f01', 'stats-goods-b',
    '42000000-0000-4000-8000-000000000f02', 3, '보통이었습니다',
    'visible', null, null, null, null, now() - interval '1 day'
  ),
  (
    '00000000-0000-4000-8000-000000000f03', 'stats-goods-a',
    '42000000-0000-4000-8000-000000000f03', 1, '블라인드된 리뷰입니다',
    'hidden', null, null, '운영 정책 위반', now(), now() - interval '1 day'
  );

insert into public.inquiries (user_id, category, title, status, created_at, answered_at)
values
  (
    '00000000-0000-4000-8000-000000000f01', 'order', '배송이 언제 오나요', 'answered',
    now() - interval '2 days', now() - interval '2 days' + interval '4 hours'
  ),
  (
    '00000000-0000-4000-8000-000000000f01', 'order', '아직 답이 없어요', 'open',
    now() - interval '1 day', null
  );

-- ---------------------------------------------------------------------------
-- 판매분석
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000f02', true);

select public.admin_sales_report(
  now() - interval '7 days',
  now() + interval '1 day'
) as sales \gset

-- 기간 안 매출 주문 셋만 센다. pending과 90일 전 주문은 빠진다.
select 1 / case when (
  select sum((entry ->> 'orderCount')::bigint) = 3
    and sum((entry ->> 'revenue')::bigint) = 69000
  from jsonb_array_elements(:'sales'::jsonb -> 'daily') as entry
) then 1 else 0 end as assert_sales_daily_counts_only_revenue_orders_in_range;

-- 객단가는 같은 소스에서 나온다 — 매출/주문수가 다른 테이블에서 오면 어긋난다.
select 1 / case when (
  select bool_and(
    (entry ->> 'averageOrderValue')::bigint
      = ((entry ->> 'revenue')::bigint / greatest((entry ->> 'orderCount')::bigint, 1))
  )
  from jsonb_array_elements(:'sales'::jsonb -> 'daily') as entry
) then 1 else 0 end as assert_average_order_value_matches_its_own_bucket;

-- 결제수단별 비중이 실제로 갈린다. #250 발주 그리드가 "결제사"로 물러섰던
-- 이유가 여기서 해소된다(#256).
select 1 / case when (
  select count(*) = 2
    and sum((entry ->> 'revenue')::bigint) filter (where entry ->> 'method' = 'card') = 46000
    and sum((entry ->> 'revenue')::bigint) filter (where entry ->> 'method' = 'bank_transfer') = 23000
  from jsonb_array_elements(:'sales'::jsonb -> 'paymentMethods') as entry
) then 1 else 0 end as assert_payment_method_split_separates_card_and_bank_transfer;

select 1 / case when (
  select count(*) = 2
    and (
      select (entry ->> 'qty')::bigint = 3 and (entry ->> 'revenue')::bigint = 30000
      from jsonb_array_elements(:'sales'::jsonb -> 'goods') as entry
      where entry ->> 'goodId' = 'stats-goods-a'
    )
  from jsonb_array_elements(:'sales'::jsonb -> 'goods') as entry
) then 1 else 0 end as assert_goods_ranking_sums_quantity_and_revenue;

select public.admin_sales_report(
  now() - interval '7 days',
  now() + interval '1 day',
  'stats-ip'
) as scoped_sales \gset

select 1 / case when (
  select count(*) = 1
    and bool_and(entry ->> 'goodId' = 'stats-goods-a')
  from jsonb_array_elements(:'scoped_sales'::jsonb -> 'goods') as entry
) then 1 else 0 end as assert_ip_filter_narrows_the_goods_ranking;

-- IP 필터는 순위만 좁힌다. 일별 매출까지 좁으면 두 숫자가 다른 모집단을 말한다.
select 1 / case when (
  (:'scoped_sales'::jsonb -> 'daily') = (:'sales'::jsonb -> 'daily')
) then 1 else 0 end as assert_ip_filter_does_not_touch_daily_revenue;

-- 티켓은 이벤트 축과 회차 축을 따로 낸다. 이벤트 합계만으로는 어느 회차가 안
-- 팔리는지 볼 수 없고, 그 판단이 정원 조정의 근거다.
select 1 / case when (
  :'sales'::jsonb ? 'tickets' and :'sales'::jsonb ? 'ticketOccurrences'
) then 1 else 0 end as assert_ticket_report_has_both_axes;

-- ---------------------------------------------------------------------------
-- 클레임
-- ---------------------------------------------------------------------------
select public.admin_claims_report(
  now() - interval '7 days',
  now() + interval '1 day'
) as claims \gset

select 1 / case when (
  (:'claims'::jsonb ->> 'orderCount')::bigint = 3
  and (:'claims'::jsonb ->> 'claimCount')::bigint = 2
) then 1 else 0 end as assert_claim_report_counts_range_only;

select 1 / case when (
  select count(*) = 2
    and bool_or(entry ->> 'claimType' = 'cancel' and (entry ->> 'completed')::bigint = 1)
    and bool_or(entry ->> 'claimType' = 'return' and (entry ->> 'open')::bigint = 1)
  from jsonb_array_elements(:'claims'::jsonb -> 'byType') as entry
) then 1 else 0 end as assert_claims_split_by_type_and_stage;

select 1 / case when (
  select bool_or(entry ->> 'reasonType' = 'defect' and (entry ->> 'total')::bigint = 1)
    and bool_or(entry ->> 'reasonType' = 'change_of_mind' and (entry ->> 'total')::bigint = 1)
  from jsonb_array_elements(:'claims'::jsonb -> 'byReason') as entry
) then 1 else 0 end as assert_reason_distribution_separates_defect_from_change_of_mind;

select 1 / case when (
  (:'claims'::jsonb -> 'refunds' ->> 'completedCount')::bigint = 1
  and (:'claims'::jsonb -> 'refunds' ->> 'averageHours')::numeric = 10.0
  and (:'claims'::jsonb -> 'refunds' ->> 'within72h')::bigint = 1
) then 1 else 0 end as assert_refund_speed_measures_intake_to_completion;

-- 판매가 없던 기간의 클레임율은 0%가 아니라 값 없음이다.
select public.admin_claims_report(
  now() - interval '400 days',
  now() - interval '300 days'
) as empty_claims \gset

select 1 / case when (
  (:'empty_claims'::jsonb ->> 'orderCount')::bigint = 0
  and (:'empty_claims'::jsonb ->> 'claimCount')::bigint = 0
  and (:'empty_claims'::jsonb -> 'byType') = '[]'::jsonb
) then 1 else 0 end as assert_empty_range_reports_zero_without_inventing_a_rate;

-- ---------------------------------------------------------------------------
-- 고객현황
-- ---------------------------------------------------------------------------
select public.admin_customer_report(
  now() - interval '7 days',
  now() + interval '1 day'
) as customers \gset

-- 400일 전 가입자는 이 기간 신규가 아니다.
select 1 / case when (
  (:'customers'::jsonb ->> 'signupTotal')::bigint = 2
) then 1 else 0 end as assert_signups_count_only_the_range;

select 1 / case when (
  (:'customers'::jsonb ->> 'buyerCount')::bigint = 2
  and (:'customers'::jsonb ->> 'repeatBuyerCount')::bigint = 1
) then 1 else 0 end as assert_repeat_buyers_need_more_than_one_order;

select 1 / case when (
  (:'customers'::jsonb -> 'inquiries' ->> 'total')::bigint = 2
  and (:'customers'::jsonb -> 'inquiries' ->> 'unanswered')::bigint = 1
  and (:'customers'::jsonb -> 'inquiries' ->> 'averageFirstResponseHours')::numeric = 4.0
) then 1 else 0 end as assert_inquiry_metrics_measure_first_response;

select 1 / case when (
  (:'customers'::jsonb -> 'reviews' ->> 'total')::bigint = 2
  and (:'customers'::jsonb -> 'reviews' ->> 'unanswered')::bigint = 1
  and (:'customers'::jsonb -> 'reviews' ->> 'averageRating')::numeric = 4.00
) then 1 else 0 end as assert_review_metrics_exclude_blinded_reviews;

-- 분포는 1점부터 5점까지 순서대로다. 블라인드된 1점이 여기 들어오면 공개
-- 화면과 운영자 화면이 다른 평점을 말한다.
select 1 / case when (
  (:'customers'::jsonb -> 'reviews' -> 'distribution') = '[0, 0, 1, 0, 1]'::jsonb
) then 1 else 0 end as assert_rating_distribution_matches_the_public_surface;

-- 리뷰가 없는 기간의 평균은 0이 아니라 값 없음이다. 0점은 존재할 수 없다.
select public.admin_customer_report(
  now() - interval '400 days',
  now() - interval '300 days'
) as empty_customers \gset

select 1 / case when (
  (:'empty_customers'::jsonb -> 'reviews' ->> 'total')::bigint = 0
  and (:'empty_customers'::jsonb -> 'reviews' -> 'averageRating') = 'null'::jsonb
) then 1 else 0 end as assert_empty_review_range_has_no_average;

-- ---------------------------------------------------------------------------
-- 잘못된 기간 · 비 staff
-- ---------------------------------------------------------------------------
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_sales_report(now(), now() - interval '1 day');
    accepted := true;
  exception
    when invalid_parameter_value then accepted := false;
  end;

  if accepted then
    raise exception 'a reversed range must be rejected';
  end if;
end;
$$;

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000f01', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_sales_report(now() - interval '7 days', now());
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not read the sales report';
  end if;
end;
$$;

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_customer_report(now() - interval '7 days', now());
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not read the customer report';
  end if;
end;
$$;

reset role;

rollback;

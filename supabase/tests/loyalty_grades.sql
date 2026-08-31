\set ON_ERROR_STOP on

-- 회원 등급(Loyalty) 스모크: 구매 실적 파생 산정·승급 혜택 쿠폰·수동 보정 감사.
-- 등급은 결제에 개입하지 않는다 — 혜택은 쿠폰 발급으로만 표현되고(ADR-0011),
-- 재산정 실패가 결제 확정을 깨뜨리지 않아야 한다.
-- 용어: 무료 등급이다. 유료 멤버십(v2)·VIP·티어 어휘를 쓰지 않는다(CONTEXT.md).

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000721',
    'authenticated', 'authenticated', 'loyalty-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000722',
    'authenticated', 'authenticated', 'loyalty-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000723',
    'authenticated', 'authenticated', 'loyalty-small@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000721',
    'loyalty-buyer@example.test', 'loyalty_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000722',
    'loyalty-staff@example.test', 'loyalty_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000723',
    'loyalty-small@example.test', 'loyalty_small', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('loy-ip', '등급 스모크 IP', 'character')
on conflict (id) do nothing;

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values
  ('loy-g1', 'loy-ip', '등급 굿즈 12만', '피규어', 120000, 'ok', 100),
  ('loy-g2', 'loy-ip', '등급 굿즈 3만', '피규어', 30000, 'ok', 100)
on conflict (id) do update set
  price = excluded.price, stock = excluded.stock, stock_qty = excluded.stock_qty;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when (
  select array_agg(enumlabel::text order by enumsortorder)
  from pg_enum
  where enumtypid = 'public.loyalty_grade'::regtype
) = array['welcome', 'silver', 'gold', 'platinum'] then 1 else 0 end
  as assert_loyalty_grade_ladder;

select 1 / case when exists (
  select 1
  from information_schema.columns
  where table_schema = 'public' and table_name = 'profiles'
    and column_name = 'loyalty_grade'
) then 1 else 0 end as assert_profiles_have_loyalty_grade;

-- profiles select 는 컬럼 화이트리스트(20260717100001)다 — grant 가 빠지면
-- 본인 등급 조회가 조용히 깨진다.
select 1 / case when has_column_privilege(
  'authenticated', 'public.profiles', 'loyalty_grade', 'select'
) then 1 else 0 end as assert_loyalty_grade_column_readable;

select 1 / case when (
  select rowsecurity from pg_tables
  where schemaname = 'public' and tablename = 'loyalty_grade_events'
) then 1 else 0 end as assert_grade_events_have_rls;

select 1 / case when not has_table_privilege('authenticated', 'public.loyalty_grade_events', 'insert')
  and not has_table_privilege('anon', 'public.loyalty_grade_events', 'select')
then 1 else 0 end as assert_grade_events_write_sealed;

select 1 / case when not has_function_privilege('anon', 'public.admin_adjust_loyalty_grade(uuid, public.loyalty_grade, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_adjust_loyalty_grade(uuid, public.loyalty_grade, text)', 'execute')
  and not has_function_privilege('anon', 'public.admin_recalculate_loyalty_grade(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_recalculate_loyalty_grade(uuid)', 'execute')
then 1 else 0 end as assert_loyalty_admin_rpc_acl;

-- 등급 혜택 쿠폰: SILVER 승급 시 자동 발급될 쿠폰을 미리 정의한다.
reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000722', true);
set local role authenticated;

select public.admin_upsert_coupon(
  target_code => 'GRADE-SILVER',
  target_name => 'SILVER 달성 3천원',
  target_discount_type => 'fixed',
  target_discount_value => 3000,
  target_max_discount_amount => null,
  target_min_subtotal => 10000,
  target_starts_at => now() - interval '1 hour',
  target_ends_at => null,
  target_issue_limit => null,
  target_status => 'active',
  target_grade_benefit => 'silver',
  target_previous_code => null
);

reset role;

-- ── 신규 회원은 WELCOME에서 시작한다 ────────────────────────────────────────

select 1 / case when (
  select loyalty_grade = 'welcome'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000721'
) then 1 else 0 end as assert_new_member_starts_welcome;

-- ── 결제 확정(paid 전이)이 재산정을 부른다 ──────────────────────────────────

-- 12만원 주문을 만들고 결제 확정 상태로 전이시킨다(SILVER 임계 10만 초과).
set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000721', true);

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000721', 'loy-g1', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000721',
  '{"recipientName":"등급구매","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000721',
  'card'::public.order_payment_method
) as loyalty_order_id \gset

reset role;

-- 결제 경로 전체를 태우는 대신 상태 전이만 재현한다 — 트리거 계약은
-- orders.status 전이이지 결제 provider가 아니다.
update public.orders set status = 'paid', expires_at = null
where id = :'loyalty_order_id'::uuid;

select 1 / case when (
  select loyalty_grade = 'silver'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000721'
) then 1 else 0 end as assert_paid_transition_recalculates_grade;

select 1 / case when (
  select previous_grade = 'welcome' and next_grade = 'silver' and reason = 'recalculation'
    and (basis ->> 'spend')::bigint = 120000
  from public.loyalty_grade_events
  where user_id = '00000000-0000-4000-8000-000000000721'
  order by created_at desc
  limit 1
) then 1 else 0 end as assert_grade_event_records_basis;

-- 승급 혜택 쿠폰이 자동 발급되고 알림이 쌓인다.
select 1 / case when (
  select status = 'active' and issued_source = 'grade_benefit'
  from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000721'
    and coupon_code = 'GRADE-SILVER'
) then 1 else 0 end as assert_grade_benefit_coupon_issued;

select 1 / case when (
  select issued_count from public.coupons where code = 'GRADE-SILVER'
) = 1 then 1 else 0 end as assert_grade_benefit_counts_issuance;

select 1 / case when exists (
  select 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000721'
    and type = 'loyalty_grade_upgraded'
    and dedupe_key = 'loyalty:upgrade:00000000-0000-4000-8000-000000000721:silver'
) then 1 else 0 end as assert_grade_upgrade_notification;

-- 재산정은 멱등이다 — 같은 상태 재실행이 이벤트·쿠폰을 늘리지 않는다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000722', true);
set local role authenticated;
select public.admin_recalculate_loyalty_grade('00000000-0000-4000-8000-000000000721') as recalc_noop \gset
reset role;
select 1 / case when (
  select count(*) from public.loyalty_grade_events
  where user_id = '00000000-0000-4000-8000-000000000721'
) = 1 then 1 else 0 end as assert_recalculation_idempotent;
select 1 / case when (
  select count(*) from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000721' and coupon_code = 'GRADE-SILVER'
) = 1 then 1 else 0 end as assert_benefit_not_duplicated;

-- ── 취소 전이는 실적을 되돌린다(조용한 강등 — 알림 없음) ────────────────────

update public.orders set status = 'canceled'
where id = :'loyalty_order_id'::uuid;

select 1 / case when (
  select loyalty_grade = 'welcome'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000721'
) then 1 else 0 end as assert_cancel_transition_demotes;

select 1 / case when (
  select count(*) from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000721'
    and type = 'loyalty_grade_upgraded'
) = 1 then 1 else 0 end as assert_demotion_stays_silent;

-- 강등돼도 이미 발급된 혜택 쿠폰은 회수하지 않는다.
select 1 / case when (
  select status = 'active'
  from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000721'
    and coupon_code = 'GRADE-SILVER'
) then 1 else 0 end as assert_benefit_survives_demotion;

-- ── 임계 미달 실적은 등급을 올리지 않는다 ───────────────────────────────────

set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000723', true);

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000723', 'loy-g2', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000723',
  '{"recipientName":"소액구매","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000723',
  'card'::public.order_payment_method
) as small_order_id \gset

reset role;

update public.orders set status = 'paid', expires_at = null
where id = :'small_order_id'::uuid;

select 1 / case when (
  select loyalty_grade = 'welcome'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000723'
) then 1 else 0 end as assert_below_threshold_stays_welcome;

-- ── 수동 보정: 감사 이력과 audit_log를 남긴다 ───────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000722', true);
set local role authenticated;

select public.admin_adjust_loyalty_grade(
  '00000000-0000-4000-8000-000000000723',
  'gold'::public.loyalty_grade,
  '오프라인 구매 실적 보정'
);

reset role;

select 1 / case when (
  select loyalty_grade = 'gold'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000723'
) then 1 else 0 end as assert_manual_adjustment_applied;

select 1 / case when (
  select previous_grade = 'welcome' and next_grade = 'gold'
    and reason = 'manual_adjustment'
    and actor_id = '00000000-0000-4000-8000-000000000722'
    and note = '오프라인 구매 실적 보정'
  from public.loyalty_grade_events
  where user_id = '00000000-0000-4000-8000-000000000723'
  order by created_at desc
  limit 1
) then 1 else 0 end as assert_manual_adjustment_audited_in_events;

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'loyalty.grade.adjust'
    and actor_id = '00000000-0000-4000-8000-000000000722'
    and target = 'profiles:00000000-0000-4000-8000-000000000723'
) then 1 else 0 end as assert_manual_adjustment_in_audit_log;

-- 수동 승급도 통과한 등급의 혜택 쿠폰을 발급한다(gold 경로에 silver 혜택 포함).
select 1 / case when (
  select issued_source = 'grade_benefit'
  from public.user_coupons
  where user_id = '00000000-0000-4000-8000-000000000723'
    and coupon_code = 'GRADE-SILVER'
) then 1 else 0 end as assert_manual_upgrade_grants_passed_benefits;

-- 수동 승급도 자동 산정과 같은 대우다 — 승급 알림을 받는다(US7).
select 1 / case when exists (
  select 1 from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000723'
    and type = 'loyalty_grade_upgraded'
    and dedupe_key = 'loyalty:upgrade:00000000-0000-4000-8000-000000000723:gold'
) then 1 else 0 end as assert_manual_upgrade_notifies;

-- 비스태프는 수동 보정을 부를 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000721', true);
set local role authenticated;
do $$
begin
  begin
    perform public.admin_adjust_loyalty_grade(
      '00000000-0000-4000-8000-000000000721',
      'platinum'::public.loyalty_grade,
      '탈취 시도'
    );
    raise exception 'non-staff grade adjust should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── 재산정 실패는 결제 확정을 깨지 않는다 ───────────────────────────────────

-- 이벤트 기록을 깨뜨리는 제약을 임시로 심어 재산정이 반드시 실패하게 만든 뒤,
-- paid 전이가 그래도 성공하는지 본다 — 트리거는 예외를 삼켜야 한다.
reset role;

alter table public.loyalty_grade_events
  add constraint loyalty_grade_events_poison check (reason <> 'recalculation') not valid;

set local role service_role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000721', true);

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000721', 'loy-g1', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000721',
  '{"recipientName":"재산정실패","phone":"01012345678","postalCode":"12345","address1":"서울시"}'::jsonb,
  '10000000-0000-4000-8000-000000000731',
  'card'::public.order_payment_method
) as poisoned_order_id \gset

reset role;

update public.orders set status = 'paid', expires_at = null
where id = :'poisoned_order_id'::uuid;

select 1 / case when (
  select status = 'paid' from public.orders where id = :'poisoned_order_id'::uuid
) then 1 else 0 end as assert_paid_survives_recalculation_failure;

select 1 / case when (
  select loyalty_grade = 'welcome'
  from public.profiles
  where id = '00000000-0000-4000-8000-000000000721'
) then 1 else 0 end as assert_failed_recalculation_left_grade_alone;

alter table public.loyalty_grade_events
  drop constraint loyalty_grade_events_poison;

-- 어드민 수동 재산정이 놓친 승급을 따라잡는다(분쟁·복구 경로).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000722', true);
set local role authenticated;
select public.admin_recalculate_loyalty_grade('00000000-0000-4000-8000-000000000721') as caught_up_grade \gset
reset role;

select 1 / case when :'caught_up_grade' = 'silver' then 1 else 0 end
  as assert_admin_recalculation_catches_up;

rollback;

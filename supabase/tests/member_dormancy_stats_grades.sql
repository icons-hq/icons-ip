\set ON_ERROR_STOP on

-- D-8 — 접속 기록 · 휴면 · 구매 롤업 · 등급 규칙 (설계서 v2 §1-6)

begin;

insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('00000000-0000-4000-8000-00000000d001', 'authenticated', 'authenticated', 'mem-buyer@example.test', now(), '{}', '{}', now() - interval '400 days', now()),
  ('00000000-0000-4000-8000-00000000d002', 'authenticated', 'authenticated', 'mem-staff@example.test', now(), '{}', '{}', now(), now()),
  ('00000000-0000-4000-8000-00000000d003', 'authenticated', 'authenticated', 'mem-admin@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role, created_at)
values
  ('00000000-0000-4000-8000-00000000d001', 'mem-buyer@example.test', 'mem_buyer', '1995-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'user', now() - interval '400 days'),
  ('00000000-0000-4000-8000-00000000d002', 'mem-staff@example.test', 'mem_staff', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'staff', now()),
  ('00000000-0000-4000-8000-00000000d003', 'mem-admin@example.test', 'mem_admin', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now(), 'admin', now())
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at, role = excluded.role,
  created_at = excluded.created_at;

insert into public.verticals (key, label, color) values ('mem', '회원 테스트', '#000000') on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('mem-ip', '회원 테스트 IP', 'mem') on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('mem-g1', 'mem-ip', '회원 테스트 굿즈', '문구', 60000, 'ok', 50)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- A. 등급 규칙 — 코드에 박혀 있던 값이 표로 옮겨왔고, 임계는 단조여야 한다
-- ---------------------------------------------------------------------------
select 1 / case when (
  (select min_spend from public.loyalty_grade_rules where grade = 'silver') = 100000
  and (select min_spend from public.loyalty_grade_rules where grade = 'gold') = 300000
  and (select min_spend from public.loyalty_grade_rules where grade = 'platinum') = 1000000
  and private.loyalty_grade_for_spend(120000) = 'silver'
  and private.loyalty_grade_for_spend(99999) = 'welcome'
  and private.loyalty_grade_for_spend(1000000) = 'platinum'
) then 1 else 0 end as assert_grade_rules_moved_from_code_to_table;

-- 높은 등급의 문턱이 낮은 등급 아래로 내려가면 어느 등급인지 정할 수 없다.
do $$
begin
  update public.loyalty_grade_rules set min_spend = 50000 where grade = 'platinum';
  -- 제약 트리거가 지연이라 여기서 확인한다.
  set constraints all immediate;
  raise exception 'non-monotonic thresholds must be rejected';
exception when others then
  if sqlerrm <> 'grade_thresholds_not_monotonic' then raise; end if;
end $$;

-- 문턱을 바꾸는 것은 매출 정책이라 관리자만 한다.
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d002', true);
do $$
begin
  perform public.admin_upsert_loyalty_grade_rule('silver', 80000, 90);
  raise exception 'staff must not move grade thresholds';
exception when others then
  if sqlerrm <> 'admin_role_required' then raise; end if;
end $$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d003', true);
select public.admin_upsert_loyalty_grade_rule('silver', 80000, 90) as moved \gset
reset role;
select 1 / case when :'moved' = 'silver'
  and (select min_spend from public.loyalty_grade_rules where grade = 'silver') = 80000
  -- 산정 함수가 표를 읽으므로 문턱을 내린 즉시 판정이 바뀐다.
  and private.loyalty_grade_for_spend(80000) = 'silver'
  then 1 else 0 end as assert_admin_can_move_thresholds_and_they_take_effect;

-- ---------------------------------------------------------------------------
-- B. 구매 롤업 — 주문 상태가 바뀌면 그 회원 것만 다시 센다
-- ---------------------------------------------------------------------------
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-00000000d001', 'mem-g1', 2);
select public.place_order(
  '00000000-0000-4000-8000-00000000d001'::uuid,
  '{"recipientName":"한회원","phone":"01088889999","postalCode":"06236","address1":"서울특별시 강남구","address2":"3층"}'::jsonb,
  '00000000-0000-4000-8000-00000000d010'::uuid
) as mem_order \gset
select set_config('mem.order', :'mem_order', true);

-- 결제 전에는 실적이 아니다.
select 1 / case when coalesce((
  select gross_total from public.member_purchase_stats where user_id = '00000000-0000-4000-8000-00000000d001'
), 0) = 0 then 1 else 0 end as assert_pending_orders_are_not_purchases;

update public.orders set status = 'paid' where id = current_setting('mem.order')::uuid;
select 1 / case when (
  select order_count = 1 and gross_total = 120000 and last_order_at is not null
  from public.member_purchase_stats where user_id = '00000000-0000-4000-8000-00000000d001'
) then 1 else 0 end as assert_rollup_follows_the_order_ledger;

-- 취소하면 실적에서 빠진다 — 캐시가 원장을 따라간다.
update public.orders set status = 'canceled' where id = current_setting('mem.order')::uuid;
select 1 / case when (
  select order_count = 0 and gross_total = 0
  from public.member_purchase_stats where user_id = '00000000-0000-4000-8000-00000000d001'
) then 1 else 0 end as assert_rollup_drops_canceled_orders;

update public.orders set status = 'paid' where id = current_setting('mem.order')::uuid;

-- 전체 재계산이 트리거와 같은 답을 낸다(드리프트 0).
update public.member_purchase_stats set gross_total = 999, order_count = 99
where user_id = '00000000-0000-4000-8000-00000000d001';
select public.recalculate_all_member_purchase_stats() as recalculated \gset
select 1 / case when (
  select gross_total = 120000 and order_count = 1
  from public.member_purchase_stats where user_id = '00000000-0000-4000-8000-00000000d001'
) then 1 else 0 end as assert_nightly_recalculation_repairs_drift;

-- ---------------------------------------------------------------------------
-- C. 접속 기록 · 휴면 — 로그인하면 휴면이 풀린다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d001', true);
select public.record_my_login('203.0.113.9', 'Mozilla/5.0 테스트');
reset role;

select 1 / case when (
  (select last_login_at from public.profiles where id = '00000000-0000-4000-8000-00000000d001') is not null
  and (select count(*) from private.member_login_events where user_id = '00000000-0000-4000-8000-00000000d001') = 1
) then 1 else 0 end as assert_login_is_recorded;

-- 휴면으로 돌린 뒤 로그인하면 자동으로 풀린다 — 돌아온 사람에게 문을 한 번 더 열게 하지 않는다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d002', true);
select public.admin_set_dormant('00000000-0000-4000-8000-00000000d001', true, '12개월 미접속');
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d001', true);
select public.record_my_login(null, null);
reset role;
select 1 / case when (
  select dormant_at is null and dormant_notified_at is null
  from public.profiles where id = '00000000-0000-4000-8000-00000000d001'
) then 1 else 0 end as assert_login_wakes_a_dormant_member;

-- 스윕은 안내 먼저, 전환은 그 뒤다.
update public.profiles set last_login_at = now() - interval '13 months', dormant_at = null, dormant_notified_at = null
where id = '00000000-0000-4000-8000-00000000d001';
select public.sweep_dormant_members(12, 30) as swept_1 \gset
select 1 / case when (:'swept_1'::jsonb ->> 'notified')::integer >= 1
  and (:'swept_1'::jsonb ->> 'switched')::integer = 0
  and (select dormant_at from public.profiles where id = '00000000-0000-4000-8000-00000000d001') is null
  then 1 else 0 end as assert_sweep_notifies_before_switching;

update public.profiles set dormant_notified_at = now() - interval '31 days'
where id = '00000000-0000-4000-8000-00000000d001';
select public.sweep_dormant_members(12, 30) as swept_2 \gset
select 1 / case when (:'swept_2'::jsonb ->> 'switched')::integer >= 1
  and (select dormant_at from public.profiles where id = '00000000-0000-4000-8000-00000000d001') is not null
  then 1 else 0 end as assert_sweep_switches_after_the_notice_window;

-- 휴면 스윕은 크론에 등록하지 않았다 — 처리방침 개정이 먼저다(설계서 §5, Class C).
select 1 / case when not exists (
  select 1 from cron.job where command ilike '%sweep_dormant_members%'
) then 1 else 0 end as assert_dormancy_sweep_is_not_scheduled_yet;

-- ---------------------------------------------------------------------------
-- D. 검색 v2 — 상태·등급·구매액으로 좁힌다
-- ---------------------------------------------------------------------------
update public.profiles set dormant_at = null, dormant_notified_at = null
where id = '00000000-0000-4000-8000-00000000d001';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d002', true);
select count(*) as by_spend from public.admin_search_members(
  target_query => 'mem_buyer', p_min_spend => 100000
) \gset
select count(*) as by_spend_high from public.admin_search_members(
  target_query => 'mem_buyer', p_min_spend => 200000
) \gset
select count(*) as by_status from public.admin_search_members(
  target_query => 'mem_buyer', p_status => 'dormant'
) \gset
select gross_total as listed_spend, masked_email as listed_email
from public.admin_search_members(target_query => 'mem_buyer') \gset
reset role;

select 1 / case when :'by_spend'::integer = 1 and :'by_spend_high'::integer = 0 and :'by_status'::integer = 0
  and :'listed_spend'::bigint = 120000
  -- 목록은 언제나 가린 이메일만 준다. 원문은 상세에서만 본다.
  and :'listed_email' = 'm***@example.test'
  then 1 else 0 end as assert_member_search_filters_and_masks;

-- 상위 회원은 전체 기간이면 롤업을, 기간을 주면 원장을 센다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-00000000d002', true);
select gross_total as top_all from public.admin_top_buyers()
where profile_id = '00000000-0000-4000-8000-00000000d001' \gset
select gross_total as top_ranged from public.admin_top_buyers(now() - interval '1 day', now() + interval '1 day')
where profile_id = '00000000-0000-4000-8000-00000000d001' \gset
reset role;
select 1 / case when :'top_all'::bigint = 120000 and :'top_ranged'::bigint = 120000
  then 1 else 0 end as assert_top_buyers_agree_across_both_paths;

-- ---------------------------------------------------------------------------
-- E. 권한 — 접속 기록과 열람 로그는 앱이 못 읽는다
-- ---------------------------------------------------------------------------
select 1 / case when (
  has_function_privilege('authenticated', 'public.record_my_login(text,text)', 'execute')
  and not has_function_privilege('anon', 'public.record_my_login(text,text)', 'execute')
  and not has_table_privilege('authenticated', 'private.member_login_events', 'select')
  and not has_table_privilege('authenticated', 'private.pii_access_log', 'select')
  and not has_function_privilege('authenticated', 'public.sweep_dormant_members(integer,integer)', 'execute')
  and has_function_privilege('service_role', 'public.purge_member_logs()', 'execute')
  and not has_table_privilege('anon', 'public.member_purchase_stats', 'select')
) then 1 else 0 end as assert_member_privacy_acl;

rollback;

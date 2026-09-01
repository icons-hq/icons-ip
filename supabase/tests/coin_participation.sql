\set ON_ERROR_STOP on

-- 참여형 코인 스모크: 출석 적립 → 카드팩 교환의 불변식.
--
-- 핵심은 두 가지다.
--   1) 코인이 빠졌으면 카드팩도 반드시 발급됐다. 전역 카드 리워드 게이트가 OFF면
--      draw_tickets BEFORE INSERT 트리거가 행을 조용히 삼키므로(20260813203000),
--      교환 RPC가 삽입 행 수를 세어 전체를 롤백해야 한다.
--   2) 같은 operation_id 재호출은 잔액도 발급 수도 바꾸지 않는다.

begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000811',
    'authenticated', 'authenticated', 'coin-fan@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000812',
    'authenticated', 'authenticated', 'coin-other@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000813',
    'authenticated', 'authenticated', 'coin-staff@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000814',
    'authenticated', 'authenticated', 'coin-suspended@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000815',
    'authenticated', 'authenticated', 'coin-fenced@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000811',
    'coin-fan@example.test', 'coin_fan', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000812',
    'coin-other@example.test', 'coin_other', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000813',
    'coin-staff@example.test', 'coin_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'
  ),
  (
    '00000000-0000-4000-8000-000000000814',
    'coin-suspended@example.test', 'coin_suspended', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000815',
    'coin-fenced@example.test', 'coin_fenced', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

update public.profiles
set suspended_at = now(), suspension_reason = '코인 스모크용 정지'
where id = '00000000-0000-4000-8000-000000000814';

-- 탈퇴 신청으로 쓰기가 봉인된 계정. private.is_account_write_fenced 는
-- private.account_action_fences 에 행이 있는지만 본다(20260813204000: 922~) —
-- 그 행은 요청 행을 FK 로 물고 있어서 두 테이블을 함께 시드해야 한다.
insert into private.account_deletion_requests (
  deletion_event_id, subject_user_id, idempotency_key, status
)
values (
  '00000000-0000-4000-8000-0000000008f1',
  '00000000-0000-4000-8000-000000000815',
  '00000000-0000-4000-8000-0000000008f2',
  'blocked_active_obligation'
);

insert into private.account_action_fences (subject_user_id, deletion_event_id)
values (
  '00000000-0000-4000-8000-000000000815',
  '00000000-0000-4000-8000-0000000008f1'
);

insert into public.ips (id, title, vertical_key)
values ('coin-ip', '코인 스모크 IP', 'character')
on conflict (id) do nothing;

insert into public.card_pools (id, ip_id, name)
values ('00000000-0000-4000-8000-0000000008c1', 'coin-ip', '코인 교환 풀')
on conflict (id) do nothing;

-- 준비된 풀: 확률 합 100%, 양수 확률 등급에 카드가 있다.
insert into public.pool_odds (pool_id, rarity, probability)
values
  ('00000000-0000-4000-8000-0000000008c1', 'N', 1),
  ('00000000-0000-4000-8000-0000000008c1', 'R', 0),
  ('00000000-0000-4000-8000-0000000008c1', 'SR', 0),
  ('00000000-0000-4000-8000-0000000008c1', 'SSR', 0),
  ('00000000-0000-4000-8000-0000000008c1', 'HOLO', 0)
on conflict (pool_id, rarity) do update set probability = excluded.probability;

insert into public.cards (id, ip_id, name, no, rarity, pool_id)
values ('coin-card-n', 'coin-ip', '코인 카드', '001', 'N', '00000000-0000-4000-8000-0000000008c1')
on conflict (id) do nothing;

-- ── 스키마·ACL 계약 ─────────────────────────────────────────────────────────

select 1 / case when (
  select count(*) = 4
  from pg_tables
  where schemaname = 'public'
    and tablename in ('coin_ledger', 'coin_balances', 'coin_attendance', 'coin_exchange_offers')
    and rowsecurity
) then 1 else 0 end as assert_coin_tables_have_rls;

select 1 / case when not has_table_privilege('authenticated', 'public.coin_ledger', 'insert')
  and not has_table_privilege('authenticated', 'public.coin_ledger', 'update')
  and not has_table_privilege('authenticated', 'public.coin_ledger', 'delete')
  and not has_table_privilege('authenticated', 'public.coin_balances', 'insert')
  and not has_table_privilege('authenticated', 'public.coin_balances', 'update')
  and not has_table_privilege('authenticated', 'public.coin_attendance', 'insert')
  and not has_table_privilege('authenticated', 'public.coin_exchange_offers', 'insert')
  and not has_table_privilege('anon', 'public.coin_ledger', 'select')
  and not has_table_privilege('anon', 'public.coin_balances', 'select')
  and has_table_privilege('anon', 'public.coin_exchange_offers', 'select')
then 1 else 0 end as assert_coin_tables_write_sealed;

select 1 / case when not has_function_privilege('anon', 'public.attendance_check_in()', 'execute')
  and has_function_privilege('authenticated', 'public.attendance_check_in()', 'execute')
  and not has_function_privilege('service_role', 'public.attendance_check_in()', 'execute')
  and not has_function_privilege('anon', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.exchange_coins_for_draw_tickets(uuid, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.admin_upsert_coin_exchange_offer(uuid, uuid, text, integer, integer, text)', 'execute')
  and has_function_privilege('authenticated', 'public.admin_upsert_coin_exchange_offer(uuid, uuid, text, integer, integer, text)', 'execute')
then 1 else 0 end as assert_coin_rpc_acl;

select 1 / case when not exists (
  select 1
  from unnest(array['anon', 'authenticated', 'service_role']) as app_role(name)
  where has_function_privilege(app_role.name, 'private.assert_card_pool_ready(uuid)', 'execute')
) then 1 else 0 end as assert_pool_ready_helper_sealed;

-- 코인 교환분은 자동/수동 발급과 구분된 출처를 갖는다.
select 1 / case when (
  select pg_get_constraintdef(oid) like '%coin_exchange%'
  from pg_constraint
  where conrelid = 'public.draw_tickets'::regclass
    and conname = 'draw_tickets_source_check'
) then 1 else 0 end as assert_coin_exchange_source_allowed;

-- 멱등 키 unique 인덱스.
select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'coin_ledger'
    and indexdef like '%UNIQUE%'
    and indexdef like '%operation_id%'
) then 1 else 0 end as assert_operation_id_unique;

-- 멱등 키가 어느 상품에 묶였는지 원장이 들고 있어야 "같은 키·다른 상품"을 판정할 수 있다.
select 1 / case when exists (
  select 1
  from pg_constraint
  where conrelid = 'public.coin_ledger'::regclass
    and contype = 'f'
    and confrelid = 'public.coin_exchange_offers'::regclass
) then 1 else 0 end as assert_ledger_offer_fk;

select 1 / case when exists (
  select 1 from pg_indexes
  where schemaname = 'public'
    and tablename = 'coin_ledger'
    and indexdef like '%offer_id%'
    and indexdef not like '%UNIQUE%'
) then 1 else 0 end as assert_ledger_offer_indexed;

-- ── 어드민: 교환 상품 등록 ──────────────────────────────────────────────────

reset role;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000813', true);
set local role authenticated;

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008c1',
  target_label => '베이직 카드팩',
  target_coin_cost => 3,
  target_ticket_count => 3,
  target_status => 'active'
) as offer_id \gset

select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008c1',
  target_label => '중단된 카드팩',
  target_coin_cost => 1,
  target_ticket_count => 1,
  target_status => 'disabled'
) as disabled_offer_id \gset

-- 같은 캠페인에 교환처가 둘인 편성. "같은 멱등 키 · 다른 상품" 판정에 쓴다.
select public.admin_upsert_coin_exchange_offer(
  target_id => null,
  target_pool_id => '00000000-0000-4000-8000-0000000008c1',
  target_label => '프리미엄 카드팩',
  target_coin_cost => 5,
  target_ticket_count => 1,
  target_status => 'active'
) as second_offer_id \gset

-- psql 변수는 do 블록 안에서 치환되지 않는다. 세션 설정으로 옮겨 둔다.
select set_config('test.offer_id', :'offer_id', true) as offer_id_setting \gset
select set_config('test.disabled_offer_id', :'disabled_offer_id', true) as disabled_offer_id_setting \gset
select set_config('test.second_offer_id', :'second_offer_id', true) as second_offer_id_setting \gset

-- 교환은 진행 중 공개 캠페인이 그 상품을 걸고 있을 때만 성립한다
-- (20260901090000). 이 파일의 나머지 시나리오는 그 게이트가 아니라 잔액·게이트·
-- 상품 상태를 시험하므로, 세 상품을 모두 노출하는 편성을 먼저 만들어 둔다.
-- 노출 자체를 시험하는 시나리오는 s8_review_hardening.sql 이 갖는다.
select public.admin_upsert_campaign(
  target_id => 'coin-live-campaign',
  target_kind => 'event',
  target_title => '코인 스모크 캠페인',
  target_subtitle => null,
  target_status => 'published',
  target_starts_at => now() - interval '1 hour',
  target_ends_at => now() + interval '10 days',
  target_hero_image_path => null,
  target_card_image_path => null,
  target_banner_image_path => null,
  target_featured_order => null,
  target_sections => jsonb_build_array(
    jsonb_build_object('type', 'attendance'),
    jsonb_build_object('type', 'exchange', 'offer_id', :'offer_id'),
    jsonb_build_object('type', 'exchange', 'offer_id', :'disabled_offer_id'),
    jsonb_build_object('type', 'exchange', 'offer_id', :'second_offer_id')
  ),
  target_previous_id => null
);

select 1 / case when exists (
  select 1 from public.audit_log
  where action = 'coin.exchange_offer.upsert'
    and actor_id = '00000000-0000-4000-8000-000000000813'
    and target = 'coin_exchange_offers:' || :'offer_id'
) then 1 else 0 end as assert_offer_upsert_audited;

-- 없는 풀을 가리키는 상품은 등록 시점에 막힌다.
do $$
begin
  begin
    perform public.admin_upsert_coin_exchange_offer(
      target_id => null,
      target_pool_id => '00000000-0000-4000-8000-0000000008ff',
      target_label => '유령 풀',
      target_coin_cost => 1,
      target_ticket_count => 1,
      target_status => 'active'
    );
    raise exception 'unknown pool offer should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'pool_not_found' then raise; end if;
  end;
end;
$$;

-- 비스태프는 상품을 만들 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
do $$
begin
  begin
    perform public.admin_upsert_coin_exchange_offer(
      target_id => null,
      target_pool_id => '00000000-0000-4000-8000-0000000008c1',
      target_label => '탈취 시도',
      target_coin_cost => 1,
      target_ticket_count => 1,
      target_status => 'active'
    );
    raise exception 'non-staff offer upsert should be rejected';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

-- ── 출석 ────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);

select (public.attendance_check_in() ->> 'status') as first_check_in_status \gset
select 1 / case when :'first_check_in_status' = 'checked' then 1 else 0 end
  as assert_first_check_in_is_checked;

select 1 / case when (
  select balance = 1 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_check_in_credits_one_coin;

select 1 / case when (
  select count(*) = 1
    and bool_and(amount = 1 and reason = 'attendance' and operation_id is null and attended_on is not null)
  from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_check_in_writes_one_ledger_row;

select 1 / case when (
  select attended_on = (now() at time zone 'Asia/Seoul')::date
  from public.coin_attendance
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_check_in_uses_kst_day_boundary;

-- 같은 날 두 번째 호출은 아무것도 바꾸지 않는다.
select (public.attendance_check_in() ->> 'status') as second_check_in_status \gset
select 1 / case when :'second_check_in_status' = 'already_checked' then 1 else 0 end
  as assert_second_check_in_is_noop;

select 1 / case when (
  select count(*) = 1 from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_second_check_in_adds_no_ledger_row;

select 1 / case when (
  select balance = 1 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_second_check_in_keeps_balance;

-- 정지 계정은 출석할 수 없다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000814', true);
do $$
begin
  begin
    perform public.attendance_check_in();
    raise exception 'suspended check-in should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_suspended' then raise; end if;
  end;
end;
$$;

-- ── 원장 append-only ────────────────────────────────────────────────────────

reset role;
do $$
declare
  v_id bigint;
begin
  select id into v_id from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000811'
  limit 1;

  begin
    update public.coin_ledger set amount = 999 where id = v_id;
    raise exception 'coin ledger update should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'coin_ledger_append_only' then raise; end if;
  end;

  begin
    delete from public.coin_ledger where id = v_id;
    raise exception 'coin ledger delete should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'coin_ledger_append_only' then raise; end if;
  end;
end;
$$;

-- ── 교환 해피패스 ───────────────────────────────────────────────────────────

-- 잔액 시드는 원장과 캐시를 함께 옮긴다(정합 유지). 출석으로 3코인을 채우려면
-- 사흘이 필요하고, 스모크는 그 시간을 만들 수 없다.
insert into public.coin_ledger (user_id, amount, reason, attended_on)
values ('00000000-0000-4000-8000-000000000811', 2, 'attendance', current_date - 1);

update public.coin_balances
set balance = 3, updated_at = now()
where user_id = '00000000-0000-4000-8000-000000000811';

-- 교환은 전역 카드 리워드 게이트가 켜져 있어야 성립한다.
update private.card_reward_control set enabled = true where singleton;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
set local role authenticated;

select public.exchange_coins_for_draw_tickets(
  '00000000-0000-4000-8000-0000000008e1'::uuid,
  :'offer_id'::uuid
) as exchange_result \gset

select 1 / case when (
  (:'exchange_result'::jsonb ->> 'status') = 'exchanged'
  and (:'exchange_result'::jsonb ->> 'balance')::integer = 0
  and (:'exchange_result'::jsonb ->> 'issued_count')::integer = 3
) then 1 else 0 end as assert_exchange_result;

select 1 / case when (
  select balance = 0 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_exchange_debits_balance;

select 1 / case when (
  select count(*) = 1
    and bool_and(amount = -3 and reason = 'exchange' and attended_on is null)
    -- 멱등 키가 어느 상품에 묶였는지 원장이 함께 들고 있어야 재생 판정이 성립한다.
    and bool_and(offer_id = current_setting('test.offer_id')::uuid)
  from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000811'
    and operation_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_exchange_writes_negative_ledger_row;

reset role;

select 1 / case when (
  select count(*) = 3
    and bool_and(source = 'coin_exchange')
    and bool_and(source_id = '00000000-0000-4000-8000-0000000008e1')
    and array_agg(ordinal order by ordinal) = array[1, 2, 3]
    and bool_and(user_id = '00000000-0000-4000-8000-000000000811')
    and bool_and(pool_id = '00000000-0000-4000-8000-0000000008c1')
    and bool_and(reward_policy_id is null)
  from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_exchange_issues_tickets;

-- 알림은 기존 draw_tickets STATEMENT 트리거가 보낸다 — 교환 RPC는 직접 넣지 않는다.
select 1 / case when (
  select count(*) = 1
    and bool_and(link_path = '/packs')
    and bool_and(source_type = 'coin_exchange')
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000811'
    and type = 'draw_ticket_issued'
    and dedupe_key = 'draw_ticket:coin_exchange:00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_exchange_notification_from_existing_trigger;

-- ── 멱등 재생 ───────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
set local role authenticated;

select public.exchange_coins_for_draw_tickets(
  '00000000-0000-4000-8000-0000000008e1'::uuid,
  :'offer_id'::uuid
) as replay_result \gset

select 1 / case when (
  (:'replay_result'::jsonb ->> 'status') = 'already_exchanged'
  and (:'replay_result'::jsonb ->> 'balance')::integer = 0
  and (:'replay_result'::jsonb ->> 'issued_count')::integer = 3
) then 1 else 0 end as assert_replay_reports_existing_state;

reset role;

select 1 / case when (
  select count(*) = 3 from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_replay_does_not_duplicate_tickets;

select 1 / case when (
  select count(*) = 1 from public.coin_ledger
  where operation_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_replay_does_not_duplicate_ledger;

-- ── 같은 키 · 다른 상품 ─────────────────────────────────────────────────────
--
-- 캠페인 한 장에 교환 블록이 여럿일 때 화면이 멱등 키를 공유하면 여기로 온다.
-- already_exchanged 로 답하면 두 번째 상품은 교환되지 않았는데 성공으로 읽힌다.

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e1'::uuid,
      current_setting('test.second_offer_id')::uuid
    );
    raise exception 'same operation id with a different offer should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'exchange_operation_conflict' then raise; end if;
  end;
end;
$$;

reset role;

-- 부수효과 없음: 원장 한 줄도, 발급 수도, 잔액도 그대로다.
select 1 / case when (
  select count(*) = 1
    and bool_and(offer_id = current_setting('test.offer_id')::uuid)
  from public.coin_ledger
  where operation_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_offer_conflict_leaves_ledger;

select 1 / case when (
  select count(*) = 3 from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e1'
) then 1 else 0 end as assert_offer_conflict_issues_no_extra_ticket;

select 1 / case when (
  select balance = 0 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_offer_conflict_leaves_balance;

-- 남의 멱등 키 재생은 거부된다(잔액·발급 수 열람 경로 차단).
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000812', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e1'::uuid,
      current_setting('test.offer_id')::uuid
    );
    raise exception 'foreign operation id replay should be rejected';
  exception
    when unique_violation then
      if sqlerrm <> 'exchange_operation_conflict' then raise; end if;
  end;
end;
$$;

-- ── 잔액 부족 ───────────────────────────────────────────────────────────────

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e2'::uuid,
      current_setting('test.offer_id')::uuid
    );
    raise exception 'exchange without balance should be rejected';
  exception
    when raise_exception then
      if sqlerrm <> 'insufficient_coins' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when (
  select balance = 0 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_insufficient_leaves_balance;

select 1 / case when not exists (
  select 1 from public.coin_ledger
  where operation_id = '00000000-0000-4000-8000-0000000008e2'
) then 1 else 0 end as assert_insufficient_writes_no_ledger;

select 1 / case when not exists (
  select 1 from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e2'
) then 1 else 0 end as assert_insufficient_issues_no_ticket;

-- ── 중단된 상품 ─────────────────────────────────────────────────────────────

update public.coin_balances set balance = 10
where user_id = '00000000-0000-4000-8000-000000000811';

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e3'::uuid,
      current_setting('test.disabled_offer_id')::uuid
    );
    raise exception 'disabled offer exchange should be rejected';
  exception
    when no_data_found then
      if sqlerrm <> 'offer_unavailable' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when (
  select balance = 10 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_disabled_offer_leaves_balance;

-- ── 게이트 OFF: 코인만 소각되는 경로가 없어야 한다 ──────────────────────────

update private.card_reward_control set enabled = false where singleton;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000811', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e4'::uuid,
      current_setting('test.offer_id')::uuid
    );
    raise exception 'exchange while rewards disabled should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'card_rewards_disabled' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when (
  select balance = 10 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000811'
) then 1 else 0 end as assert_gate_off_leaves_balance;

select 1 / case when not exists (
  select 1 from public.coin_ledger
  where operation_id = '00000000-0000-4000-8000-0000000008e4'
) then 1 else 0 end as assert_gate_off_writes_no_ledger;

select 1 / case when not exists (
  select 1 from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e4'
) then 1 else 0 end as assert_gate_off_issues_no_ticket;

update private.card_reward_control set enabled = true where singleton;

-- ── 정지 계정 교환 ──────────────────────────────────────────────────────────

insert into public.coin_balances (user_id, balance)
values ('00000000-0000-4000-8000-000000000814', 10)
on conflict (user_id) do update set balance = excluded.balance;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000814', true);
set local role authenticated;
do $$
begin
  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e5'::uuid,
      current_setting('test.offer_id')::uuid
    );
    raise exception 'suspended exchange should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_suspended' then raise; end if;
  end;
end;
$$;

-- ── 탈퇴 봉인 계정 ──────────────────────────────────────────────────────────
--
-- 정지와 다른 상태다(정지 검사 다음에 온다). 적립은 삭제 대상 계정에 새 잔액을
-- 만들고 교환은 그 잔액을 카드팩으로 바꾼다 — 봉인 뒤에는 둘 다 일어나지 않는다.

reset role;

insert into public.coin_balances (user_id, balance)
values ('00000000-0000-4000-8000-000000000815', 10)
on conflict (user_id) do update set balance = excluded.balance;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000815', true);
set local role authenticated;
do $$
begin
  begin
    perform public.attendance_check_in();
    raise exception 'fenced check-in should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;

  begin
    perform public.exchange_coins_for_draw_tickets(
      '00000000-0000-4000-8000-0000000008e6'::uuid,
      current_setting('test.offer_id')::uuid
    );
    raise exception 'fenced exchange should be rejected';
  exception
    when object_not_in_prerequisite_state then
      if sqlerrm <> 'account_deletion_write_fenced' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when not exists (
  select 1 from public.coin_attendance
  where user_id = '00000000-0000-4000-8000-000000000815'
) then 1 else 0 end as assert_fenced_check_in_writes_no_attendance;

select 1 / case when not exists (
  select 1 from public.coin_ledger
  where user_id = '00000000-0000-4000-8000-000000000815'
) then 1 else 0 end as assert_fenced_account_writes_no_ledger;

select 1 / case when (
  select balance = 10 from public.coin_balances
  where user_id = '00000000-0000-4000-8000-000000000815'
) then 1 else 0 end as assert_fenced_exchange_leaves_balance;

select 1 / case when not exists (
  select 1 from public.draw_tickets
  where source = 'coin_exchange'
    and source_id = '00000000-0000-4000-8000-0000000008e6'
) then 1 else 0 end as assert_fenced_exchange_issues_no_ticket;

-- ── RLS 격리 ────────────────────────────────────────────────────────────────

-- 롤을 여기서 다시 선언한다. 앞 절이 reset role 로 끝나면 이 절의 count 가
-- 소유자 권한으로 돌아 RLS 를 통째로 우회한다 — 격리 단언이 조용히 무의미해진다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000812', true);
set local role authenticated;

select 1 / case when (
  select count(*) from public.coin_ledger
) = 0 then 1 else 0 end as assert_ledger_rls_scoped;

select 1 / case when (
  select count(*) from public.coin_balances
) = 0 then 1 else 0 end as assert_balance_rls_scoped;

select 1 / case when (
  select count(*) from public.coin_attendance
) = 0 then 1 else 0 end as assert_attendance_rls_scoped;

-- 중단된 교환 상품은 일반 사용자에게 보이지 않는다(active 2건만 보인다).
select 1 / case when (
  select count(*) from public.coin_exchange_offers
) = 2 then 1 else 0 end as assert_disabled_offer_hidden;

-- 운영자는 전부 본다.
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000813', true);
select 1 / case when (
  select count(*) from public.coin_exchange_offers
) = 3 then 1 else 0 end as assert_staff_sees_disabled_offer;
select 1 / case when (
  select count(*) from public.coin_ledger
) = 3 then 1 else 0 end as assert_staff_sees_ledger;

reset role;
update private.card_reward_control set enabled = false where singleton;

rollback;

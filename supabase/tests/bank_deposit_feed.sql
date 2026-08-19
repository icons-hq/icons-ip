\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 계좌수집 입금 내역과 매칭 제안 (#257)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 재수집이 안전하다 — 같은 입금을 몇 번 흘려도 한 행이다
--   2. 망가진 항목 하나가 배치를 통째로 죽이지 않는다
--   3. 매칭은 제안이다 — 확신할 수 없으면 제안하지 않는다
--   4. 확정은 #256의 한 경로만 쓴다 — 주문·원장이 카드와 같은 자리에 착지한다
--   5. 미아 입금은 지우지 않고 사유와 함께 큐에서 내린다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: 실행 권한
-- ---------------------------------------------------------------------------
-- 적재는 서버(service_role)만. 브라우저 롤이 입금 내역을 만들 수 있으면
-- "입금이 들어왔다"는 사실 자체를 위조할 수 있다.
select 1 / case when (
  not has_function_privilege('anon', 'public.record_bank_deposits(text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_bank_deposits(text, jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.record_bank_deposits(text, jsonb)', 'execute')
) then 1 else 0 end as assert_deposit_ingest_is_service_only;

select 1 / case when (
  not has_function_privilege(
    'anon', 'public.admin_confirm_bank_deposit(uuid, uuid, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_confirm_bank_deposit(uuid, uuid, text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_ignore_bank_deposit(uuid, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_ignore_bank_deposit(uuid, text)', 'execute'
  )
  and not has_function_privilege(
    'anon',
    'public.admin_bank_deposit_queue(public.bank_deposit_status, integer)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'public.admin_bank_deposit_queue(public.bank_deposit_status, integer)',
    'execute'
  )
) then 1 else 0 end as assert_deposit_operations_are_staff_session_only;

-- 입금 내역은 staff 읽기 전용이다. 쓰기가 열리면 확정 근거를 손으로 만들 수 있다.
select 1 / case when (
  not has_table_privilege('anon', 'public.bank_deposits', 'select')
  and has_table_privilege('authenticated', 'public.bank_deposits', 'select')
  and not has_table_privilege('authenticated', 'public.bank_deposits', 'insert')
  and not has_table_privilege('authenticated', 'public.bank_deposits', 'update')
  and not has_table_privilege('authenticated', 'public.bank_deposits', 'delete')
) then 1 else 0 end as assert_deposits_are_read_only_for_staff;

-- ---------------------------------------------------------------------------
-- Fixtures — 무통장 주문 세 건
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000e01',
    'authenticated', 'authenticated', 'deposit-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000e02',
    'authenticated', 'authenticated', 'deposit-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000e01',
    'deposit-buyer@example.test', 'deposit_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000e02',
    'deposit-staff@example.test', 'deposit_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('deposit-ip', '입금 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('deposit-goods', 'deposit-ip', '입금 굿즈', '테스트', 20000, 'ok', 30);

reset role;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000e01', 'deposit-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000e01'::uuid,
  jsonb_build_object(
    'recipientName', '홍길동',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  'aa000000-0000-4000-8000-000000000001'::uuid,
  'bank_transfer'::public.order_payment_method
) as coded_order_id \gset

select private.bank_transfer_deposit_code(:'coded_order_id'::uuid) as coded_code \gset

-- ---------------------------------------------------------------------------
-- 적재 — 멱등
-- ---------------------------------------------------------------------------
select public.record_bank_deposits(
  'fake',
  jsonb_build_array(
    jsonb_build_object(
      'externalId', 'dep-001',
      'depositedAt', now()::text,
      'depositorName', '홍길동' || :'coded_code',
      'amount', 23000,
      'rawReference', '기업 12345 입금'
    ),
    jsonb_build_object(
      'externalId', 'dep-002',
      'depositedAt', now()::text,
      'depositorName', '알수없는사람',
      'amount', 9900,
      'rawReference', '기업 12346 입금'
    )
  )
) as first_ingest \gset

select 1 / case when :'first_ingest'::integer = 2 then 1 else 0 end as assert_first_ingest_records_both;

-- 같은 배치를 다시 흘린다. 폴링 중복·웹훅 재전송·장애 뒤 재수집이 전부 이 모양이다.
select public.record_bank_deposits(
  'fake',
  jsonb_build_array(
    jsonb_build_object(
      'externalId', 'dep-001',
      'depositedAt', now()::text,
      'depositorName', '홍길동' || :'coded_code',
      'amount', 23000
    ),
    jsonb_build_object(
      'externalId', 'dep-003',
      'depositedAt', now()::text,
      'depositorName', '김철수',
      'amount', 23000
    )
  )
) as second_ingest \gset

select 1 / case when :'second_ingest'::integer = 1 then 1 else 0 end
  as assert_reingest_adds_only_new_rows;

select 1 / case when (
  select count(*) = 3 from public.bank_deposits
) then 1 else 0 end as assert_no_duplicate_deposit_rows;

-- 망가진 항목은 건너뛰되 나머지는 들어간다. 배치 하나가 통째로 실패하면
-- 재수집이 영원히 같은 지점에서 막힌다.
select public.record_bank_deposits(
  'fake',
  jsonb_build_array(
    jsonb_build_object('externalId', 'dep-bad', 'depositedAt', now()::text, 'amount', 1000),
    jsonb_build_object(
      'externalId', 'dep-004',
      'depositedAt', now()::text,
      'depositorName', '정상입금',
      'amount', 5000
    ),
    jsonb_build_object(
      'externalId', 'dep-zero',
      'depositedAt', now()::text,
      'depositorName', '영원',
      'amount', 0
    )
  )
) as third_ingest \gset

select 1 / case when :'third_ingest'::integer = 1 then 1 else 0 end
  as assert_broken_entries_do_not_kill_the_batch;

-- ---------------------------------------------------------------------------
-- 매칭 제안
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e02', true);

-- 코드와 금액이 모두 맞으면 가장 높은 확신이다.
select 1 / case when (
  select suggested_order_id = :'coded_order_id'::uuid
    and suggested_confidence = 'code_amount'
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-001'
) then 1 else 0 end as assert_code_and_amount_match_is_the_strongest_suggestion;

-- 코드가 없고 금액만 같은데 이름이 수령인과 다르면 제안하지 않는다.
select 1 / case when (
  select suggested_order_id is null
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-003'
) then 1 else 0 end as assert_amount_alone_is_not_a_suggestion;

select 1 / case when (
  select suggested_order_id is null
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-002'
) then 1 else 0 end as assert_unknown_deposit_stays_unmatched;

reset role;

-- 코드를 빠뜨렸지만 금액과 수령인 이름이 맞으면 제안한다.
select public.record_bank_deposits(
  'fake',
  jsonb_build_array(
    jsonb_build_object(
      'externalId', 'dep-005',
      'depositedAt', now()::text,
      'depositorName', '홍길동',
      'amount', 23000
    )
  )
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e02', true);

select 1 / case when (
  select suggested_order_id = :'coded_order_id'::uuid
    and suggested_confidence = 'amount_name'
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-005'
) then 1 else 0 end as assert_name_and_amount_match_when_the_code_is_missing;

-- ---------------------------------------------------------------------------
-- 동명이인 — 확신할 수 없으면 제안하지 않는다
-- ---------------------------------------------------------------------------
reset role;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000e01', 'deposit-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000e01'::uuid,
  jsonb_build_object(
    'recipientName', '홍길동',
    'phone', '01099998888',
    'postalCode', '06236',
    'address1', '서울시 서초구'
  ),
  'aa000000-0000-4000-8000-000000000002'::uuid,
  'bank_transfer'::public.order_payment_method
) as twin_order_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e02', true);

select 1 / case when (
  select suggested_order_id is null
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-005'
) then 1 else 0 end as assert_ambiguous_name_stops_the_suggestion;

-- 코드가 있으면 동명이인이어도 여전히 정확하다 — 그래서 코드를 안내한다.
select 1 / case when (
  select suggested_order_id = :'coded_order_id'::uuid
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-001'
) then 1 else 0 end as assert_code_survives_the_name_collision;

-- ---------------------------------------------------------------------------
-- 확정 — #256 경로를 그대로 쓴다
-- ---------------------------------------------------------------------------
select deposit_id from public.admin_bank_deposit_queue() where external_id = 'dep-001' \gset

select public.admin_confirm_bank_deposit(
  :'deposit_id'::uuid,
  :'coded_order_id'::uuid,
  '기업 23,000원 홍길동' || :'coded_code' || ' 대조 완료'
) as deposit_outcome \gset

select 1 / case when :'deposit_outcome' = 'approved' then 1 else 0 end
  as assert_deposit_confirmation_approves;

reset role;

select 1 / case when (
  select orders.status = 'paid' from public.orders where orders.id = :'coded_order_id'::uuid
) then 1 else 0 end as assert_matched_order_is_paid;

-- #256의 증빙이 남는다 — 확정 경로가 하나라는 증거다.
select 1 / case when (
  select count(*) = 1
  from public.bank_transfer_confirmations
  where order_id = :'coded_order_id'::uuid
) then 1 else 0 end as assert_confirmation_evidence_comes_from_the_shared_path;

select 1 / case when (
  select status = 'matched' and matched_order_id = :'coded_order_id'::uuid
  from public.bank_deposits
  where external_id = 'dep-001'
) then 1 else 0 end as assert_deposit_is_marked_matched;

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where action = 'admin.bank_deposit.matched'
) then 1 else 0 end as assert_match_is_audited;

-- 확정된 입금은 큐에서 사라진다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e02', true);

select 1 / case when (
  select count(*) = 0
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-001'
) then 1 else 0 end as assert_matched_deposit_leaves_the_queue;

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_confirm_bank_deposit(
      (select id from public.bank_deposits where external_id = 'dep-001'),
      (select id from public.orders where checkout_key = 'aa000000-0000-4000-8000-000000000002'),
      '같은 입금을 두 번 씁니다'
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then accepted := false;
  end;

  if accepted then
    raise exception 'a matched deposit must not fund a second order';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 확정이 approved로 끝나지 않으면 입금을 닫지 않는다
-- ---------------------------------------------------------------------------
-- finalizer는 확정 직전 상태(정지 계정·스냅샷 불일치 등)를 다시 보고 needs_review를
-- 돌려줄 수 있다. 그때 입금을 matched로 닫으면 "돈은 들어왔는데 주문은 안 된" 건이
-- 큐에서 사라져 아무도 정합화하지 않는다.
reset role;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000e01', 'deposit-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000e01'::uuid,
  jsonb_build_object(
    'recipientName', '정지될사람',
    'phone', '01011112222',
    'postalCode', '06236',
    'address1', '서울시 마포구'
  ),
  'aa000000-0000-4000-8000-000000000003'::uuid,
  'bank_transfer'::public.order_payment_method
) as fenced_order_id \gset

select public.record_bank_deposits(
  'fake',
  jsonb_build_array(
    jsonb_build_object(
      'externalId', 'dep-006',
      'depositedAt', now()::text,
      'depositorName', '정지될사람' || private.bank_transfer_deposit_code(:'fenced_order_id'::uuid),
      'amount', 23000
    )
  )
);

-- 입금이 들어온 뒤 계정이 정지됐다. finalizer의 approved 가드가 여기서 걸린다.
update public.profiles
set suspended_at = now(), suspension_reason = '통계 스모크용 정지'
where id = '00000000-0000-4000-8000-000000000e01';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e02', true);

select deposit_id as fenced_deposit_id
from public.admin_bank_deposit_queue()
where external_id = 'dep-006' \gset

select public.admin_confirm_bank_deposit(
  :'fenced_deposit_id'::uuid,
  :'fenced_order_id'::uuid,
  '입금자명 코드 일치, 금액 동일'
) as fenced_outcome \gset

select 1 / case when :'fenced_outcome' <> 'approved' then 1 else 0 end
  as assert_fenced_account_does_not_approve;

reset role;

select 1 / case when (
  select orders.status = 'pending' from public.orders where orders.id = :'fenced_order_id'::uuid
) then 1 else 0 end as assert_unapproved_order_stays_unpaid;

-- 입금은 큐에 남는다. 사유는 기록되되 matched로 닫히지 않는다.
select 1 / case when (
  select status = 'unmatched'
    and matched_order_id is null
    and decision_note like '%확정 실패%'
  from public.bank_deposits
  where external_id = 'dep-006'
) then 1 else 0 end as assert_unapproved_deposit_stays_in_the_queue;

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where action = 'admin.bank_deposit.match_failed'
) then 1 else 0 end as assert_failed_match_is_audited_separately;

update public.profiles
set suspended_at = null, suspension_reason = null
where id = '00000000-0000-4000-8000-000000000e01';

-- ---------------------------------------------------------------------------
-- 미아 입금 — 지우지 않고 사유와 함께 내린다
-- ---------------------------------------------------------------------------
select deposit_id as orphan_id
from public.admin_bank_deposit_queue()
where external_id = 'dep-002' \gset

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_ignore_bank_deposit(
      (select id from public.bank_deposits where external_id = 'dep-002'),
      '미아'
    );
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'ignoring a deposit must carry a reason';
  end if;
end;
$$;

select public.admin_ignore_bank_deposit(
  :'orphan_id'::uuid,
  '주문과 대조되지 않아 구매자에게 반환 안내 예정'
);

select 1 / case when (
  select count(*) = 0
  from public.admin_bank_deposit_queue()
  where external_id = 'dep-002'
) then 1 else 0 end as assert_ignored_deposit_leaves_the_queue;

reset role;

select 1 / case when (
  select status = 'ignored' and decision_note like '%반환 안내%'
  from public.bank_deposits
  where external_id = 'dep-002'
) then 1 else 0 end as assert_ignored_deposit_keeps_its_reason;

-- ---------------------------------------------------------------------------
-- 비 staff 차단
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000e01', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_bank_deposit_queue();
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not read the deposit queue';
  end if;
end;
$$;

-- 구매자 세션에는 입금 내역이 한 행도 보이지 않는다(staff RLS).
select 1 / case when (
  select count(*) = 0 from public.bank_deposits
) then 1 else 0 end as assert_buyer_cannot_read_deposits;

reset role;

rollback;

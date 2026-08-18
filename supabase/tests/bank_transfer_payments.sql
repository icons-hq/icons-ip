\set ON_ERROR_STOP on

begin;

-- ============================================================================
-- ICONS · 무통장 입금 (#256)
--
-- 이 스모크가 DB 안에 고정하는 것:
--   1. 결제수단은 주문 생성 시점에 고정된다 — 선점 창이 그때 결정된다
--   2. 무통장 차단(allow_bank_transfer)은 주문 생성에서 막힌다
--   3. 확정은 운영자가 아니라 finalizer가 한다 — 원장·주문 상태가 카드와 같다
--   4. 증빙 없는 확정은 없다 — 메모가 필수고 확인자·시각이 남는다
--   5. 기한 연장은 1회이고 주문과 attempt를 함께 민다
--   6. 미입금 취소는 재고를 복원하고 돈을 건드리지 않는다
--   7. 티켓에는 무통장이 없다
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 계약: enum · 알림 타입 · 실행 권한
-- ---------------------------------------------------------------------------
select 1 / case when (
  'bank_transfer' = any (
    select value::text
    from unnest(enum_range(null::public.payment_provider)) as t(value)
  )
) then 1 else 0 end as assert_provider_has_bank_transfer;

select 1 / case when (
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_check
    where constraint_check.conrelid = 'public.notifications'::regclass
      and constraint_check.conname = 'notifications_type_check'
      and pg_catalog.pg_get_constraintdef(constraint_check.oid)
        like '%order_bank_transfer_pending%'
      -- 기존 타입을 지우지 않았는지도 같이 본다. 열거형 CHECK를 손으로 다시
      -- 적는 브랜치가 조용히 남의 타입을 지우는 사고가 실제로 있었다.
      and pg_catalog.pg_get_constraintdef(constraint_check.oid) like '%order_paid%'
      and pg_catalog.pg_get_constraintdef(constraint_check.oid) like '%order_delivered%'
      and pg_catalog.pg_get_constraintdef(constraint_check.oid) like '%claim_updated%'
  )
) then 1 else 0 end as assert_bank_transfer_notification_type_appended;

-- 운영 액션은 staff 세션(authenticated)만. anon에게는 실행 권한이 없어야 한다.
select 1 / case when (
  not has_function_privilege(
    'anon', 'public.admin_confirm_bank_transfer_deposit(uuid, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_confirm_bank_transfer_deposit(uuid, text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_extend_bank_transfer_deadline(uuid, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_extend_bank_transfer_deadline(uuid, text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_cancel_unpaid_bank_transfer_order(uuid, text)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_cancel_unpaid_bank_transfer_order(uuid, text)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_unpaid_bank_transfer_orders(text, integer, integer)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_unpaid_bank_transfer_orders(text, integer, integer)', 'execute'
  )
  and not has_function_privilege(
    'anon', 'public.admin_set_good_bank_transfer(text, boolean)', 'execute'
  )
  and has_function_privilege(
    'authenticated', 'public.admin_set_good_bank_transfer(text, boolean)', 'execute'
  )
) then 1 else 0 end as assert_bank_transfer_operations_are_staff_session_only;

-- 입금자명 코드 생성기는 브라우저 역할이 부를 수 없다.
select 1 / case when (
  not has_function_privilege(
    'anon', 'private.bank_transfer_deposit_code(uuid)', 'execute'
  )
  and not has_function_privilege(
    'authenticated', 'private.bank_transfer_deposit_code(uuid)', 'execute'
  )
) then 1 else 0 end as assert_deposit_code_is_private;

-- 증빙 테이블은 읽기만, 그것도 staff만. 쓰기가 한 칸이라도 열리면 확정 없이
-- 증빙만 만들어 낼 수 있다.
select 1 / case when (
  not has_table_privilege('anon', 'public.bank_transfer_confirmations', 'select')
  and has_table_privilege('authenticated', 'public.bank_transfer_confirmations', 'select')
  and not has_table_privilege('authenticated', 'public.bank_transfer_confirmations', 'insert')
  and not has_table_privilege('authenticated', 'public.bank_transfer_confirmations', 'update')
  and not has_table_privilege('authenticated', 'public.bank_transfer_confirmations', 'delete')
) then 1 else 0 end as assert_confirmations_are_read_only_for_staff;

-- 티켓 결제 seam은 무통장을 모른다. 회차 임박과 입금 대기가 충돌하므로
-- 티켓에는 노출하지 않는다는 결정이 DB에서도 지켜져야 한다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.prepare_ticket_payment_attempt(
      '00000000-0000-4000-8000-000000000d01',
      '00000000-0000-4000-8000-000000000d01',
      'bank_transfer'::public.payment_provider
    );
    accepted := true;
  exception
    when others then accepted := false;
  end;

  if accepted then
    raise exception 'ticket checkout must not accept bank transfer';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000d01',
    'authenticated', 'authenticated', 'bank-buyer@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000d02',
    'authenticated', 'authenticated', 'bank-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at, role)
values
  (
    '00000000-0000-4000-8000-000000000d01',
    'bank-buyer@example.test', 'bank_buyer', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'user'::public.user_role
  ),
  (
    '00000000-0000-4000-8000-000000000d02',
    'bank-staff@example.test', 'bank_staff', '2000-01-01',
    '{"terms":true,"privacy":true}'::jsonb, now(), 'staff'::public.user_role
  )
-- auth.users 트리거가 먼저 만든 프로필 행이 있으면 온보딩 칸이 비어 있다.
-- place_order는 그 칸들을 전부 본다 — 갱신에서 빠뜨리면 'onboarding required'다.
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  consents = excluded.consents,
  onboarded_at = excluded.onboarded_at,
  role = excluded.role;

insert into public.ips (id, title, vertical_key)
values ('bank-ip', '무통장 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty, allow_bank_transfer)
values
  ('bank-goods', 'bank-ip', '무통장 굿즈', '테스트', 20000, 'ok', 10, true),
  ('bank-blocked-goods', 'bank-ip', '한정 드롭 굿즈', '테스트', 20000, 'ok', 5, false);

-- 새 컬럼의 기본값은 허용이다. 기존 굿즈가 조용히 무통장 불가로 바뀌면
-- 오픈 직후 결제수단이 사라진다.
select 1 / case when (
  select allow_bank_transfer from public.goods where id = 'bank-goods'
) then 1 else 0 end as assert_bank_transfer_defaults_to_allowed;

-- ---------------------------------------------------------------------------
-- 주문 생성 — 선점 창이 결제수단으로 갈린다
-- ---------------------------------------------------------------------------
-- 주문 생성과 attempt 준비는 service role 경계 안에 있다. 스모크는 superuser
-- 세션에서 그 경계를 직접 부른다 — 브라우저 롤로는 닿을 수 없는 경로다.
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000d01'::uuid,
  jsonb_build_object(
    'recipientName', '무통장',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9a000000-0000-4000-8000-000000000001'::uuid,
  'bank_transfer'::public.order_payment_method
) as bank_order_id \gset

select 1 / case when (
  select payment_method = 'bank_transfer'
    and expires_at between now() + interval '23 hours' and now() + interval '25 hours'
  from public.orders
  where id = :'bank_order_id'
) then 1 else 0 end as assert_bank_transfer_holds_stock_for_a_day;

-- 원장 anchor는 주문과 함께 열린다. "결제 준비" 클릭을 기다리면 이미 이체한
-- 구매자의 입금을 운영자가 확인할 대상이 없다.
select 1 / case when (
  select count(*) = 1
    and bool_and(attempt.provider = 'bank_transfer')
    and bool_and(attempt.state = 'prepared')
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_order_creation_opens_the_ledger_anchor;

-- 카드 주문에는 아직 attempt가 없다 — 결제 준비가 그 시점이다.
select 1 / case when (
  select count(*) = 0
  from public.payment_attempts as attempt
  join public.orders on orders.id = attempt.ref_id
  where orders.payment_method = 'card'
) then 1 else 0 end as assert_card_orders_wait_for_prepare;

-- 안내 알림은 주문을 만든 순간 나간다. 금액과 입금자명 코드가 그때 정해진다.
reset role;
select 1 / case when (
  select count(*) = 1
    and bool_and(body like '%' || upper(left(replace(:'bank_order_id', '-', ''), 8)) || '%')
    and bool_and(body like '%23,000%')
  from public.notifications
  where user_id = '00000000-0000-4000-8000-000000000d01'
    and type = 'order_bank_transfer_pending'
    and source_id = :'bank_order_id'
) then 1 else 0 end as assert_deposit_guidance_is_notified_once;

-- 주문 생성과 attempt 준비는 service role 경계 안에 있다. 스모크는 superuser
-- 세션에서 그 경계를 직접 부른다 — 브라우저 롤로는 닿을 수 없는 경로다.
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-goods', 1);

-- 결제수단 없는 구 시그니처는 카드로 위임한다. 기존 호출자가 무통장 창을
-- 얻어 가면 재고가 하루씩 묶인다.
select public.place_order(
  '00000000-0000-4000-8000-000000000d01'::uuid,
  jsonb_build_object(
    'recipientName', '카드',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9a000000-0000-4000-8000-000000000002'::uuid
) as card_order_id \gset

select 1 / case when (
  select payment_method = 'card'
    and expires_at < now() + interval '20 minutes'
  from public.orders
  where id = :'card_order_id'
) then 1 else 0 end as assert_legacy_signature_stays_on_card;

-- 같은 checkout key로 결제수단만 바꿔 다시 부르면 충돌이다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000d01'::uuid,
      jsonb_build_object(
        'recipientName', '카드',
        'phone', '01012345678',
        'postalCode', '06236',
        'address1', '서울시 강남구'
      ),
      '9a000000-0000-4000-8000-000000000002'::uuid,
      'bank_transfer'::public.order_payment_method
    );
    accepted := true;
  exception
    when unique_violation then accepted := false;
  end;

  if accepted then
    raise exception 'a checkout key must not switch payment method';
  end if;
end;
$$;

-- 무통장 불가 굿즈는 주문 생성에서 막힌다. 카드로는 그대로 살 수 있다.
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-blocked-goods', 1);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.place_order(
      '00000000-0000-4000-8000-000000000d01'::uuid,
      jsonb_build_object(
        'recipientName', '한정',
        'phone', '01012345678',
        'postalCode', '06236',
        'address1', '서울시 강남구'
      ),
      '9a000000-0000-4000-8000-000000000003'::uuid,
      'bank_transfer'::public.order_payment_method
    );
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'a bank-transfer-blocked good must not accept a bank transfer order';
  end if;
end;
$$;

-- 막힌 주문은 재고를 가져가지 않았다.
reset role;
select 1 / case when (
  select stock_qty = 5 from public.goods where id = 'bank-blocked-goods'
) then 1 else 0 end as assert_blocked_order_restores_nothing;

-- 거절된 주문은 장바구니를 비우지 않는다(그게 맞다 — 사용자는 카드로 다시
-- 시도할 수 있어야 한다). 뒤 절들이 이 굿즈를 딸려 담지 않도록 여기서 치운다.
delete from public.cart_items
where user_id = '00000000-0000-4000-8000-000000000d01'
  and good_id = 'bank-blocked-goods';

-- ---------------------------------------------------------------------------
-- attempt 준비 — 수단이 어긋나면 열리지 않는다
-- ---------------------------------------------------------------------------
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.prepare_goods_payment_attempt(
      '00000000-0000-4000-8000-000000000d01',
      (select id from public.orders where checkout_key = '9a000000-0000-4000-8000-000000000001'),
      'korpay'::public.payment_provider
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then accepted := false;
  end;

  if accepted then
    raise exception 'a bank transfer order must not open a card attempt';
  end if;
end;
$$;

-- 다시 불러도 같은 attempt를 돌려준다. 재시도가 두 번째 선점을 만들면 안 된다.
select public.prepare_goods_payment_attempt(
  '00000000-0000-4000-8000-000000000d01',
  :'bank_order_id'::uuid,
  'bank_transfer'::public.payment_provider
);

select 1 / case when (
  select count(*) = 1
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_prepare_is_idempotent;

-- attempt TTL이 곧 입금 기한이다. 짧게 잡히면 입금 확인이 만료된 attempt를
-- 붙잡고 실패한다.
select 1 / case when (
  select attempt.state = 'prepared'
    and attempt.expires_at = orders.expires_at
  from public.payment_attempts as attempt
  join public.orders on orders.id = attempt.ref_id
  where attempt.ref_id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_attempt_ttl_matches_the_deposit_deadline;

-- ---------------------------------------------------------------------------
-- 입금 확인 — 증빙을 남기고 finalizer가 확정한다
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

-- 근거 메모 없는 확정은 없다.
do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_confirm_bank_transfer_deposit(
      (select id from public.orders where checkout_key = '9a000000-0000-4000-8000-000000000001'),
      '입금'
    );
    accepted := true;
  exception
    when check_violation then accepted := false;
  end;

  if accepted then
    raise exception 'a deposit confirmation must carry a memo';
  end if;
end;
$$;

select public.admin_confirm_bank_transfer_deposit(
  :'bank_order_id'::uuid,
  '국민 23,000원 홍길동AB12CD34 대조 완료'
) as confirm_outcome \gset

select 1 / case when :'confirm_outcome' = 'approved' then 1 else 0 end
  as assert_confirmation_approves;

reset role;

-- 주문·원장이 카드 결제와 같은 자리에 착지한다.
select 1 / case when (
  select orders.status = 'paid'
    and orders.expires_at is null
  from public.orders
  where orders.id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_confirmed_order_is_paid;

select 1 / case when (
  select count(*) = 1
    and bool_and(payment.provider = 'bank_transfer')
    and bool_and(payment.status = 'paid')
    and bool_and(payment.amount = 23000)
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_ledger_records_bank_transfer;

select 1 / case when (
  select count(*) = 1
    and bool_and(confirmation.confirmed_by = '00000000-0000-4000-8000-000000000d02')
    and bool_and(confirmation.memo like '%대조 완료%')
  from public.bank_transfer_confirmations as confirmation
  where confirmation.order_id = :'bank_order_id'::uuid
) then 1 else 0 end as assert_confirmation_evidence_is_recorded;

select 1 / case when (
  select count(*) = 1
  from public.audit_log
  where action = 'admin.order.bank_transfer_confirmed'
    and target = 'order:' || :'bank_order_id'
) then 1 else 0 end as assert_confirmation_is_audited;

-- 두 번 눌러도 두 번 확정되지 않는다. attempt가 이미 종결이라 거절된다.
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_confirm_bank_transfer_deposit(
      (select id from public.orders where checkout_key = '9a000000-0000-4000-8000-000000000001'),
      '중복 확인 시도입니다'
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then accepted := false;
  end;

  if accepted then
    raise exception 'a confirmed deposit must not be confirmed twice';
  end if;
end;
$$;

-- 확정된 주문은 미입금 목록에서 사라진다.
select 1 / case when (
  select count(*) = 0
  from public.admin_unpaid_bank_transfer_orders()
  where order_id = (select id from public.orders where checkout_key = '9a000000-0000-4000-8000-000000000001')
) then 1 else 0 end as assert_paid_order_leaves_the_unpaid_queue;

-- ---------------------------------------------------------------------------
-- 기한 연장 — 1회, 주문과 attempt를 함께
-- ---------------------------------------------------------------------------
reset role;
-- 주문 생성과 attempt 준비는 service role 경계 안에 있다. 스모크는 superuser
-- 세션에서 그 경계를 직접 부른다 — 브라우저 롤로는 닿을 수 없는 경로다.
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000d01'::uuid,
  jsonb_build_object(
    'recipientName', '연장',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9a000000-0000-4000-8000-000000000004'::uuid,
  'bank_transfer'::public.order_payment_method
) as extend_order_id \gset

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

select public.admin_extend_bank_transfer_deadline(
  :'extend_order_id'::uuid,
  '구매자가 은행 점검으로 밤에 입금하겠다고 연락'
);

reset role;
select 1 / case when (
  select orders.bank_transfer_extended_at is not null
    and orders.expires_at between now() + interval '23 hours' and now() + interval '25 hours'
    and attempt.expires_at = orders.expires_at
  from public.orders
  join public.payment_attempts as attempt on attempt.ref_id = orders.id
  where orders.id = :'extend_order_id'::uuid
) then 1 else 0 end as assert_extension_moves_order_and_attempt_together;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_extend_bank_transfer_deadline(
      (select id from public.orders where checkout_key = '9a000000-0000-4000-8000-000000000004'),
      '두 번째 연장을 시도합니다'
    );
    accepted := true;
  exception
    when object_not_in_prerequisite_state then accepted := false;
  end;

  if accepted then
    raise exception 'a deposit deadline must be extendable only once';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 즉시 취소 — 재고만 되돌린다
-- ---------------------------------------------------------------------------
reset role;
select 1 / case when (
  select stock_qty = 7 from public.goods where id = 'bank-goods'
) then 1 else 0 end as assert_stock_is_reserved_while_unpaid;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

select public.admin_cancel_unpaid_bank_transfer_order(
  :'extend_order_id'::uuid,
  '기한 연장 후에도 입금이 없어 취소합니다'
);

reset role;
select 1 / case when (
  select orders.status = 'canceled'
  from public.orders
  where orders.id = :'extend_order_id'::uuid
) then 1 else 0 end as assert_unpaid_cancel_closes_the_order;

select 1 / case when (
  select stock_qty = 8 from public.goods where id = 'bank-goods'
) then 1 else 0 end as assert_unpaid_cancel_restores_stock;

-- 미입금 취소는 돈을 만들지 않는다. 환불 원장이 열리면 없는 돈을 되돌리게 된다.
select 1 / case when (
  select count(*) = 0
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = :'extend_order_id'::uuid
) then 1 else 0 end as assert_unpaid_cancel_creates_no_payment;

-- ---------------------------------------------------------------------------
-- 확정이 needs_review로 멈춰도 출구가 있다
-- ---------------------------------------------------------------------------
-- finalizer는 확정 직전 상태를 다시 본다. 거기서 걸리면 attempt가 `prepared`를
-- 벗어나는데, 그 상태를 취소도 못 하게 두면 주문이 재고를 문 채 콘솔에서
-- 빠져나갈 길이 없어진다(만료 스윕도 needs_review attempt는 건너뛴다).
reset role;

insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-goods', 1);

select public.place_order(
  '00000000-0000-4000-8000-000000000d01'::uuid,
  jsonb_build_object(
    'recipientName', '정합화',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9a000000-0000-4000-8000-000000000006'::uuid,
  'bank_transfer'::public.order_payment_method
) as stuck_order_id \gset

-- 입금 확인 직전에 계정이 정지됐다. finalizer의 approved 가드가 여기서 걸린다.
update public.profiles
set suspended_at = now(), suspension_reason = '무통장 스모크용 정지'
where id = '00000000-0000-4000-8000-000000000d01';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

select public.admin_confirm_bank_transfer_deposit(
  :'stuck_order_id'::uuid,
  '국민 23,000원 정합화 대조 완료'
) as stuck_outcome \gset

select 1 / case when :'stuck_outcome' <> 'approved' then 1 else 0 end
  as assert_fenced_confirmation_does_not_approve;

reset role;

select 1 / case when (
  select attempt.state = 'needs_review'
  from public.payment_attempts as attempt
  where attempt.ref_id = :'stuck_order_id'::uuid
) then 1 else 0 end as assert_stuck_attempt_leaves_prepared;

-- 만료 스윕은 이 상태를 건드리지 않는다 — 그래서 운영자 출구가 필요하다.
update public.orders
set expires_at = now() - interval '10 minutes'
where id = :'stuck_order_id'::uuid;

select public.expire_stale_checkouts();

select 1 / case when (
  select orders.status = 'pending'
  from public.orders
  where orders.id = :'stuck_order_id'::uuid
) then 1 else 0 end as assert_sweep_leaves_a_needs_review_order_alone;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

select public.admin_cancel_unpaid_bank_transfer_order(
  :'stuck_order_id'::uuid,
  '정합화가 필요한 상태로 멈춰 재고를 되돌린다'
);

reset role;

select 1 / case when (
  select orders.status = 'canceled'
  from public.orders
  where orders.id = :'stuck_order_id'::uuid
) then 1 else 0 end as assert_operator_can_release_a_stuck_order;

update public.profiles
set suspended_at = null, suspension_reason = null
where id = '00000000-0000-4000-8000-000000000d01';

-- ---------------------------------------------------------------------------
-- 만료 스윕 — 24시간이 지나면 자동 취소
-- ---------------------------------------------------------------------------
-- 주문 생성과 attempt 준비는 service role 경계 안에 있다. 스모크는 superuser
-- 세션에서 그 경계를 직접 부른다 — 브라우저 롤로는 닿을 수 없는 경로다.
reset role;
insert into public.cart_items (user_id, good_id, qty)
values ('00000000-0000-4000-8000-000000000d01', 'bank-goods', 2);

select public.place_order(
  '00000000-0000-4000-8000-000000000d01'::uuid,
  jsonb_build_object(
    'recipientName', '만료',
    'phone', '01012345678',
    'postalCode', '06236',
    'address1', '서울시 강남구'
  ),
  '9a000000-0000-4000-8000-000000000005'::uuid,
  'bank_transfer'::public.order_payment_method
) as expiring_order_id \gset

reset role;

-- 기한 안에서는 스윕이 건드리지 않는다.
select public.expire_stale_checkouts();

select 1 / case when (
  select orders.status = 'pending'
  from public.orders
  where orders.id = :'expiring_order_id'::uuid
) then 1 else 0 end as assert_sweep_respects_the_deposit_window;

-- 기한과 유예가 지나면 재고를 돌려준다.
update public.orders
set expires_at = now() - interval '10 minutes'
where id = :'expiring_order_id'::uuid;
update public.payment_attempts
set expires_at = now() - interval '10 minutes'
where ref_id = :'expiring_order_id'::uuid;

select public.expire_stale_checkouts();

select 1 / case when (
  select orders.status = 'canceled'
  from public.orders
  where orders.id = :'expiring_order_id'::uuid
) then 1 else 0 end as assert_sweep_cancels_an_unpaid_bank_transfer_order;

select 1 / case when (
  select stock_qty = 8 from public.goods where id = 'bank-goods'
) then 1 else 0 end as assert_sweep_restores_stock;

-- ---------------------------------------------------------------------------
-- 굿즈 토글 · 비 staff 차단
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d02', true);

select public.admin_set_good_bank_transfer('bank-goods', false);

reset role;
select 1 / case when (
  select not allow_bank_transfer from public.goods where id = 'bank-goods'
) then 1 else 0 end as assert_staff_can_close_bank_transfer_on_a_good;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000d01', true);

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_set_good_bank_transfer('bank-goods', true);
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not toggle bank transfer on a good';
  end if;
end;
$$;

do $$
declare
  accepted boolean := false;
begin
  begin
    perform public.admin_unpaid_bank_transfer_orders();
    accepted := true;
  exception
    when insufficient_privilege then accepted := false;
  end;

  if accepted then
    raise exception 'a buyer must not read the unpaid queue';
  end if;
end;
$$;

reset role;

rollback;

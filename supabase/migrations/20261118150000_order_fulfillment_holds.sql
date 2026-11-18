-- 주문 출고 보류(원장 PAY-050·SHP-093·OPS-074·OPS-065·CLM-051).
--
-- 결제완료인데 돈이 실제로 들어오지 않았거나 결제사에서 이미 취소된 주문이 자동 발주확인 → 출고지시로 창고 파일에 섞이지 않게
-- 주문 단위 '출고 보류'를 둔다. 사유는 둘이다.
--  * test_payment: 운영 배포가 토스 테스트 키로 결제 준비(prepare)한 시도가 승인됐다. 앱이 prepare 때 그 시도의 키 모드를
--    private.payment_attempt_key_modes에 남기고(운영 배포에서만 — 로컬·preview·스테이징은 토스 게이트웨이가 없어 남기지 않는다),
--    승인 전이(payment_attempts.state → approved) 트리거가 보류 행을 만든다. 판정(order_fulfillment_hold_reasons)은 보류 행이 없어도
--    키 모드에서 직접 다시 읽는다 — 트리거가 실패해도(결제 확정은 되돌리지 않는다) 출고는 막힌다.
--  * provider_canceled: 토스 웹훅이 종결(approved) 결제에 오면 앱이 결제사 조회(원장을 바꾸지 않는 잔액 조회)로 상태를 확인하고,
--    결제사 취소 금액 중 우리 원장이 설명하지 못하는 몫(결제사 취소 − 적용된 부분 환불)이 있으면 보류를 남긴다.
--    우리가 결제사 취소를 냈을 수 있는 상태(취소·반품 요청 processing·needs_review, 취소 claim 행, 처리 중 부분 취소, 환불 대기)면
--    판정을 미루고(in_flight) 관측을 대기 기록에 남긴다 — 그 상태가 끝나면 5분 주기 sweep이 같은 관측으로 다시 판정한다
--    (결제사 취소는 되돌릴 수 없어 관측은 하한이다). 웹훅 재전송도 계속 받는다. 위조 웹훅의 조회 폭주는 시도별 2분 쿨다운이 막는다.
-- 보류의 효과는 주문이 아직 나가지 않았을 때만 '출고 차단'이다(order_fulfillment_blocking: 결제 대기·신규주문·발주확인 상태이거나
-- 발송 전 배송 건이 남음). 자동 발주확인 제외(fulfillment_hold), 출고지시 후보·내보내기·묶음 출고 제외, 수동 발주확인·출고 경로 공통
-- 검사(private.assert_order_dispatch_allowed)·주문의 첫 발송 전이 거절, 강제 배송완료·예약 할당·운송장 회신 후보 표시. 배송완료·
-- 거래확정은 막지 않는다 — 이미 나간 물건의 도착 기록을 막으면 택배 추적 자동 배송완료가 계속 실패할 뿐 물건은 돌아오지 않는다
-- (발송 뒤 보류는 경고이고 반품 접수 또는 사유 적고 해제가 운영 몫이다). 교환 재출고는 보류가 있으면 언제나 막는다.
-- 해제는 sales.manage 운영자가 사유를 적어서 하고(감사 기록), 주문이 취소되면 보류는 자동으로 닫힌다(판정도 취소 주문은 보지 않는다).
begin;

create function private.t1_hold_patch_function(p_function regprocedure, p_pairs text[]) returns void
language plpgsql set search_path = '' as $$
declare definition text := pg_get_functiondef(p_function); i integer;
begin
  if array_length(p_pairs, 1) is null or array_length(p_pairs, 1) % 2 <> 0 then raise exception 't1 hold patch pairs'; end if;
  for i in 1 .. array_length(p_pairs, 1) / 2 loop
    if (length(definition) - length(replace(definition, p_pairs[2 * i - 1], ''))) / length(p_pairs[2 * i - 1]) <> 1 then
      raise exception '% anchor % must appear once', p_function, i;
    end if;
    definition := replace(definition, p_pairs[2 * i - 1], p_pairs[2 * i]);
  end loop;
  execute definition;
end $$;

-- 1. 결제 시도의 토스 키 모드. 운영 배포의 굿즈 결제 준비가 남긴다(라이브 키도 남겨 원장에서 구분한다).
create table private.payment_attempt_key_modes (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  key_mode text not null check (key_mode in ('test', 'live')),
  recorded_at timestamptz not null default clock_timestamp()
);
create index payment_attempt_key_modes_test on private.payment_attempt_key_modes(attempt_id) where key_mode = 'test';
alter table private.payment_attempt_key_modes enable row level security;
revoke all on private.payment_attempt_key_modes from public, anon, authenticated, service_role;

-- 2. 출고 보류. (주문, 사유, 근거) 하나에 행 하나 — 같은 근거는 해제된 뒤에도 다시 걸리지 않는다(웹훅 재전송·역순 도착에 멱등).
--    근거: test_payment는 결제 시도, provider_canceled는 결제 시도와 결제사가 취소한 누계 금액(더 취소되면 새 보류).
create table private.order_fulfillment_holds (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  reason text not null check (reason in ('test_payment', 'provider_canceled')),
  evidence_key text not null,
  payment_attempt_id uuid references public.payment_attempts(id),
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  released_at timestamptz,
  release_kind text check (release_kind in ('operator', 'order_canceled')),
  released_by uuid references public.profiles(id) on delete set null,
  release_note text check (release_note is null or (release_note = btrim(release_note) and char_length(release_note) between 5 and 500)),
  constraint order_fulfillment_holds_evidence check (
    (reason = 'test_payment' and payment_attempt_id is not null and evidence_key = 'test_payment:' || payment_attempt_id::text)
    or (reason = 'provider_canceled' and payment_attempt_id is not null and evidence_key ~ ('^provider_canceled:' || payment_attempt_id::text || ':[1-9][0-9]{0,14}$'))),
  constraint order_fulfillment_holds_release check (
    (released_at is null) = (release_kind is null)
    and (release_kind is distinct from 'operator' or release_note is not null)
    and (release_kind is distinct from 'order_canceled' or release_note is null)),
  constraint order_fulfillment_holds_evidence_key unique (order_id, reason, evidence_key)
);
create index order_fulfillment_holds_active on private.order_fulfillment_holds(order_id) where released_at is null;
create index order_fulfillment_holds_attempt on private.order_fulfillment_holds(payment_attempt_id);
alter table private.order_fulfillment_holds enable row level security;
revoke all on private.order_fulfillment_holds from public, anon, authenticated, service_role;

-- 3. 판정. 취소된 주문은 보지 않는다. 테스트 키 승인은 보류 행이 없어도(트리거 실패) 키 모드에서 직접 보류로 읽는다.
create function private.order_fulfillment_hold_reasons(p_order_id uuid) returns text[]
language sql stable security definer set search_path = '' as $$
  select case when not exists(select 1 from public.orders o where o.id = p_order_id and o.status <> 'canceled') then '{}'::text[]
    else coalesce((select array_agg(distinct r.reason order by r.reason) from (
      select h.reason from private.order_fulfillment_holds h where h.order_id = p_order_id and h.released_at is null
      union all
      select 'test_payment' from public.payment_attempts a join private.payment_attempt_key_modes k on k.attempt_id = a.id
      where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved' and k.key_mode = 'test'
        and not exists(select 1 from private.order_fulfillment_holds h where h.order_id = p_order_id and h.evidence_key = 'test_payment:' || a.id::text)
    ) r), '{}'::text[]) end;
$$;
revoke all on function private.order_fulfillment_hold_reasons(uuid) from public, anon, authenticated, service_role;

create function private.order_fulfillment_held(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(cardinality(private.order_fulfillment_hold_reasons(p_order_id)) > 0, false);
$$;
revoke all on function private.order_fulfillment_held(uuid) from public, anon, authenticated, service_role;

-- 보류가 출고를 막는가. 아직 나가지 않은 주문(결제 대기·신규주문·발주확인)이거나 발송 전 배송 건이 남아 있을 때만이다.
-- 다 나간 주문(배송중·배송완료·거래확정, 발송 전 배송 건 없음)의 보류는 경고다 — 배송완료 기록을 막지 않는다.
create function private.order_fulfillment_blocking(p_order_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.order_fulfillment_held(p_order_id) and exists(select 1 from public.orders o where o.id = p_order_id
    and (o.status in ('pending', 'paid', 'confirmed')
      or exists(select 1 from public.order_shipments s where s.order_id = o.id and s.status = 'ready')));
$$;
revoke all on function private.order_fulfillment_blocking(uuid) from public, anon, authenticated, service_role;

-- 보류 중인(취소되지 않은) 주문. 운영 할 일·목록 패널이 쓴다. 작은 표(보류·테스트 키)에서 출발한다.
create function private.order_fulfillment_held_orders() returns table(order_id uuid, placed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select x.order_id, min(x.placed_at) from (
    select h.order_id, h.created_at as placed_at from private.order_fulfillment_holds h join public.orders o on o.id = h.order_id
    where h.released_at is null and o.status <> 'canceled'
    union all
    select a.ref_id, a.updated_at from private.payment_attempt_key_modes k join public.payment_attempts a on a.id = k.attempt_id
    join public.orders o on o.id = a.ref_id
    where k.key_mode = 'test' and a.purpose = 'order' and a.state = 'approved' and o.status <> 'canceled'
      and not exists(select 1 from private.order_fulfillment_holds h where h.order_id = a.ref_id and h.evidence_key = 'test_payment:' || a.id::text)
  ) x group by x.order_id;
$$;
revoke all on function private.order_fulfillment_held_orders() from public, anon, authenticated, service_role;

-- 테스트 키 승인의 보류 행을 만든다(이미 있으면 그대로 — 해제된 행도 다시 걸지 않는다). 만든 행 수를 돌려준다.
create function private.materialize_order_fulfillment_holds(p_order_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare inserted integer;
begin
  insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
  select p_order_id, 'test_payment', 'test_payment:' || a.id::text, a.id,
    jsonb_build_object('keyMode', 'test', 'paymentAmount', a.amount)
  from public.payment_attempts a join private.payment_attempt_key_modes k on k.attempt_id = a.id
  where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved' and k.key_mode = 'test'
  on conflict (order_id, reason, evidence_key) do nothing;
  get diagnostics inserted = row_count;
  return inserted;
end $$;
revoke all on function private.materialize_order_fulfillment_holds(uuid) from public, anon, authenticated, service_role;

-- 4. 승인 전이에서 테스트 키 보류를 남긴다. 실패해도 결제 확정을 되돌리지 않는다(판정이 키 모드를 직접 다시 읽는다).
create function private.place_test_payment_fulfillment_hold() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if private.materialize_order_fulfillment_holds(new.ref_id) > 0 then
      insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_placed', 'order:' || new.ref_id,
        jsonb_build_object('reason', 'test_payment', 'attemptId', new.id, 'keyMode', 'test'));
    end if;
  exception when others then
    raise warning 'order fulfillment hold materialization failed (attempt %, sqlstate %)', new.id, sqlstate;
  end;
  return null;
end $$;
revoke all on function private.place_test_payment_fulfillment_hold() from public, anon, authenticated, service_role;
create trigger payment_attempt_test_payment_hold after update of state on public.payment_attempts
  for each row when (new.state = 'approved' and old.state is distinct from new.state and new.purpose = 'order'
    and new.provider = 'toss' and new.ref_id is not null)
  execute function private.place_test_payment_fulfillment_hold();

-- 주문이 취소되면 남은 보류를 닫는다(판정은 이미 취소 주문을 보지 않는다 — 기록 정리와 감사용).
create function private.release_order_fulfillment_holds_on_cancel() returns trigger
language plpgsql security definer set search_path = '' as $$
declare released integer;
begin
  update private.order_fulfillment_holds set released_at = clock_timestamp(), release_kind = 'order_canceled'
  where order_id = new.id and released_at is null;
  get diagnostics released = row_count;
  if released > 0 then
    insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_released', 'order:' || new.id,
      jsonb_build_object('trigger', 'order_canceled', 'released', released));
  end if;
  return null;
end $$;
revoke all on function private.release_order_fulfillment_holds_on_cancel() from public, anon, authenticated, service_role;
create trigger orders_release_fulfillment_holds after update of status on public.orders
  for each row when (new.status = 'canceled' and old.status is distinct from new.status)
  execute function private.release_order_fulfillment_holds_on_cancel();

-- 5. 결제 준비 때 키 모드를 남긴다(service_role 전용). 결제 전(prepared)에만 바꿀 수 있고, 이미 남긴 값과 다른 모드로
--    승인 뒤 덮어쓰지 않는다. 행이 없으면 상태와 무관하게 남긴다(테스트 키라면 그 즉시 보류로 읽힌다 — 출고 쪽으로 안전하다).
create function public.service_record_goods_payment_key_mode(p_attempt_id uuid, p_key_mode text) returns void
language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts; current_mode text;
begin
  if p_attempt_id is null or p_key_mode is null or p_key_mode not in ('test', 'live') then
    raise invalid_parameter_value using message = 'invalid_payment_key_mode';
  end if;
  select * into attempt from public.payment_attempts where id = p_attempt_id for update;
  if not found or attempt.provider <> 'toss' or attempt.purpose <> 'order' then
    raise no_data_found using message = 'payment_attempt_not_found';
  end if;
  select key_mode into current_mode from private.payment_attempt_key_modes where attempt_id = p_attempt_id;
  if not found then
    insert into private.payment_attempt_key_modes(attempt_id, key_mode) values (p_attempt_id, p_key_mode);
  elsif current_mode <> p_key_mode then
    if attempt.state <> 'prepared' then raise check_violation using message = 'payment_key_mode_locked'; end if;
    update private.payment_attempt_key_modes set key_mode = p_key_mode, recorded_at = clock_timestamp() where attempt_id = p_attempt_id;
  end if;
end $$;
revoke all on function public.service_record_goods_payment_key_mode(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.service_record_goods_payment_key_mode(uuid, text) to service_role;

-- 6. 결제사 직접 취소 감지.
--    시도별 감지 기록: 마지막 결제사 조회 시각(쿨다운), 가장 많이 취소된 관측(잔액 최소), 판정 대기 여부. 결제사 취소는 되돌릴 수
--    없으므로 관측한 잔액은 그 뒤 잔액의 상한이다 — 대기 판정을 나중에 같은 관측으로 다시 해도 놓치는 보류가 없다.
create table private.goods_provider_cancellation_checks (
  attempt_id uuid primary key references public.payment_attempts(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  last_lookup_at timestamptz not null,
  observed_status text check (observed_status is null or observed_status ~ '^[A-Z_]{1,40}$'),
  observed_balance bigint check (observed_balance is null or observed_balance >= 0),
  observed_at timestamptz,
  case_ref text check (case_ref is null or case_ref ~ '^[A-Za-z0-9_-]{16,128}$'),
  pending boolean not null default false,
  pending_since timestamptz,
  last_verdict text check (last_verdict is null or last_verdict in ('held', 'already_recorded', 'consistent', 'in_flight', 'not_applicable')),
  updated_at timestamptz not null default clock_timestamp(),
  check (not pending or (pending_since is not null and observed_balance is not null and observed_status is not null and case_ref is not null))
);
create index goods_provider_cancellation_checks_pending on private.goods_provider_cancellation_checks(pending_since) where pending;
alter table private.goods_provider_cancellation_checks enable row level security;
revoke all on private.goods_provider_cancellation_checks from public, anon, authenticated, service_role;

-- 앱이 웹훅을 받은 종결 결제를 조회하기 전에 부른다(service_role). 대상: 토스 굿즈 결제 승인 + 결제 원장 paid + 결제 키 있음 +
-- 주문 미취소. 대상이 아니면 null. 같은 시도를 2분 안에 이미 조회했으면 조회하지 않게 {status:'cooldown'}(서명 없는 위조 웹훅이
-- 결제사 조회·주문 잠금을 무제한 부르지 못하게 한다 — 라우트는 503으로 남겨 진짜 웹훅이면 쿨다운 뒤 재전송이 다시 본다).
-- 조회할 차례면 마지막 조회 시각을 지금으로 적고 시도·원장 결제 키를 돌려준다(돈·주문 상태는 바꾸지 않는다).
create function public.service_begin_goods_provider_cancellation_check(p_attempt_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts; ledger_key text; claimed uuid;
begin
  if p_attempt_id is null then raise invalid_parameter_value using message = 'invalid_provider_cancellation'; end if;
  select a.* into attempt from public.payment_attempts a
  where a.id = p_attempt_id and a.provider = 'toss' and a.purpose = 'order' and a.state = 'approved' and a.ref_id is not null;
  if not found then return null; end if;
  select p.payment_key into ledger_key from public.payments p join public.orders o on o.id = p.ref_id
  where p.id = attempt.payment_id and p.purpose = 'order' and p.ref_id = attempt.ref_id and p.status = 'paid' and p.payment_key is not null
    and o.status <> 'canceled';
  if not found then return null; end if;
  insert into private.goods_provider_cancellation_checks as checks(attempt_id, order_id, last_lookup_at)
  values (attempt.id, attempt.ref_id, clock_timestamp())
  on conflict (attempt_id) do update set last_lookup_at = excluded.last_lookup_at, updated_at = clock_timestamp()
    where checks.last_lookup_at <= clock_timestamp() - interval '2 minutes'
  returning checks.attempt_id into claimed;
  if claimed is null then return jsonb_build_object('status', 'cooldown'); end if;
  return jsonb_build_object('status', 'proceed',
    'attempt', jsonb_build_object('id', attempt.id, 'provider', attempt.provider, 'purpose', attempt.purpose, 'ref_id', attempt.ref_id,
      'amount', attempt.amount, 'currency', attempt.currency, 'idempotency_key', attempt.idempotency_key, 'provider_order_id', attempt.provider_order_id,
      'provider_product_code', attempt.provider_product_code, 'expires_at', attempt.expires_at),
    'paymentKey', ledger_key);
end $$;
revoke all on function public.service_begin_goods_provider_cancellation_check(uuid) from public, anon, authenticated, service_role;
grant execute on function public.service_begin_goods_provider_cancellation_check(uuid) to service_role;

-- 관측(결제사 상태·잔액)을 원장과 대조한다. 웹훅(service_flag_…)과 대기 sweep이 같은 판정을 쓴다. 돌려주는 판정:
--  held(새 보류) · already_recorded(같은 근거가 이미 있음 — 해제된 것 포함) · consistent(원장이 그 취소를 설명한다·취소 없음) ·
--  in_flight(우리가 결제사 취소를 냈을 수 있는 처리가 진행 중 — 대기 기록) · not_applicable(대상 아님).
-- 근거 키는 '설명되지 않은 금액'(결제사 취소 − 적용된 부분 환불)이다. 해제 뒤 우리 부분 취소가 적용돼도 같은 근거라 다시 걸리지 않고,
-- 결제사에서 더 취소되면 금액이 바뀌어 새 보류가 걸린다. 이 시도의 관측 중 가장 많이 취소된 값(잔액 최소)을 쓴다 — 역순 도착한
-- 옛 웹훅이 판정을 되돌리지 못한다.
create function private.apply_goods_provider_cancellation(p_attempt_id uuid, p_provider_status text, p_provider_balance bigint, p_case_ref text)
returns text
language plpgsql security definer set search_path = '' as $$
declare attempt public.payment_attempts; payment public.payments; purchase public.orders; canceled bigint; recorded bigint; unexplained bigint;
  inserted integer; hold_id uuid; verdict text; observed bigint;
begin
  select * into attempt from public.payment_attempts where id = p_attempt_id;
  if attempt.id is null or attempt.provider <> 'toss' or attempt.purpose <> 'order' or attempt.ref_id is null
    or attempt.state <> 'approved' or attempt.payment_id is null then
    verdict := 'not_applicable';
  else
    -- 주문 → 결제 순서로 잠근다(취소·클레임 경로와 같은 순서).
    select * into purchase from public.orders where id = attempt.ref_id for update;
    select * into payment from public.payments where id = attempt.payment_id for share;
    if purchase.id is null or purchase.status = 'canceled' or payment.id is null or payment.status <> 'paid' then
      verdict := 'not_applicable';
    else
      select least(p_provider_balance, coalesce((select c.observed_balance from private.goods_provider_cancellation_checks c
        where c.attempt_id = attempt.id), p_provider_balance)) into observed;
      if p_provider_balance > payment.amount then raise invalid_parameter_value using message = 'invalid_provider_cancellation'; end if;
      canceled := payment.amount - observed;
      recorded := private.payment_partial_refunded_amount(payment.id);
      unexplained := canceled - recorded;
      if canceled = 0 or unexplained <= 0 then
        verdict := 'consistent';
      -- 우리가 결제사 취소를 냈을 수 있는 처리가 진행 중이면 미룬다. 접수만 된 요청(requested — 보류·회수 중 포함)은 결제사 취소를
      -- 낸 적이 없고, 교환은 환불을 만들지 않으므로 여기에 넣지 않는다.
      elsif exists(select 1 from public.order_cancellation_requests r where r.order_id = purchase.id
          and r.status in ('processing', 'needs_review') and r.claim_type <> 'exchange')
        or exists(select 1 from public.order_cancellation_claims c where c.order_id = purchase.id)
        or private.order_partial_cancel_in_flight(purchase.id)
        or exists(select 1 from public.refunds rf where rf.payment_id = payment.id and rf.status in ('requested', 'awaiting_transfer')) then
        verdict := 'in_flight';
      else
        insert into private.order_fulfillment_holds(order_id, reason, evidence_key, payment_attempt_id, detail)
        values (purchase.id, 'provider_canceled', 'provider_canceled:' || attempt.id::text || ':' || unexplained::text, attempt.id,
          jsonb_build_object('providerStatus', p_provider_status, 'providerCanceledAmount', canceled, 'recordedRefundedAmount', recorded,
            'unexplainedAmount', unexplained, 'paymentAmount', payment.amount, 'caseRef', p_case_ref))
        on conflict (order_id, reason, evidence_key) do nothing
        returning id into hold_id;
        get diagnostics inserted = row_count;
        if inserted = 0 then
          verdict := 'already_recorded';
        else
          verdict := 'held';
          insert into public.audit_log(actor_id, action, target, diff) values (null, 'system.order.fulfillment_hold_placed', 'order:' || purchase.id,
            jsonb_build_object('reason', 'provider_canceled', 'attemptId', attempt.id, 'providerStatus', p_provider_status,
              'providerCanceledAmount', canceled, 'recordedRefundedAmount', recorded, 'unexplainedAmount', unexplained, 'caseRef', p_case_ref));
          -- 결제사 직접 취소는 드물고 바로 확인할 일이라 운영 알림에도 남긴다(테스트 키 보류는 결제마다 생겨 알림에 싣지 않는다).
          insert into private.admin_operation_alerts(event_key, category, title, href)
          values ('order_fulfillment_holds:' || hold_id::text || ':placed', 'orders', '결제사에서 취소된 주문이 출고 보류되었습니다.', '/admin/sales/orders/' || purchase.id)
          on conflict (event_key) do nothing;
        end if;
      end if;
    end if;
  end if;
  -- 감지 기록: 관측을 남기고, 미룬 판정은 대기로 둔다(sweep이 다시 본다). 대상이 아닌 시도(주문 없음)는 남기지 않는다.
  if attempt.id is not null and attempt.ref_id is not null and exists(select 1 from public.orders where id = attempt.ref_id) then
    insert into private.goods_provider_cancellation_checks as checks(attempt_id, order_id, last_lookup_at, observed_status, observed_balance, observed_at,
      case_ref, pending, pending_since, last_verdict)
    values (attempt.id, attempt.ref_id, clock_timestamp(), p_provider_status, p_provider_balance, clock_timestamp(), p_case_ref,
      verdict = 'in_flight', case when verdict = 'in_flight' then clock_timestamp() end, verdict)
    on conflict (attempt_id) do update set
      observed_status = case when checks.observed_balance is null or excluded.observed_balance <= checks.observed_balance
        then excluded.observed_status else checks.observed_status end,
      observed_balance = least(coalesce(checks.observed_balance, excluded.observed_balance), excluded.observed_balance),
      observed_at = excluded.observed_at, case_ref = excluded.case_ref, pending = excluded.pending,
      pending_since = case when excluded.pending then coalesce(checks.pending_since, excluded.pending_since) end,
      last_verdict = excluded.last_verdict, updated_at = clock_timestamp();
  end if;
  return verdict;
end $$;
revoke all on function private.apply_goods_provider_cancellation(uuid, text, bigint, text) from public, anon, authenticated, service_role;

-- 웹훅 경로(service_role): 앱이 원장 결제 키로 조회한 결제사 상태·잔액을 넘긴다.
create function public.service_flag_goods_provider_cancellation(p_attempt_id uuid, p_provider_status text, p_provider_balance bigint, p_case_ref text)
returns text
language plpgsql security definer set search_path = '' as $$
begin
  if p_attempt_id is null or p_provider_status is null or p_provider_status !~ '^[A-Z_]{1,40}$'
    or p_provider_balance is null or p_provider_balance < 0 or p_case_ref is null or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise invalid_parameter_value using message = 'invalid_provider_cancellation';
  end if;
  return private.apply_goods_provider_cancellation(p_attempt_id, p_provider_status, p_provider_balance, p_case_ref);
end $$;
revoke all on function public.service_flag_goods_provider_cancellation(uuid, text, bigint, text) from public, anon, authenticated, service_role;
grant execute on function public.service_flag_goods_provider_cancellation(uuid, text, bigint, text) to service_role;

-- 미룬 판정 sweep(5분마다). 우리 처리가 끝났으면(완료·거절·철회·환불 확정) 저장한 관측으로 다시 판정한다. 시도마다 하위 트랜잭션이고
-- 잠금을 오래 기다리지 않는다(못 잡으면 다음 회차). 돌려주는 값은 대기를 끝낸 시도 수다.
create function private.sweep_goods_provider_cancellation_checks(p_limit integer default 200) returns integer
language plpgsql security definer set search_path = '' as $$
declare item record; settled integer := 0; verdict text;
begin
  perform set_config('lock_timeout', '3s', true);
  for item in select attempt_id, observed_status, observed_balance, case_ref from private.goods_provider_cancellation_checks
    where pending order by pending_since, attempt_id limit greatest(1, least(coalesce(p_limit, 200), 1000)) loop
    begin
      verdict := private.apply_goods_provider_cancellation(item.attempt_id, item.observed_status, item.observed_balance, item.case_ref);
      if verdict <> 'in_flight' then settled := settled + 1; end if;
    exception when lock_not_available or deadlock_detected then null;
    end;
  end loop;
  return settled;
end $$;
revoke all on function private.sweep_goods_provider_cancellation_checks(integer) from public, anon, authenticated, service_role;
-- cron.schedule은 이름 기준 upsert라 재적용에도 안전하다.
select cron.schedule('goods-provider-cancellation-sweep', '*/5 * * * *', 'select private.sweep_goods_provider_cancellation_checks()');

-- 7. 운영 화면 읽기. 주문 id별 보류 사유와 근거(금액·상태). 결제 키·원문은 싣지 않는다.
create function private.order_fulfillment_hold_document(p_order_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'reason', r.reason,
      'placedAt', coalesce(h.created_at, (select max(a.updated_at) from public.payment_attempts a
        where a.purpose = 'order' and a.ref_id = p_order_id and a.state = 'approved')),
      'providerStatus', h.detail->>'providerStatus',
      'providerCanceledAmount', (h.detail->>'providerCanceledAmount')::bigint,
      'unexplainedAmount', (h.detail->>'unexplainedAmount')::bigint,
      'paymentAmount', (h.detail->>'paymentAmount')::bigint,
      'outboundBlocked', private.order_fulfillment_blocking(p_order_id)) order by r.reason), '[]'::jsonb)
  from unnest(private.order_fulfillment_hold_reasons(p_order_id)) r(reason)
  left join lateral (select x.created_at, x.detail from private.order_fulfillment_holds x
    where x.order_id = p_order_id and x.reason = r.reason and x.released_at is null order by x.created_at desc, x.id desc limit 1) h on true;
$$;
revoke all on function private.order_fulfillment_hold_document(uuid) from public, anon, authenticated, service_role;

-- 읽기 RPC는 STABLE이라 PostgREST가 READ ONLY 트랜잭션으로 부른다 — 행을 잠그는 권한 검사(require_operator_capability)를 쓰지 않는다.
create function public.admin_order_fulfillment_holds(p_order_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_order_ids is null or coalesce(array_length(p_order_ids, 1), 0) > 200 then
    raise invalid_parameter_value using message = 'invalid_fulfillment_hold_query';
  end if;
  select coalesce(jsonb_object_agg(o.id::text, private.order_fulfillment_hold_document(o.id)), '{}'::jsonb) into result
  from public.orders o where o.id = any(p_order_ids) and private.order_fulfillment_held(o.id);
  return result;
end $$;
revoke all on function public.admin_order_fulfillment_holds(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_order_fulfillment_holds(uuid[]) to authenticated;

create function public.admin_list_order_fulfillment_holds(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.read', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_limit is null or p_limit not between 1 and 100 then raise invalid_parameter_value using message = 'invalid_fulfillment_hold_query'; end if;
  with held as materialized (select * from private.order_fulfillment_held_orders())
  select jsonb_build_object('total', (select count(*) from held),
    'items', coalesce((select jsonb_agg(jsonb_build_object('orderId', o.id, 'orderNumber', o.order_number, 'status', o.status,
        'holds', private.order_fulfillment_hold_document(o.id)) order by page.placed_at, page.order_id)
      from (select * from held order by placed_at, order_id limit p_limit) page join public.orders o on o.id = page.order_id), '[]'::jsonb))
  into result;
  return result;
end $$;
revoke all on function public.admin_list_order_fulfillment_holds(integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_list_order_fulfillment_holds(integer) to authenticated;

-- 발송처리·배송현황 화면의 행 표시(출고 전용 권한). 보류 중인 주문의 배송 건 id만 돌려준다 — 사유·금액·구매자 없음.
-- 발송 전(ready) 배송 건이면 출고가 막히고, 이미 나간 배송 건이면 경고다(화면이 배송 건 상태로 나눈다).
create function public.admin_shipment_fulfillment_hold_flags(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
  if auth.uid() is null or not public.has_operator_capability('sales.dispatch', false) then
    raise insufficient_privilege using message = 'operator_capability_required';
  end if;
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) > 1000 then
    raise exception using message = 'shipment_ids_invalid';
  end if;
  select coalesce(pg_catalog.jsonb_agg(s.id order by s.id), '[]'::jsonb) into result
  from public.order_shipments s where s.id = any(p_ids) and private.order_fulfillment_held(s.order_id);
  return result;
end $$;
revoke all on function public.admin_shipment_fulfillment_hold_flags(uuid[]) from public, anon, authenticated, service_role;
grant execute on function public.admin_shipment_fulfillment_hold_flags(uuid[]) to authenticated;

-- 8. 해제. sales.manage 운영자가 사유(5~500자)를 적는다. 같은 요청번호의 재요청은 처음 결과를 돌려준다.
create function public.admin_release_order_fulfillment_hold(p_order_id uuid, p_reason text, p_note text, p_operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; note text := btrim(coalesce(p_note, '')); released integer; previous public.audit_log;
begin
  actor := private.require_operator_capability('sales.manage', false);
  if p_order_id is null or p_operation_id is null or p_reason is null or p_reason not in ('test_payment', 'provider_canceled')
    or char_length(note) not between 5 and 500 or translate(note, E'\n\t', '') ~ '[[:cntrl:]]' then
    raise invalid_parameter_value using message = 'invalid_fulfillment_hold_release';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('order-fulfillment-hold-release:' || p_operation_id::text, 0));
  select * into previous from public.audit_log where id = p_operation_id;
  if found then
    if previous.actor_id is distinct from actor or previous.action <> 'admin.order.fulfillment_hold_released'
      or previous.target is distinct from 'order:' || p_order_id or previous.diff->>'reason' is distinct from p_reason then
      raise sqlstate 'PT409' using message = 'fulfillment_hold_operation_conflict';
    end if;
    return jsonb_build_object('operationId', p_operation_id, 'orderId', p_order_id, 'reason', p_reason,
      'released', (previous.diff->>'released')::integer, 'replayed', true);
  end if;
  perform 1 from public.orders where id = p_order_id for update;
  if not found then raise no_data_found using message = 'order_not_found'; end if;
  perform private.materialize_order_fulfillment_holds(p_order_id);
  update private.order_fulfillment_holds set released_at = clock_timestamp(), release_kind = 'operator', released_by = actor, release_note = note
  where order_id = p_order_id and reason = p_reason and released_at is null;
  get diagnostics released = row_count;
  if released = 0 then raise check_violation using message = 'fulfillment_hold_not_active'; end if;
  insert into public.audit_log(id, actor_id, action, target, diff) values (p_operation_id, actor, 'admin.order.fulfillment_hold_released',
    'order:' || p_order_id, jsonb_build_object('reason', p_reason, 'note', note, 'released', released));
  return jsonb_build_object('operationId', p_operation_id, 'orderId', p_order_id, 'reason', p_reason, 'released', released, 'replayed', false);
end $$;
revoke all on function public.admin_release_order_fulfillment_hold(uuid, text, text, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_release_order_fulfillment_hold(uuid, text, text, uuid) to authenticated;

-- 9. 기존 판정·출고 경로가 보류를 읽는다(앵커 치환).
-- 수동 발주확인·자동 발주확인(confirm_paid_order)·출고지시 완료 기록·배송 상태 전이·배송 방식·예약 할당 등 출고 경로 공통 검사.
select private.t1_hold_patch_function('private.assert_order_dispatch_allowed(uuid)'::regprocedure, array[
$a$    raise check_violation using message='order cancellation in progress';
  end if;$a$,
$a$    raise check_violation using message='order cancellation in progress';
  end if;
  -- 출고 보류(테스트 키 결제·결제사 직접 취소)가 아직 나가지 않은 물건의 발주확인·출고·발송·인계를 막는다.
  -- 다 나간 주문의 보류는 경고라 배송완료 기록 등은 막지 않는다(order_fulfillment_blocking).
  if private.order_fulfillment_blocking(target_order) then
    raise check_violation using message='order fulfillment hold';
  end if;$a$
]);

alter table private.auto_order_confirmation_outcomes drop constraint auto_order_confirmation_outcomes_outcome_check;
alter table private.auto_order_confirmation_outcomes add constraint auto_order_confirmation_outcomes_outcome_check
  check (outcome in ('confirmed', 'cancellation_in_progress', 'fulfillment_hold', 'preorder_unallocated', 'status_changed', 'locked', 'failed'));

select private.t1_hold_patch_function('private.auto_order_confirmation_blocker(uuid)'::regprocedure, array[
$a$ then 'cancellation_in_progress'$a$,
$a$ then 'cancellation_in_progress'
  when private.order_fulfillment_held(p_order_id) then 'fulfillment_hold'$a$
]);

select private.t1_hold_patch_function('public.admin_origin_pending_export_ids(uuid)'::regprocedure, array[
$a$   and not private.order_partial_cancel_in_flight(o.id)$a$,
$a$   and not private.order_partial_cancel_in_flight(o.id)
   and not private.order_fulfillment_held(o.id)$a$
]);

select private.t1_hold_patch_function('private.shipment_pack_ready(uuid)'::regprocedure, array[
$a$  or private.order_partial_cancel_in_flight(o.id)$a$,
$a$  or private.order_partial_cancel_in_flight(o.id)
  or private.order_fulfillment_held(o.id)$a$
]);

select private.t1_hold_patch_function('private.admin_shipment_export_before_preorder(uuid[])'::regprocedure, array[
$a$ or exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_partial_cancel_in_flight(s.order_id)) then raise check_violation using message='order cancellation in progress';end if;$a$,
$a$ or exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_partial_cancel_in_flight(s.order_id)) then raise check_violation using message='order cancellation in progress';end if;
 if exists(select 1 from public.order_shipments s where s.id=any(target_ids) and private.order_fulfillment_held(s.order_id)) then raise check_violation using message='order fulfillment hold';end if;$a$
]);

-- 주문이 처음 발송(결제 대기·신규주문·발주확인 → 배송중)될 때만 막는다. 배송완료·거래확정은 막지 않는다 — 이미 나간 물건의
-- 도착 기록이고, 막으면 택배 추적 자동 배송완료·자동 거래확정 묶음이 계속 실패할 뿐이다(발송 뒤 보류는 경고·반품 접수 몫).
select private.t1_hold_patch_function('public.guard_order_transition_during_cancellation()'::regprocedure, array[
$a$  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032)가 있으면 발송·배송완료로 넘어가지 않는다.$a$,
$a$  -- 출고 보류(테스트 키 결제·결제사 직접 취소)가 있으면 아직 나가지 않은 주문을 발송으로 넘기지 않는다.
  if new.status is distinct from old.status and new.status = 'shipping' and old.status in ('pending', 'paid', 'confirmed')
    and private.order_fulfillment_held(old.id) then
    raise exception using errcode = '23514', message = 'order fulfillment hold';
  end if;
  -- 결제사 확인을 기다리는 재고 부족 부분 취소(ADR-0032)가 있으면 발송·배송완료로 넘어가지 않는다.$a$
]);

-- 운영 할 일(운영 알림 패널)에 보류 건수. 주문 조회 권한(sales.read)에게 보인다.
select private.t1_hold_patch_function('public.admin_operation_tasks()'::regprocedure, array[
$a$'href','/admin/sales/orders?status=paid') payload where public.has_operator_capability('sales.read')$a$,
$a$'href','/admin/sales/orders?status=paid') payload where public.has_operator_capability('sales.read')
 union all
select 1.5,jsonb_build_object('id','fulfillment_hold','label','출고 보류','count',(select count(*) from private.order_fulfillment_held_orders()),'href','/admin/sales/orders') where public.has_operator_capability('sales.read')$a$
]);

-- 서원 운송장 회신 후보: 발송 전 배송 건이 보류 주문이면 표시한다 — 화면 대조가 그 줄만 실패로 돌리고 나머지 줄은 등록한다
-- (DB 일괄 등록의 사전 검증은 그대로 파일 전체를 거절하므로 보류 줄을 보내지 않는 것이 화면의 몫이다).
select private.t1_hold_patch_function('public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure, array[
$a$'orderId',c.order_id,'status',c.status,$a$,
$a$'orderId',c.order_id,'status',c.status,'fulfillmentHold',c.status='ready' and private.order_fulfillment_held(c.order_id),$a$
]);

-- 예약 주문 목록: 출고 보류로 실재고 할당이 막히는 주문을 표시한다(할당 묶음 전체가 실패하지 않게 화면이 고르지 못하게 한다).
select private.t1_hold_patch_function('public.admin_list_goods_preorder_reservations(text,text,integer,integer)'::regprocedure, array[
$a$'orderStatus',row.order_status,$a$,
$a$'orderStatus',row.order_status,'fulfillmentHold',private.order_fulfillment_blocking(row.order_id),$a$
]);

-- 강제 배송완료 미리보기: 아직 나가지 않은 물건이 있는 보류 주문은 막힌다(실행 쪽은 assert_order_dispatch_allowed가 같은 판정).
select private.t1_hold_patch_function('public.admin_force_order_delivery_preview(text)'::regprocedure, array[
$a$   blockers:=blockers||'production_incomplete'::text;end if;$a$,
$a$   blockers:=blockers||'production_incomplete'::text;end if;
  if exists(select 1 from (select distinct order_id from public.order_shipments where id=any(scope)) x where private.order_fulfillment_blocking(x.order_id)) then
   blockers:=blockers||'fulfillment_hold'::text;end if;$a$
]);

-- 교환 재출고: 보류가 있으면(발송 뒤 결제사 취소 포함) 새 교환품을 내보내지 않는다. 운영 화면(상세·일괄)이 쓰는 클레임 연락처
-- 진입점(service_record_order_claim_shipment_reshipment — v2 진입점도 이것을 부른다)과 옛 진입점(admin_record_order_claim_reshipment
-- → record_order_claim_reshipment_physical) 양쪽에서 막는다. 재고 증감 본체(private.record_order_claim_shipment_reshipment)는 고치지 않는다.
select private.t1_hold_patch_function('public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)'::regprocedure, array[
$a$ -- Preserve the explicit actor only for the already-verified physical call.$a$,
$a$ -- 출고 보류(테스트 결제·결제사 취소) 주문에는 교환품을 새로 내보내지 않는다.
 if private.order_fulfillment_held(p_order_id) then raise check_violation using message='order_fulfillment_hold';end if;
 -- Preserve the explicit actor only for the already-verified physical call.$a$
]);
select private.t1_hold_patch_function('private.record_order_claim_reshipment_physical(uuid,text,text,jsonb)'::regprocedure, array[
$a$ if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id) then$a$,
$a$ -- 출고 보류(테스트 결제·결제사 취소) 주문에는 교환품을 새로 내보내지 않는다(이미 기록된 재출고의 재생은 위에서 끝났다).
 if private.order_fulfillment_held(selected_order) then raise check_violation using message='order_fulfillment_hold';end if;
 if exists(select 1 from private.group_claim_reshipment_receipts where claim_id=p_claim_id) then$a$
]);

-- 10. 새 RPC·재정의한 함수의 운영자 계약(분류는 기존 행 그대로).
select private.register_operator_rpc_contract('public.admin_order_fulfillment_holds(uuid[])'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_list_order_fulfillment_holds(integer)'::regprocedure, 'sales.read', 'read', false);
select private.register_operator_rpc_contract('public.admin_shipment_fulfillment_hold_flags(uuid[])'::regprocedure, 'sales.dispatch', 'read', false);
select private.register_operator_rpc_contract('public.admin_release_order_fulfillment_hold(uuid,text,text,uuid)'::regprocedure, 'sales.manage', 'write', false);

do $$declare fn regprocedure; contract record; begin
  foreach fn in array array[
    'private.assert_order_dispatch_allowed(uuid)'::regprocedure,
    'private.auto_order_confirmation_blocker(uuid)'::regprocedure,
    'public.admin_origin_pending_export_ids(uuid)'::regprocedure,
    'private.shipment_pack_ready(uuid)'::regprocedure,
    'private.admin_shipment_export_before_preorder(uuid[])'::regprocedure,
    'public.guard_order_transition_during_cancellation()'::regprocedure,
    'public.admin_operation_tasks()'::regprocedure,
    'public.admin_origin_tracking_candidates(uuid,text[],text[])'::regprocedure,
    'public.admin_list_goods_preorder_reservations(text,text,integer,integer)'::regprocedure,
    'public.admin_force_order_delivery_preview(text)'::regprocedure,
    'public.service_record_order_claim_shipment_reshipment(uuid,uuid,uuid,uuid,uuid,uuid,integer,jsonb,jsonb,text,text,text,text,jsonb,jsonb,boolean)'::regprocedure,
    'private.record_order_claim_reshipment_physical(uuid,text,text,jsonb)'::regprocedure] loop
    select * into contract from private.operator_rpc_contracts r where r.signature::regprocedure = fn;
    if found then perform private.register_operator_rpc_contract(fn, contract.capability, contract.guard_kind, contract.legacy_admin_only);
    elsif exists(select 1 from private.operator_internal_contracts r where r.signature::regprocedure = fn) then
      perform private.register_operator_internal_contract(fn);
    end if;
  end loop;
end $$;

drop function private.t1_hold_patch_function(regprocedure, text[]);

commit;
notify pgrst, 'reload schema';

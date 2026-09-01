-- ==========================================================================
-- ICONS · 결제 provider 허용목록을 toss에 개방 (#387, 에픽 #384)
--
-- 토스 기본 PG 재전환의 DB 층이다. 결제 seam RPC가 provider를 'korpay'로
-- 하드코딩해 두고 있어, 어댑터·env·라우팅이 모두 준비돼도 토스 attempt는 DB
-- 문턱에서 먼저 거절된다. 이 마이그레이션은 그 허용목록만 연다 — 상태 기계,
-- 잠금 순서, 멱등 계약, 증빙 기록은 한 줄도 건드리지 않는다.
--
-- 열지 않는 것과 그 이유:
--   1. enum public.payment_provider — 'toss'는 이미 값으로 존재한다. 이번
--      변경은 값 추가가 아니라 허용목록 개방이다.
--   2. public.place_order — 주문 생성은 결제 provider를 모른다. 주문이 고정
--      하는 축은 payment_method(카드·무통장)이고, provider는 원장이 어느 경로
--      로 확정됐는지의 축이다. 카드 provider가 하나 늘어도 주문 계약은 그대로다.
--   3. 무통장 수동복구 3함수 — admin_goods_manual_recovery_attempts ·
--      claim_goods_manual_payment_recovery · finalize_goods_manual_payment_recovery
--      는 코페이 전용 운영 도구로 남긴다. 수동 취소 확인 seam은 코페이에
--      취소 API 자동화 경로가 없어서 만든 것이고, 토스 취소는 결제 API
--      자동화(#389)가 표준이다. 여기를 열면 API로 끝날 건을 운영자가 손으로
--      확정하는 우회로만 생긴다.
--   4. expire_stale_checkouts와 위임 함수 2종(finalize_ticket_payment_
--      reconciliation · finalize_ticket_refund_reconciliation) — provider
--      체크가 없어 바꿀 대상이 없다.
--
-- 아래 13개 함수는 각자의 최신 정의(함수마다 출처 주석)를 그대로 복제하고
-- provider 체크 라인만 바꾼 create or replace다. 본문 diff는 provider 라인
-- 외에 없다. create or replace는 ACL을 보존하지만, 봉인 상태를 이 파일 안에서
-- 읽을 수 있도록 함수마다 revoke/grant를 다시 명시한다(20260707090001 규율).
-- ==========================================================================

-- ---------------------------------------------------------------------------
-- 1. 굿즈 결제 seam
-- ---------------------------------------------------------------------------
-- 출처: 20260818140001_bank_transfer_payments.sql (prepare · finalize 최신 정의).
-- 토스는 카드 경로라 provider↔payment_method 정합 블록의 "무통장이 아니면
-- 주문 결제수단은 card" 가지에 그대로 편입되고, attempt TTL도 카드와 같은
-- 10분을 쓴다. 두 블록 모두 무변경이다.

-- prepare: 허용 provider 목록에 toss를 더한다.
create or replace function public.prepare_goods_payment_attempt(
  p_user_id uuid,
  p_order_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_attempt_id uuid;
  v_attempt_expires_at timestamptz;
begin
  if p_user_id is null
    or p_order_id is null
    or p_provider not in ('toss', 'korpay', 'bank_transfer')
  then
    raise exception 'goods_payment_unavailable' using errcode = '55000';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found or v_order.user_id is distinct from p_user_id then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  -- 결제수단은 주문 생성 시점에 고정된다. 선점 창(카드 15분 · 무통장 24시간)이
  -- 그때 결정되므로, 여기서 수단을 갈아타게 두면 재고 보유 시간이 주문 기록과
  -- 어긋난다. 바꾸려면 취소하고 다시 주문해야 한다.
  if (p_provider = 'bank_transfer' and v_order.payment_method <> 'bank_transfer')
    or (p_provider <> 'bank_transfer' and v_order.payment_method <> 'card')
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_method_mismatch';
  end if;

  if v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total <= 0
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  if private.is_account_write_fenced(p_user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.suspended_at is not null
    )
  then
    raise insufficient_privilege using message = 'goods_payment_account_blocked';
  end if;

  if not private.goods_order_snapshot_matches(
    v_order.id,
    v_order.total,
    v_order.shipping_fee
  ) then
    raise check_violation using message = 'goods_order_snapshot_mismatch';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = v_order.id
      and request.status in ('requested', 'processing', 'needs_review')
  ) or exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status in ('pending', 'paid')
  ) then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if found then
    if v_attempt.user_id is distinct from p_user_id
      or v_attempt.provider is distinct from p_provider
      or v_attempt.amount is distinct from v_order.total
      or v_attempt.currency is distinct from 'KRW'
      or v_attempt.state is distinct from 'prepared'
      or v_attempt.expires_at <= pg_catalog.clock_timestamp()
    then
      raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_not_preparable';
    end if;
    return private.goods_payment_attempt_json(v_attempt);
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  -- 카드 action은 10분이면 충분하고 짧을수록 안전하다. 무통장은 attempt TTL이
  -- 곧 입금 기한이라 주문 선점 창과 같아야 한다 — 짧게 잡으면 입금 확인이
  -- 만료된 attempt를 붙잡고 실패한다.
  v_attempt_expires_at := case
    when p_provider = 'bank_transfer' then v_order.expires_at
    else least(
      v_order.expires_at,
      pg_catalog.clock_timestamp() + interval '10 minutes'
    )
  end;

  insert into public.payment_attempts (
    id,
    provider,
    user_id,
    purpose,
    ref_id,
    amount,
    currency,
    state,
    idempotency_key,
    provider_order_id,
    provider_product_code,
    expires_at
  )
  values (
    v_attempt_id,
    p_provider,
    p_user_id,
    'order',
    v_order.id,
    v_order.total,
    'KRW',
    'prepared',
    'goods:' || v_order.id::text,
    'O' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    'P' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    v_attempt_expires_at
  )
  returning * into v_attempt;

  return private.goods_payment_attempt_json(v_attempt);
end;
$function$;

revoke all on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_goods_payment_attempt(
  uuid, uuid, public.payment_provider
) to service_role;

-- finalize: attempt 조회 2곳(사전 확인 · for update 재조회)의 provider 필터.
create or replace function public.finalize_goods_payment_attempt(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_outcome public.payment_attempt_state,
  p_provider_payment_key text default null,
  p_provider_transaction_id text default null,
  p_provider_approval_reference text default null,
  p_result_code text default null,
  p_payment_method text default null,
  p_masked_payment_method text default null,
  p_approved_at timestamptz default null
)
returns public.payment_attempt_state
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_final_outcome public.payment_attempt_state;
  v_payment_key text;
begin
  if p_attempt_id is null
    or p_claim_token is null
    or p_outcome is null
    or p_outcome not in ('approved', 'declined', 'canceled', 'unknown', 'needs_review')
  then
    raise invalid_parameter_value using message = 'goods_payment_finalization_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider in ('toss', 'korpay', 'bank_transfer');

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  -- Lost DB responses replay the already committed terminal state instead of
  -- repeating provider or fulfillment work.
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
    and attempt.provider in ('toss', 'korpay', 'bank_transfer')
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;

  if v_attempt.state is distinct from 'confirming'
    or v_attempt.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_claim_invalid';
  end if;

  v_final_outcome := p_outcome;
  v_payment_key := coalesce(
    nullif(pg_catalog.btrim(p_provider_payment_key), ''),
    nullif(pg_catalog.btrim(p_provider_transaction_id), '')
  );

  if p_outcome = 'approved' then
    -- Expiry is intentionally absent here. Once a valid callback claimed the
    -- attempt, provider finalization may finish after either expiry timestamp.
    if v_payment_key is null
      or v_order.user_id is distinct from v_attempt.user_id
      or v_order.status is distinct from 'pending'
      or v_order.total is distinct from v_attempt.amount
      or v_attempt.currency is distinct from 'KRW'
      or private.is_account_write_fenced(v_attempt.user_id)
      or exists (
        select 1
        from public.profiles as profile
        where profile.id = v_attempt.user_id
          and profile.suspended_at is not null
      )
      or not private.goods_order_snapshot_matches(
        v_order.id,
        v_order.total,
        v_order.shipping_fee
      )
      or exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = v_order.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      or exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = v_order.id
          and payment.status in ('pending', 'paid')
          and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
      )
      or (
        v_payment_key is not null
        and exists (
          select 1
          from public.payments as payment
          where payment.payment_key = v_payment_key
            and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
        )
      )
    then
      v_final_outcome := 'needs_review';
    end if;
  end if;

  if v_final_outcome = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.idempotency_key = 'attempt:' || v_attempt.id::text
    for update;

    if found then
      if v_payment.user_id is distinct from v_attempt.user_id
        or v_payment.purpose is distinct from 'order'
        or v_payment.ref_id is distinct from v_attempt.ref_id
        or v_payment.amount is distinct from v_attempt.amount
        or v_payment.provider is distinct from v_attempt.provider
        or v_payment.payment_key is distinct from v_payment_key
        or v_payment.status not in ('pending', 'paid')
        or v_payment.raw is not null
      then
        v_final_outcome := 'needs_review';
      end if;
    else
      begin
        insert into public.payments (
          user_id,
          purpose,
          ref_id,
          provider,
          amount,
          status,
          payment_key,
          idempotency_key,
          raw
        )
        values (
          v_attempt.user_id,
          'order',
          v_attempt.ref_id,
          v_attempt.provider,
          v_attempt.amount,
          'paid',
          v_payment_key,
          'attempt:' || v_attempt.id::text,
          null
        )
        returning * into v_payment;
      exception
        when unique_violation then
          -- A provider identifier racing across two orders is ambiguous. The
          -- inner subtransaction rolls back only this insert and preserves the
          -- claimed attempt for explicit reconciliation.
          v_final_outcome := 'needs_review';
      end;
    end if;
  end if;

  if v_final_outcome = 'approved' then
    update public.payments
    set status = 'paid'
    where id = v_payment.id;

    update public.orders
    set status = 'paid', expires_at = null
    where id = v_attempt.ref_id;

    -- Preserve the existing free-reward side effect. The independent global
    -- reward trigger remains OFF and suppresses inserts without rolling back a
    -- valid goods payment.
    insert into public.draw_tickets (
      user_id,
      pool_id,
      source,
      source_id,
      ordinal,
      reward_policy_id
    )
    select
      v_attempt.user_id,
      reward_policy.pool_id,
      'order_paid',
      v_attempt.ref_id,
      pg_catalog.row_number() over (
        order by reward_policy.id, grant_series.n
      ),
      reward_policy.id
    from public.reward_policies as reward_policy
    join public.card_pools as card_pool
      on card_pool.id = reward_policy.pool_id
    join lateral (
      select pg_catalog.sum(item.qty * item.unit_price) as target_subtotal
      from public.order_items as item
      where item.order_id = v_attempt.ref_id
        and item.good_ip_id_snapshot = reward_policy.target_ip_id
        and (
          reward_policy.target_good_id is null
          or item.good_id = reward_policy.target_good_id
        )
    ) as subtotal on true
    cross join lateral pg_catalog.generate_series(
      1,
      reward_policy.tickets_per_grant
    ) as grant_series(n)
    where reward_policy.trigger = 'order_paid'
      and reward_policy.active
      and subtotal.target_subtotal is not null
      and subtotal.target_subtotal >= reward_policy.min_amount
      and pg_catalog.now() >= reward_policy.active_from
      and (reward_policy.active_to is null or pg_catalog.now() < reward_policy.active_to)
      and pg_catalog.now() >= card_pool.active_from
      and (card_pool.active_to is null or pg_catalog.now() < card_pool.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;

  if p_provider_payment_key is not null
    or p_provider_transaction_id is not null
    or p_provider_approval_reference is not null
    or p_result_code is not null
    or p_payment_method is not null
    or p_masked_payment_method is not null
    or p_approved_at is not null
  then
    insert into private.payment_provider_evidence (
      payment_attempt_id,
      evidence_kind,
      provider_payment_key,
      provider_transaction_id,
      provider_approval_reference,
      result_code,
      payment_method,
      masked_payment_method,
      approved_at
    )
    values (
      v_attempt.id,
      'confirm_' || p_outcome::text,
      p_provider_payment_key,
      p_provider_transaction_id,
      p_provider_approval_reference,
      p_result_code,
      p_payment_method,
      p_masked_payment_method,
      p_approved_at
    );
  end if;

  update public.payment_attempts
  set
    state = v_final_outcome,
    payment_id = case
      when v_final_outcome = 'approved' then v_payment.id
      else payment_id
    end,
    claim_token = null,
    claim_expires_at = null
  where id = v_attempt.id;

  return v_final_outcome;
end;
$function$;

revoke all on function public.finalize_goods_payment_attempt(
  uuid,
  uuid,
  public.payment_attempt_state,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_payment_attempt(
  uuid,
  uuid,
  public.payment_attempt_state,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- 2. 굿즈 콜백 seam
-- ---------------------------------------------------------------------------
-- 출처: 20260813220000_goods_payment_provider_seam.sql.
-- 원본이 콜백 경로를 'korpay' 고정으로 둔 이유는 무통장에 콜백이 없기
-- 때문이다 — 콜백 경로가 무통장 attempt를 집어갈 수 있게 열면 공격 표면만
-- 넓어진다. 토스는 콜백이 있는 provider라 그 논지에 걸리지 않으므로 열고,
-- bank_transfer는 계속 거부한다.

-- nonce 바인딩: 콜백이 있는 provider만 통과시킨다.
create or replace function public.bind_goods_payment_callback_nonce(
  p_attempt_id uuid,
  p_callback_nonce_digest text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
begin
  if p_attempt_id is null
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
  then
    raise invalid_parameter_value using message = 'goods_payment_nonce_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'order'
  for update;

  if not found or v_attempt.provider not in ('toss', 'korpay') then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_not_preparable';
  end if;

  if v_attempt.callback_nonce_digest is null then
    update public.payment_attempts
    set callback_nonce_digest = p_callback_nonce_digest
    where id = v_attempt.id;
  elsif v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest then
    raise unique_violation using message = 'goods_payment_nonce_conflict';
  end if;
end;
$function$;

revoke all on function public.bind_goods_payment_callback_nonce(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_goods_payment_callback_nonce(uuid, text)
  to service_role;

-- 콜백 선점: 입력 provider 자체를 허용목록으로 막는다.
create or replace function public.claim_goods_payment_attempt(
  p_provider public.payment_provider,
  p_provider_order_id text,
  p_callback_nonce_digest text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.orders%rowtype;
begin
  if p_provider not in ('toss', 'korpay')
    or p_provider_order_id is null
    or pg_catalog.length(p_provider_order_id) not between 1 and 200
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
  then
    raise invalid_parameter_value using message = 'goods_payment_callback_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order';

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  -- All goods transitions lock order before attempt. This matches prepare,
  -- cancellation, and expiry ordering and avoids an order/attempt deadlock.
  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_attempt.ref_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'order'
  for update;

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'goods_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.goods_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;

  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.goods_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'goods_payment_attempt_expired';
  end if;

  if v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = v_attempt.user_id
        and profile.suspended_at is not null
    )
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
    or exists (
      select 1
      from public.order_cancellation_requests as request
      where request.order_id = v_order.id
        and request.status in ('requested', 'processing', 'needs_review')
    )
    or exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    )
  then
    raise object_not_in_prerequisite_state using message = 'goods_order_not_payable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.goods_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_goods_payment_attempt(
  public.payment_provider, text, text, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 3. 만료된 prepared attempt 선점 정리
-- ---------------------------------------------------------------------------
-- 출처: 20260814040257_reconcile_expired_prepared_goods_cancellation.sql.
-- 캡처 없이 TTL이 지난 prepared attempt는 재고를 붙잡고 있을 이유가 없다.
-- 토스 attempt도 같은 방식으로 만료되므로 조회 조건을 함께 연다. 열지 않으면
-- 토스 주문의 취소 요청이 'not_applicable'로 빠져 재고가 만료까지 묶인다.

create or replace function public.reconcile_expired_prepared_goods_cancellation(
  p_request_id uuid,
  p_actor_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order_id uuid;
  v_order public.orders%rowtype;
  v_request public.order_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_transitioned boolean := false;
begin
  if p_request_id is null or p_actor_id is null then
    raise invalid_parameter_value using
      message = 'prepared_goods_cancellation_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role in ('staff', 'admin')
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'staff required';
  end if;

  -- Resolve only the lock key first. Every money and stock writer below uses
  -- the shared order -> request -> attempt -> payments ordering.
  select request.order_id
  into v_order_id
  from public.order_cancellation_requests as request
  where request.id = p_request_id;

  if v_order_id is null then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select order_record.*
  into v_order
  from public.orders as order_record
  where order_record.id = v_order_id
  for update;

  if not found then
    raise no_data_found using message = 'goods_order_not_found';
  end if;

  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.id = p_request_id
    and request.order_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'cancellation_request_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  order by attempt.id
  limit 1
  for update;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  if v_request.status = 'completed' then
    -- loadContext and this lock can be separated by another successful Toss,
    -- Korpay manual, or terminal-attempt reconciliation. A completed request
    -- plus canceled order is the provider-neutral terminal identity.
    if v_order.status = 'canceled' then
      return 'completed';
    end if;
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_terminal_mismatch';
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.id is null then
    return 'not_applicable';
  end if;

  -- A callback or another evidence path that moved the attempt beyond
  -- prepared owns the resolution. Do not fall through to the Toss empty-ledger
  -- completion path and do not mutate the request to needs_review here.
  if v_attempt.state in ('confirming', 'approved', 'unknown', 'needs_review') then
    return 'in_progress';
  end if;

  if v_attempt.state in ('declined', 'canceled') then
    return 'not_applicable';
  end if;

  if v_attempt.state is distinct from 'prepared' then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_payment_attempt_invalid';
  end if;

  if v_order.status is distinct from 'pending'
    or v_attempt.user_id is distinct from v_order.user_id
    or v_attempt.amount is distinct from v_order.total
    or v_attempt.currency is distinct from 'KRW'
    or v_request.requested_by is distinct from v_order.user_id
    or not private.goods_order_snapshot_matches(
      v_order.id,
      v_order.total,
      v_order.shipping_fee
    )
  then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_order_attempt_mismatch';
  end if;

  select claim.*
  into v_cancellation_claim
  from public.order_cancellation_claims as claim
  where claim.order_id = v_order.id
  for update;

  if not found
    or v_cancellation_claim.requested_by is distinct from v_request.requested_by
  then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_claim_required';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = v_order.id
      and payment.status <> 'failed'
  ) then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_payment_evidence_invalid';
  end if;

  if v_attempt.expires_at is null
    or v_attempt.expires_at > pg_catalog.clock_timestamp()
  then
    return 'in_progress';
  end if;

  update public.payment_attempts as attempt
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where attempt.id = v_attempt.id
    and attempt.state = 'prepared'
    and attempt.expires_at is not null
    and attempt.expires_at <= pg_catalog.clock_timestamp()
  returning true into v_transitioned;

  if not coalesce(v_transitioned, false) then
    return 'in_progress';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    array[]::text[]
  );

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = coalesce(request.completed_at, pg_catalog.clock_timestamp()),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id
    and request.status in ('processing', 'needs_review');

  if not found then
    raise object_not_in_prerequisite_state using
      message = 'prepared_goods_cancellation_request_changed';
  end if;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.order.prepared_goods_cancellation_completed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'outcome', 'expired_no_capture'
    )
  );

  return 'completed';
end;
$function$;

revoke all on function public.reconcile_expired_prepared_goods_cancellation(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.reconcile_expired_prepared_goods_cancellation(
  uuid, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- 4. 티켓 결제·환불 seam
-- ---------------------------------------------------------------------------
-- 출처: 20260813230000_ticket_payment_provider_seam.sql.
-- 티켓은 무통장을 지원하지 않는다(선점 창이 공연 회차에 묶여 24시간 입금
-- 기한을 줄 수 없다). 그래서 모든 체크는 ('toss', 'korpay') 2종이다.

-- prepare.
create or replace function public.prepare_ticket_payment_attempt(
  p_user_id uuid,
  p_ticket_order_id uuid,
  p_provider public.payment_provider
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.ticket_orders%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_attempt_id uuid;
begin
  if p_user_id is null
    or p_ticket_order_id is null
    or p_provider not in ('toss', 'korpay')
  then
    raise object_not_in_prerequisite_state using message = 'ticket_payment_unavailable';
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update;

  if not found or v_order.user_id is distinct from p_user_id then
    raise no_data_found using message = 'ticket_order_not_found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;
  if found then
    raise object_not_in_prerequisite_state using message = 'ticket_cancellation_in_progress';
  end if;

  if v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total <= 0
    or private.is_account_write_fenced(p_user_id)
    or exists (
      select 1
      from public.profiles as profile
      where profile.id = p_user_id
        and profile.suspended_at is not null
    )
    or not private.ticket_order_snapshot_matches(
      v_order.id,
      v_order.event_id,
      v_order.total
    )
    or exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
    )
    or exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'ticket'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    )
  then
    raise object_not_in_prerequisite_state using message = 'ticket_order_not_payable';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket'
    and attempt.ref_id = v_order.id
  for update;

  if found then
    if v_attempt.user_id is distinct from p_user_id
      or v_attempt.provider is distinct from p_provider
      or v_attempt.amount is distinct from v_order.total
      or v_attempt.currency is distinct from 'KRW'
      or v_attempt.state is distinct from 'prepared'
      or v_attempt.expires_at <= pg_catalog.clock_timestamp()
    then
      raise object_not_in_prerequisite_state using message = 'ticket_payment_attempt_not_preparable';
    end if;
    return private.ticket_payment_attempt_json(v_attempt);
  end if;

  v_attempt_id := extensions.gen_random_uuid();
  insert into public.payment_attempts (
    id,
    provider,
    user_id,
    purpose,
    ref_id,
    amount,
    currency,
    state,
    idempotency_key,
    provider_order_id,
    provider_product_code,
    expires_at
  )
  values (
    v_attempt_id,
    p_provider,
    p_user_id,
    'ticket',
    v_order.id,
    v_order.total,
    'KRW',
    'prepared',
    'ticket:' || v_order.id::text,
    'T' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    'P' || pg_catalog.replace(v_attempt_id::text, '-', ''),
    least(v_order.expires_at, pg_catalog.clock_timestamp() + interval '10 minutes')
  )
  returning * into v_attempt;

  return private.ticket_payment_attempt_json(v_attempt);
end;
$function$;

revoke all on function public.prepare_ticket_payment_attempt(
  uuid, uuid, public.payment_provider
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_ticket_payment_attempt(
  uuid, uuid, public.payment_provider
) to service_role;

-- nonce 바인딩.
create or replace function public.bind_ticket_payment_callback_nonce(
  p_attempt_id uuid,
  p_callback_nonce_digest text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
begin
  if p_attempt_id is null
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
  then
    raise invalid_parameter_value using message = 'ticket_payment_nonce_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
  for update;

  if not found or v_attempt.provider not in ('toss', 'korpay') then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;
  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
  then
    raise object_not_in_prerequisite_state using message = 'ticket_payment_attempt_not_preparable';
  end if;

  if v_attempt.callback_nonce_digest is null then
    update public.payment_attempts
    set callback_nonce_digest = p_callback_nonce_digest
    where id = v_attempt.id;
  elsif v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest then
    raise unique_violation using message = 'ticket_payment_nonce_conflict';
  end if;
end;
$function$;

revoke all on function public.bind_ticket_payment_callback_nonce(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_ticket_payment_callback_nonce(uuid, text)
  to service_role;

-- 콜백 선점.
create or replace function public.claim_ticket_payment_attempt(
  p_provider public.payment_provider,
  p_provider_order_id text,
  p_callback_nonce_digest text,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.ticket_orders%rowtype;
begin
  if p_provider not in ('toss', 'korpay')
    or p_provider_order_id is null
    or pg_catalog.length(p_provider_order_id) not between 1 and 200
    or p_callback_nonce_digest is null
    or p_callback_nonce_digest !~ '^[0-9a-f]{64}$'
    or p_claim_token is null
  then
    raise invalid_parameter_value using message = 'ticket_payment_callback_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'ticket';

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'ticket_payment_callback_invalid';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_attempt.ref_id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_order_not_found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;
  -- A cancellation may race an already-created provider session. Keep the
  -- request fenced, but still learn provider truth for this known order+nonce.
  -- The finalizer records approval without issuing QR and makes it refund-ready.

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.provider = p_provider
    and attempt.provider_order_id = p_provider_order_id
    and attempt.purpose = 'ticket'
  for update;

  if not found
    or v_attempt.callback_nonce_digest is null
    or v_attempt.callback_nonce_digest is distinct from p_callback_nonce_digest
  then
    raise no_data_found using message = 'ticket_payment_callback_invalid';
  end if;
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;

  if v_attempt.state is distinct from 'prepared'
    or v_attempt.expires_at <= pg_catalog.clock_timestamp()
    or v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.expires_at is null
    or v_order.expires_at <= pg_catalog.clock_timestamp()
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1 from public.profiles as profile
      where profile.id = v_attempt.user_id and profile.suspended_at is not null
    )
    or not private.ticket_order_snapshot_matches(
      v_order.id,
      v_order.event_id,
      v_order.total
    )
    or exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
    )
    or exists (
      select 1 from public.payments as payment
      where payment.purpose = 'ticket'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
    )
  then
    raise object_not_in_prerequisite_state using message = 'ticket_order_not_payable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.ticket_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_ticket_payment_attempt(
  public.payment_provider, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_payment_attempt(
  public.payment_provider, text, text, uuid
) to service_role;

-- 결제 대사 선점: attempt 조회 2곳.
create or replace function public.claim_ticket_payment_reconciliation(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_case_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.ticket_orders%rowtype;
begin
  if p_attempt_id is null
    or p_claim_token is null
    or p_case_ref is null
    or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise invalid_parameter_value using message = 'ticket_reconciliation_claim_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.provider in ('toss', 'korpay');
  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled') then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'terminal',
      v_attempt.state
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at is not null
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'in_progress'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_attempt.ref_id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_order_not_found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.provider in ('toss', 'korpay')
  for update;
  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;

  if v_attempt.state in ('approved', 'declined', 'canceled') then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'terminal',
      v_attempt.state
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', v_attempt.state
    );
  end if;
  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at is not null
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'payment',
      p_attempt_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'in_progress'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;
  if v_attempt.state not in ('unknown', 'needs_review', 'confirming') then
    raise object_not_in_prerequisite_state using message = 'ticket_payment_not_reconcilable';
  end if;

  update public.payment_attempts
  set
    state = 'confirming',
    claim_token = p_claim_token,
    claim_expires_at = pg_catalog.clock_timestamp() + interval '10 minutes'
  where id = v_attempt.id
  returning * into v_attempt;

  perform private.record_ticket_reconciliation_audit(
    p_claim_token,
    'payment',
    p_attempt_id,
    'payment_reconciliation_service_v1',
    p_case_ref,
    'claimed'
  );

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.ticket_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_ticket_payment_reconciliation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_payment_reconciliation(uuid, uuid, text)
  to service_role;

-- 결제 확정: attempt 조회 2곳.
create or replace function public.finalize_ticket_payment_attempt(
  p_attempt_id uuid,
  p_claim_token uuid,
  p_outcome public.payment_attempt_state,
  p_provider_payment_key text default null,
  p_provider_transaction_id text default null,
  p_provider_approval_reference text default null,
  p_result_code text default null,
  p_payment_method text default null,
  p_masked_payment_method text default null,
  p_approved_at timestamptz default null
)
returns public.payment_attempt_state
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_attempt public.payment_attempts%rowtype;
  v_order public.ticket_orders%rowtype;
  v_reservation public.ticket_order_reservations%rowtype;
  v_payment public.payments%rowtype;
  v_final_outcome public.payment_attempt_state;
  v_payment_key text;
  v_has_active_cancellation boolean := false;
begin
  if p_attempt_id is null
    or p_claim_token is null
    or p_outcome is null
    or p_outcome not in ('approved', 'declined', 'canceled', 'unknown', 'needs_review')
  then
    raise invalid_parameter_value using message = 'ticket_payment_finalization_invalid';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.provider in ('toss', 'korpay');

  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_attempt.ref_id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_order_not_found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  select exists (
    select 1
    from public.ticket_cancellation_requests as request
    where request.ticket_order_id = v_order.id
      and request.status in ('requested', 'processing', 'needs_review')
  ) into v_has_active_cancellation;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.provider in ('toss', 'korpay')
  for update;

  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;
  if v_attempt.state in ('approved', 'declined', 'canceled', 'unknown', 'needs_review') then
    return v_attempt.state;
  end if;
  if v_attempt.state is distinct from 'confirming'
    or v_attempt.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using message = 'ticket_payment_claim_invalid';
  end if;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = v_order.id
  for update;
  if not found then
    raise check_violation using message = 'ticket_reservation_missing';
  end if;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id = v_reservation.ticket_type_id
  for update of ticket_type;
  if not found then
    raise check_violation using message = 'ticket_type_missing';
  end if;

  v_final_outcome := p_outcome;
  v_payment_key := coalesce(
    nullif(pg_catalog.btrim(p_provider_payment_key), ''),
    nullif(pg_catalog.btrim(p_provider_transaction_id), '')
  );

  if p_outcome = 'approved' and (
    v_payment_key is null
    or v_order.user_id is distinct from v_attempt.user_id
    or v_order.status is distinct from 'pending'
    or v_order.total is distinct from v_attempt.amount
    or v_attempt.currency is distinct from 'KRW'
    or private.is_account_write_fenced(v_attempt.user_id)
    or exists (
      select 1 from public.profiles as profile
      where profile.id = v_attempt.user_id and profile.suspended_at is not null
    )
    or not private.ticket_order_snapshot_matches(
      v_order.id,
      v_order.event_id,
      v_order.total
    )
    or exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
    )
    or exists (
      select 1 from public.payments as payment
      where payment.purpose = 'ticket'
        and payment.ref_id = v_order.id
        and payment.status in ('pending', 'paid')
        and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
    )
    or (
      v_payment_key is not null
      and exists (
        select 1 from public.payments as payment
        where payment.payment_key = v_payment_key
          and payment.idempotency_key <> 'attempt:' || v_attempt.id::text
      )
    )
  ) then
    v_final_outcome := 'needs_review';
  end if;

  if v_final_outcome = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.idempotency_key = 'attempt:' || v_attempt.id::text
    for update;

    if found then
      if v_payment.user_id is distinct from v_attempt.user_id
        or v_payment.purpose is distinct from 'ticket'
        or v_payment.ref_id is distinct from v_attempt.ref_id
        or v_payment.amount is distinct from v_attempt.amount
        or v_payment.provider is distinct from v_attempt.provider
        or v_payment.payment_key is distinct from v_payment_key
        or v_payment.status not in ('pending', 'paid')
        or v_payment.raw is not null
      then
        v_final_outcome := 'needs_review';
      end if;
    else
      begin
        insert into public.payments (
          user_id,
          purpose,
          ref_id,
          provider,
          amount,
          status,
          payment_key,
          idempotency_key,
          raw
        )
        values (
          v_attempt.user_id,
          'ticket',
          v_attempt.ref_id,
          v_attempt.provider,
          v_attempt.amount,
          'paid',
          v_payment_key,
          'attempt:' || v_attempt.id::text,
          null
        )
        returning * into v_payment;
      exception
        when unique_violation then
          v_final_outcome := 'needs_review';
      end;
    end if;
  end if;

  if v_final_outcome = 'approved' then
    update public.payments
    set status = 'paid'
    where id = v_payment.id;

    if v_has_active_cancellation then
      -- Record the provider approval without fulfilling a ticket order the
      -- user already asked to cancel. This paid ledger is refund-ready while
      -- pending order + absent QR keep admission fenced.
      update public.ticket_cancellation_requests
      set
        status = 'needs_review',
        attempt_token = null,
        last_error_code = 'approved_requires_refund'
      where ticket_order_id = v_order.id
        and status in ('requested', 'processing', 'needs_review');
    else
      update public.ticket_orders
      set status = 'paid', expires_at = null
      where id = v_order.id;

      insert into public.tickets (
        ticket_order_id,
        ticket_type_id,
        qr_token,
        status
      )
      select
        v_order.id,
        v_reservation.ticket_type_id,
        pg_catalog.encode(extensions.gen_random_bytes(16), 'hex'),
        'valid'
      from pg_catalog.generate_series(1, v_reservation.quantity);
    end if;
  elsif v_final_outcome in ('declined', 'canceled') then
    update public.ticket_types
    set sold = sold - v_reservation.quantity
    where id = v_reservation.ticket_type_id;

    update public.ticket_orders
    set status = 'canceled', expires_at = null
    where id = v_order.id;

    -- A reviewed no-capture outcome satisfies an active user cancellation.
    -- Finish that durable request in the same order→request→attempt→type
    -- critical section so it cannot remain stuck after capacity is restored.
    update public.ticket_cancellation_requests
    set
      status = 'completed',
      attempt_token = null,
      completed_at = coalesce(completed_at, pg_catalog.clock_timestamp()),
      last_error_code = null
    where ticket_order_id = v_order.id
      and status in ('requested', 'processing', 'needs_review');
  end if;

  if p_provider_payment_key is not null
    or p_provider_transaction_id is not null
    or p_provider_approval_reference is not null
    or p_result_code is not null
    or p_payment_method is not null
    or p_masked_payment_method is not null
    or p_approved_at is not null
  then
    insert into private.payment_provider_evidence (
      payment_attempt_id,
      evidence_kind,
      provider_payment_key,
      provider_transaction_id,
      provider_approval_reference,
      result_code,
      payment_method,
      masked_payment_method,
      approved_at
    )
    values (
      v_attempt.id,
      'confirm_' || p_outcome::text,
      p_provider_payment_key,
      p_provider_transaction_id,
      p_provider_approval_reference,
      p_result_code,
      p_payment_method,
      p_masked_payment_method,
      p_approved_at
    );
  end if;

  update public.payment_attempts
  set
    state = v_final_outcome,
    payment_id = case
      when v_final_outcome = 'approved' then v_payment.id
      else payment_id
    end,
    claim_token = null,
    claim_expires_at = null
  where id = v_attempt.id;

  return v_final_outcome;
end;
$function$;

revoke all on function public.finalize_ticket_payment_attempt(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_ticket_payment_attempt(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) to service_role;

-- 환불 선점: legacy 반환 분기의 provider 판정.
create or replace function public.claim_ticket_payment_refund(
  p_request_id uuid,
  p_user_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.ticket_orders%rowtype;
  v_request public.ticket_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  if p_request_id is null or p_user_id is null or p_claim_token is null then
    raise invalid_parameter_value using message = 'ticket_refund_claim_invalid';
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  where request.id = p_request_id
  for update of ticket_order;
  if not found or v_order.user_id is distinct from p_user_id then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select request.*
  into v_request
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
    and request.ticket_order_id = v_order.id
    and request.requested_by = p_user_id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket'
    and attempt.ref_id = v_order.id
  for update;

  if not found or v_attempt.provider not in ('toss', 'korpay') then
    return pg_catalog.jsonb_build_object('claim_status', 'legacy');
  end if;

  if v_request.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', 'approved'
    );
  end if;
  if v_request.status = 'needs_review' then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', 'needs_review'
    );
  end if;
  if v_attempt.state = 'prepared' then
    -- A provider session exists but no callback truth does. Do not call refund
    -- or release capacity; callback drain or authoritative attempt TTL must win.
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;
  if v_request.status = 'processing'
    and v_request.attempt_token is distinct from p_claim_token
    and v_request.attempt_token is not null
    and v_request.provider_started_at > pg_catalog.clock_timestamp() - interval '5 minutes'
  then
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order.id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  join public.ticket_order_reservations as reservation
    on reservation.ticket_type_id = ticket_type.id
  where reservation.ticket_order_id = v_order.id
  for update of ticket_type;

  if v_request.status not in ('requested', 'processing')
    or v_order.status is distinct from 'paid'
    or v_attempt.state is distinct from 'approved'
    or v_attempt.payment_id is null
    or not exists (
      select 1
      from public.payments as payment
      where payment.id = v_attempt.payment_id
        and payment.provider = v_attempt.provider
        and payment.purpose = 'ticket'
        and payment.ref_id = v_order.id
        and payment.user_id = p_user_id
        and payment.amount = v_order.total
        and payment.status = 'paid'
    )
    or not exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
    )
    or exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
        and ticket.status <> 'valid'
    )
  then
    update public.ticket_cancellation_requests
    set
      status = 'needs_review',
      attempt_token = null,
      last_error_code = 'payment_not_refundable'
    where id = v_request.id;

    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', 'needs_review'
    );
  end if;

  update public.ticket_cancellation_requests
  set
    status = 'processing',
    attempt_token = p_claim_token,
    provider_started_at = pg_catalog.clock_timestamp(),
    last_error_code = null
  where id = v_request.id;

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.ticket_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_ticket_payment_refund(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_payment_refund(uuid, uuid, uuid)
  to service_role;

-- 환불 확정.
create or replace function public.finalize_ticket_payment_refund(
  p_request_id uuid,
  p_attempt_id uuid,
  p_claim_token uuid,
  p_outcome public.payment_attempt_state,
  p_refunded_amount bigint default null,
  p_provider_payment_key text default null,
  p_provider_transaction_id text default null,
  p_provider_approval_reference text default null,
  p_result_code text default null,
  p_payment_method text default null,
  p_masked_payment_method text default null,
  p_approved_at timestamptz default null
)
returns public.payment_attempt_state
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.ticket_orders%rowtype;
  v_request public.ticket_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
  v_reservation public.ticket_order_reservations%rowtype;
  v_payment public.payments%rowtype;
  v_final_outcome public.payment_attempt_state;
begin
  if p_request_id is null
    or p_attempt_id is null
    or p_claim_token is null
    or p_outcome is null
    or p_outcome not in ('approved', 'declined', 'canceled', 'unknown', 'needs_review')
  then
    raise invalid_parameter_value using message = 'ticket_refund_finalization_invalid';
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  where request.id = p_request_id
  for update of ticket_order;
  if not found then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select request.*
  into v_request
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
    and request.ticket_order_id = v_order.id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  for update;
  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;

  if v_request.status = 'completed' then
    return 'approved'::public.payment_attempt_state;
  end if;
  if v_request.status = 'needs_review' then
    return 'needs_review'::public.payment_attempt_state;
  end if;
  if v_request.status is distinct from 'processing'
    or v_request.attempt_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using message = 'ticket_refund_claim_invalid';
  end if;

  select payment.*
  into v_payment
  from public.payments as payment
  where payment.id = v_attempt.payment_id
  for update;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order.id
  order by ticket.id
  for update of ticket;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = v_order.id
  for update;
  if not found then
    raise check_violation using message = 'ticket_reservation_missing';
  end if;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id = v_reservation.ticket_type_id
  for update of ticket_type;

  v_final_outcome := p_outcome;
  if p_outcome = 'approved' and (
    p_refunded_amount is distinct from v_attempt.amount
    or v_attempt.state is distinct from 'approved'
    or v_order.status not in ('pending', 'paid')
    or v_payment.id is null
    or v_payment.provider is distinct from v_attempt.provider
    or v_payment.purpose is distinct from 'ticket'
    or v_payment.ref_id is distinct from v_order.id
    or v_payment.user_id is distinct from v_order.user_id
    or v_payment.amount is distinct from v_order.total
    or v_payment.status is distinct from 'paid'
    or (
      v_order.status = 'paid'
      and (
        not exists (
          select 1 from public.tickets as ticket
          where ticket.ticket_order_id = v_order.id
        )
        or exists (
          select 1 from public.tickets as ticket
          where ticket.ticket_order_id = v_order.id
            and ticket.status <> 'valid'
        )
      )
    )
    or (
      v_order.status = 'pending'
      and exists (
        select 1 from public.tickets as ticket
        where ticket.ticket_order_id = v_order.id
      )
    )
  ) then
    v_final_outcome := 'needs_review';
  end if;

  if v_final_outcome = 'approved' then
    insert into public.refunds (
      payment_id,
      amount,
      reason,
      status,
      ticket_cancellation_request_id
    )
    values (
      v_payment.id,
      v_attempt.amount,
      v_request.reason,
      'done',
      v_request.id
    )
    on conflict (payment_id) do update
    set
      amount = excluded.amount,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = 'done',
      ticket_cancellation_request_id = coalesce(
        public.refunds.ticket_cancellation_request_id,
        excluded.ticket_cancellation_request_id
      );

    update public.payments
    set status = 'refunded'
    where id = v_payment.id;

    update public.ticket_types
    set sold = sold - v_reservation.quantity
    where id = v_reservation.ticket_type_id;

    update public.tickets
    set status = 'refunded'
    where ticket_order_id = v_order.id;

    update public.ticket_orders
    set status = 'canceled', expires_at = null
    where id = v_order.id;

    update public.ticket_cancellation_requests
    set
      status = 'completed',
      attempt_token = null,
      completed_at = coalesce(completed_at, pg_catalog.clock_timestamp()),
      last_error_code = null
    where id = v_request.id;
  else
    update public.ticket_cancellation_requests
    set
      status = 'needs_review',
      attempt_token = null,
      last_error_code = case
        when v_final_outcome = 'needs_review' then 'refund_needs_review'
        else 'refund_' || v_final_outcome::text
      end
    where id = v_request.id;
  end if;

  if p_provider_payment_key is not null
    or p_provider_transaction_id is not null
    or p_provider_approval_reference is not null
    or p_result_code is not null
    or p_payment_method is not null
    or p_masked_payment_method is not null
    or p_approved_at is not null
  then
    insert into private.payment_provider_evidence (
      payment_attempt_id,
      evidence_kind,
      provider_payment_key,
      provider_transaction_id,
      provider_approval_reference,
      result_code,
      payment_method,
      masked_payment_method,
      approved_at
    )
    values (
      v_attempt.id,
      'refund_' || p_outcome::text,
      p_provider_payment_key,
      p_provider_transaction_id,
      p_provider_approval_reference,
      p_result_code,
      p_payment_method,
      p_masked_payment_method,
      p_approved_at
    );
  end if;

  return v_final_outcome;
end;
$function$;

revoke all on function public.finalize_ticket_payment_refund(
  uuid, uuid, uuid, public.payment_attempt_state, bigint, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_ticket_payment_refund(
  uuid, uuid, uuid, public.payment_attempt_state, bigint, text, text, text, text, text, text, timestamptz
) to service_role;

-- 환불 대사 선점.
create or replace function public.claim_ticket_refund_reconciliation(
  p_request_id uuid,
  p_claim_token uuid,
  p_case_ref text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_order public.ticket_orders%rowtype;
  v_request public.ticket_cancellation_requests%rowtype;
  v_attempt public.payment_attempts%rowtype;
begin
  if p_request_id is null
    or p_claim_token is null
    or p_case_ref is null
    or p_case_ref !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise invalid_parameter_value using message = 'ticket_refund_reconciliation_invalid';
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  where request.id = p_request_id
  for update of ticket_order;
  if not found then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select request.*
  into v_request
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
    and request.ticket_order_id = v_order.id
  for update;
  if not found then
    raise no_data_found using message = 'ticket_refund_not_found';
  end if;

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket'
    and attempt.ref_id = v_order.id
    and attempt.provider in ('toss', 'korpay')
  for update;
  if not found then
    raise no_data_found using message = 'ticket_payment_attempt_not_found';
  end if;

  if v_request.status = 'completed' then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'refund',
      p_request_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'terminal',
      'approved'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'attempt', private.ticket_payment_attempt_json(v_attempt),
      'outcome', 'approved'
    );
  end if;
  if v_request.status = 'processing'
    and v_request.attempt_token is distinct from p_claim_token
    and v_request.attempt_token is not null
    and v_request.provider_started_at > pg_catalog.clock_timestamp() - interval '5 minutes'
  then
    perform private.record_ticket_reconciliation_audit(
      p_claim_token,
      'refund',
      p_request_id,
      'payment_reconciliation_service_v1',
      p_case_ref,
      'in_progress'
    );
    return pg_catalog.jsonb_build_object(
      'claim_status', 'in_progress',
      'attempt', private.ticket_payment_attempt_json(v_attempt)
    );
  end if;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order.id
  order by ticket.id
  for update of ticket;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  join public.ticket_order_reservations as reservation
    on reservation.ticket_type_id = ticket_type.id
  where reservation.ticket_order_id = v_order.id
  for update of ticket_type;

  if v_request.status not in ('needs_review', 'processing')
    or v_order.status not in ('pending', 'paid')
    or v_attempt.state is distinct from 'approved'
    or v_attempt.payment_id is null
    or not exists (
      select 1
      from public.payments as payment
      where payment.id = v_attempt.payment_id
        and payment.provider = v_attempt.provider
        and payment.purpose = 'ticket'
        and payment.ref_id = v_order.id
        and payment.user_id = v_order.user_id
        and payment.amount = v_order.total
        and payment.status = 'paid'
    )
    or (
      v_order.status = 'paid'
      and (
        not exists (
          select 1 from public.tickets as ticket
          where ticket.ticket_order_id = v_order.id
        )
        or exists (
          select 1 from public.tickets as ticket
          where ticket.ticket_order_id = v_order.id
            and ticket.status <> 'valid'
        )
      )
    )
    or (
      v_order.status = 'pending'
      and exists (
        select 1 from public.tickets as ticket
        where ticket.ticket_order_id = v_order.id
      )
    )
  then
    raise object_not_in_prerequisite_state using message = 'ticket_refund_not_reconcilable';
  end if;

  update public.ticket_cancellation_requests
  set
    status = 'processing',
    attempt_token = p_claim_token,
    provider_started_at = pg_catalog.clock_timestamp(),
    last_error_code = null
  where id = v_request.id;

  perform private.record_ticket_reconciliation_audit(
    p_claim_token,
    'refund',
    p_request_id,
    'payment_reconciliation_service_v1',
    p_case_ref,
    'claimed'
  );

  return pg_catalog.jsonb_build_object(
    'claim_status', 'claimed',
    'attempt', private.ticket_payment_attempt_json(v_attempt)
  );
end;
$function$;

revoke all on function public.claim_ticket_refund_reconciliation(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_refund_reconciliation(uuid, uuid, text)
  to service_role;

-- ============================================================================
-- 굿즈 결제 승인과 구매자 취소 요청의 경합 (2026-10-12 점검 DB-2 + declined 경합)
--
-- claim이 attempt를 confirming으로 바꾸고 잠금을 놓은 사이(토스 승인 API 호출 중)
-- 구매자가 취소를 요청하면 request_order_claim은 requested 요청을 남긴다. 그 뒤:
--
-- 1. 승인(DONE)으로 끝나면 finalizer가 needs_review로 떨어지며 payments를 만들지
--    않았다. 카드는 승인됐는데 원장이 없어 오케스트레이터가 토스 취소를 발행할
--    근거가 없고, 주문·재고·쿠폰·적립금 점유가 풀리지 않았다. 이제 토스 결제는
--    티켓 finalizer(20260901100000:1696)처럼 결제 원장을 남기고 주문은 pending으로
--    둔다(이행 부수효과 없음). 요청은 곧바로 승인(processing)하고 환불 원장을 열어
--    서버 오케스트레이터(20261013110000 시스템 actor)가 토스 전액 취소를 발행한다.
--    재고·쿠폰·적립금은 그 완료(finalize_order_cancellation_with_provider_evidence)의
--    pending → canceled 전이에서 정확히 한 번 돌아온다.
-- 2. 거절·이탈(declined·canceled)로 끝나면 finalizer가 요청을 건드리지 않았고, 만료
--    sweep도 "자기가 prepared→canceled를 수행한 경우"만 요청을 닫아 continue했다.
--    주문이 무기한 pending으로 남았다. 이제 finalizer가 같은 임계 구역에서 결제 없이
--    요청을 종결하고 주문 점유를 푼다. 이 migration 이전에 남은 행은 sweep이
--    attempt가 결제 없이 끝났음을 확인한 경우에도 닫는다.
--    Korpay 수동 복구(finalize_goods_manual_payment_recovery)가 attempt를 잡고 부른
--    'canceled'는 예외다. 그 호출은 승인됐다가 결제사에서 취소된 결제일 수 있고,
--    종결·감사(admin actor)는 수동 복구가 직접 남긴다. 여기서 먼저 닫으면 admin
--    조치가 시스템 자동 완료로 기록되고 구매자에게 사실과 다른 안내가 나간다.
--    'canceled'(결제창 이탈·결제사 전액 취소 확인)에는 승인 여부를 단정하지 않는
--    문구를 쓴다.
--
-- Korpay(취소 API 없음)와 무통장(운영자 확인)의 승인 + 활성 요청은 종전처럼
-- needs_review로 남긴다.
--
-- 함수 본문은 최신 정의를 복사해 위 차이만 넣었다:
--   finalize_goods_payment_attempt  ← 20260901100000:199
--   expire_stale_checkouts          ← 20260813230000:2435
-- ============================================================================

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
  v_request public.order_cancellation_requests%rowtype;
  v_cancel_requested boolean := false;
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

  -- 공통 잠금 순서: order → request → attempt → payments. 활성 취소 요청은
  -- 아래에서 승인·거절 결과와 함께 같은 임계 구역에서 처리한다.
  select request.*
  into v_request
  from public.order_cancellation_requests as request
  where request.order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id desc
  limit 1
  for update;
  v_cancel_requested := found;

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
      /*
       * 활성 취소 요청은 토스 승인 증거를 버릴 사유가 아니다(2026-10-12 점검 DB-2).
       * 버리면 돈은 잡혔는데 payments가 없어 어느 경로도 결제사 취소를 발행하지
       * 못한다. 토스는 아래에서 결제 원장을 남기고 요청을 환불로 잇는다. 취소 API가
       * 없는 Korpay와 운영자 확인으로 끝나는 무통장은 종전처럼 사람이 본다.
       */
      or (v_cancel_requested and (v_attempt.provider <> 'toss' or v_request.claim_type <> 'cancel'))
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

  if v_final_outcome = 'approved' and v_cancel_requested then
    update public.payments
    set status = 'paid'
    where id = v_payment.id;

    /*
     * 승인과 구매자 취소 요청이 겹쳤다(DB-2). 티켓 finalizer와 같은 형태다 —
     * 결제 원장은 남기되 주문은 pending으로 두어 이행 부수효과(적립금·쿠폰 소비,
     * 카드팩 발급, 주문 확인 메일, 발주 큐)를 일으키지 않는다. 발주확인 전이고
     * 구매자가 승인 전에 취소를 요청했으므로 판단할 일이 없다 — 요청을 곧바로
     * 승인(processing)하고 환불 원장을 열어, 서버 오케스트레이터가 토스 전액 취소를
     * 발행하게 한다. 이미 승인됐거나 검토 중인 요청은 단계를 바꾸지 않고 이번 결제만
     * 환불 원장에 붙인다.
     */
    update public.orders
    set expires_at = null
    where id = v_attempt.ref_id;

    insert into public.order_cancellation_claims (order_id, requested_by, previous_status)
    values (v_order.id, v_request.requested_by, v_order.status)
    on conflict (order_id) do nothing;

    insert into public.refunds (payment_id, amount, reason, status, cancellation_request_id)
    values (
      v_payment.id,
      v_payment.amount,
      v_request.reason,
      case when v_request.status = 'needs_review' then 'failed' else 'requested' end,
      v_request.id
    )
    on conflict (payment_id) do update
    set
      cancellation_request_id = excluded.cancellation_request_id,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = case
        when public.refunds.status = 'done' then 'done'
        else excluded.status
      end;

    if v_request.status = 'requested' then
      update public.order_cancellation_requests
      set
        stage = 'processing',
        held_from = null,
        hold_reason = null,
        held_at = null,
        decided_at = coalesce(decided_at, pg_catalog.now()),
        provider_started_at = coalesce(provider_started_at, pg_catalog.now()),
        updated_at = pg_catalog.now()
      where id = v_request.id;

      insert into public.audit_log (actor_id, action, target, diff)
      values (
        null,
        'order.claim_auto_approved',
        'order:' || v_order.id::text,
        pg_catalog.jsonb_build_object(
          'claimId', v_request.id,
          'claimType', v_request.claim_type,
          'from', v_request.stage,
          'to', 'processing',
          'previousOrderStatus', v_order.status::text,
          'reasonType', v_request.reason_type,
          'paymentCount', 1,
          'trigger', 'payment_approved_during_cancellation',
          'actor', 'system'
        )
      );

      perform private.notify_order_claim(
        v_request.id,
        'auto_approved',
        '취소 요청이 승인됐어요',
        '결제 승인과 취소 요청이 겹쳐 자동으로 승인됐습니다. 결제 취소 처리를 시작합니다.'
      );
    end if;
  elsif v_final_outcome = 'approved' then
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

  /*
   * 결제 없이 끝난 결과(거절·이탈)는 활성 취소 요청을 그 자리에서 종결한다.
   *
   * 승인 응답을 기다리는 사이 접수된 취소는 requested로 남는다. 결과가 거절이면
   * 돈은 움직이지 않았는데, 이전에는 finalizer가 요청을 건드리지 않고 만료 sweep도
   * 그 요청을 건너뛰어 주문·재고·쿠폰·적립금 점유가 무기한 남았다. 티켓 finalizer와
   * 같이 같은 order → request → attempt 임계 구역에서 닫는다. attempt를 먼저
   * 종결 상태로 적어야 미해결 결제 가드가 주문 취소를 막지 않는다.
   *
   * Korpay 수동 복구가 이 attempt를 잡고(같은 claim token) 부른 호출이면 건너뛴다.
   * 수동 복구는 운영자가 결제사 원장에서 전액 취소를 확인한 건이라 승인됐던 결제일
   * 수 있고, 주문 종결과 admin 감사는 수동 복구가 같은 트랜잭션에서 직접 남긴다.
   */
  if v_final_outcome in ('declined', 'canceled')
    and v_cancel_requested
    and v_order.status = 'pending'
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status <> 'failed'
    )
    and not exists (
      select 1
      from private.goods_payment_manual_recovery_claims as manual_claim
      where manual_claim.attempt_id = v_attempt.id
        and manual_claim.claim_token = p_claim_token
    )
  then
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
      and request.status in ('requested', 'processing', 'needs_review');

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      null,
      'system.order.cancellation_completed',
      'order:' || v_order.id::text,
      pg_catalog.jsonb_build_object(
        'requestId', v_request.id,
        'to', 'completed',
        'refundCount', 0,
        'attemptOutcome', v_final_outcome::text,
        'actor', 'system'
      )
    );

    -- canceled는 결제창 이탈과 결제사 전액 취소 확인을 함께 뜻한다. 승인됐다가
    -- 취소된 결제일 수 있으므로 "승인되지 않았다"고 단정하지 않는다.
    perform private.notify_order_claim(
      v_request.id,
      'completed',
      '주문이 취소됐어요',
      case v_final_outcome
        when 'declined' then '결제가 승인되지 않아 결제 없이 주문을 취소했습니다.'
        else '결제가 취소되어 주문을 취소했습니다.'
      end
    );
  end if;

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

create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer := 0;
  v_can_expire boolean;
  v_expired_prepared_transitioned boolean;
  v_cancel_reason text;
  v_request_id uuid;
  r record;
  v_request record;
  v_attempt public.payment_attempts%rowtype;
begin
  for r in
    select orders.id
    from public.orders
    where orders.status = 'pending'
      and orders.expires_at is not null
      and orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1
        from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('processing', 'needs_review')
      )
      and not exists (
        select 1
        from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
          and attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')
      )
    order by orders.expires_at
    limit 200
    for update of orders skip locked
  loop
    v_can_expire := true;
    v_expired_prepared_transitioned := false;
    v_cancel_reason := '결제 시간 만료 자동 취소';
    v_request_id := null;

    -- The baseline partial unique index guarantees one attempt per goods
    -- order. Locking it only after the order matches claim/finalize exactly.
    select attempt.*
    into v_attempt
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = r.id
    for update;

    if found then
      if v_attempt.state = 'prepared' then
        if v_attempt.expires_at > pg_catalog.clock_timestamp() then
          v_can_expire := false;
        else
          update public.payment_attempts as attempt
          set
            state = 'canceled',
            claim_token = null,
            claim_expires_at = null
          where attempt.id = v_attempt.id
            and attempt.state = 'prepared'
            and attempt.expires_at <= pg_catalog.clock_timestamp()
          returning true into v_expired_prepared_transitioned;

          if not coalesce(v_expired_prepared_transitioned, false) then
            v_can_expire := false;
          end if;
        end if;
      elsif v_attempt.state in (
        'confirming',
        'unknown',
        'needs_review',
        'approved'
      ) then
        -- Defensive recheck after locking: a callback may have won after the
        -- candidate snapshot but before this transaction acquired the order.
        v_can_expire := false;
      end if;
    end if;

    if not v_can_expire then
      continue;
    end if;

    -- A user can request cancellation while the provider action is still
    -- valid. That request intentionally holds inventory until the attempt TTL
    -- proves the provider can no longer claim it. Lock and finish that durable
    -- request in this same transaction; the compatibility cancel_order wrapper
    -- correctly rejects active requests and therefore is used only when none
    -- exists.
    select request.id, request.reason
    into v_request
    from public.order_cancellation_requests as request
    where request.order_id = r.id
      and request.status = 'requested'
    order by request.requested_at desc, request.id desc
    limit 1
    for update;

    if found then
      -- A durable request is provider-sensitive evidence. Close it only when
      -- this exact order→attempt critical section proved the action TTL and
      -- performed prepared→canceled itself, or when the locked attempt already
      -- ended without capture (declined/canceled, no payment row, no non-failed
      -- ledger). The latter used to continue forever: a request accepted while
      -- the provider confirm was in flight stayed requested after a decline and
      -- held stock, coupons and store credit indefinitely (2026-10-12 audit).
      -- An absent attempt or a legacy failed-ledger order is still not proof.
      if not v_expired_prepared_transitioned
        and not (
          v_attempt.id is not null
          and v_attempt.state in ('declined', 'canceled')
          and v_attempt.payment_id is null
          and not exists (
            select 1
            from public.payments as payment
            where payment.purpose = 'order'
              and payment.ref_id = r.id
              and payment.status <> 'failed'
          )
        )
      then
        continue;
      end if;

      v_request_id := v_request.id;
      v_cancel_reason := v_request.reason;
    end if;

    if v_request_id is null then
      perform public.cancel_order(r.id, v_cancel_reason);
    else
      perform public.finalize_order_cancellation_with_provider_evidence(
        r.id,
        v_cancel_reason,
        array[]::text[]
      );

      update public.order_cancellation_requests as request
      set
        status = 'completed',
        completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
      where request.id = v_request_id
        and request.status = 'requested';
    end if;

    v_count := v_count + 1;
  end loop;

  -- Ticket checkout follows the same lock order and attempt-TTL proof. A
  -- durable cancellation request is completed only when this critical section
  -- itself transitions its expired prepared attempt to canceled.
  for r in
    select ticket_orders.id
    from public.ticket_orders
    where ticket_orders.status = 'pending'
      and ticket_orders.expires_at is not null
      and ticket_orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1 from public.payments as payment
        where payment.purpose = 'ticket'
          and payment.ref_id = ticket_orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1 from public.ticket_cancellation_requests as request
        where request.ticket_order_id = ticket_orders.id
          and request.status in ('processing', 'needs_review')
      )
      and not exists (
        select 1 from public.payment_attempts as attempt
        where attempt.purpose = 'ticket'
          and attempt.ref_id = ticket_orders.id
          and attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')
      )
    order by ticket_orders.expires_at
    limit 200
    for update of ticket_orders skip locked
  loop
    v_can_expire := true;
    v_expired_prepared_transitioned := false;
    v_request_id := null;

    select attempt.*
    into v_attempt
    from public.payment_attempts as attempt
    where attempt.purpose = 'ticket'
      and attempt.ref_id = r.id
    for update;

    if found then
      if v_attempt.state = 'prepared' then
        if v_attempt.expires_at > pg_catalog.clock_timestamp() then
          v_can_expire := false;
        else
          update public.payment_attempts as attempt
          set
            state = 'canceled',
            claim_token = null,
            claim_expires_at = null
          where attempt.id = v_attempt.id
            and attempt.state = 'prepared'
            and attempt.expires_at <= pg_catalog.clock_timestamp()
          returning true into v_expired_prepared_transitioned;

          if not coalesce(v_expired_prepared_transitioned, false) then
            v_can_expire := false;
          end if;
        end if;
      elsif v_attempt.state in (
        'confirming',
        'unknown',
        'needs_review',
        'approved'
      ) then
        v_can_expire := false;
      end if;
    end if;

    if not v_can_expire then
      continue;
    end if;

    select request.id, request.requested_by
    into v_request
    from public.ticket_cancellation_requests as request
    where request.ticket_order_id = r.id
      and request.status = 'requested'
    order by request.requested_at desc, request.id desc
    limit 1
    for update;

    if found then
      if not v_expired_prepared_transitioned then
        continue;
      end if;

      v_request_id := v_request.id;
    end if;

    if v_request_id is null then
      perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    else
      perform public.finalize_ticket_cancellation_request(
        v_request_id,
        v_request.requested_by
      );
    end if;

    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;

-- ============================================================================
-- 결제 기한 sweep이 닫은 구매자 취소 요청을 구매자에게 알린다 (2026-10-12 브라우저 QA QA-7)
--
-- 결제가 끝나기 전(prepared·confirming) 접수된 취소 요청은 requested로 남고, 구매자는
-- "요청을 접수했습니다. 담당자가 확인한 뒤 진행 상황을 알려드립니다."를 받는다. 결제
-- 기한이 지나 expire_stale_checkouts가 그 요청을 completed로, 주문을 canceled로 닫아도
-- 알림을 보내지 않았다. 구매자 화면은 그동안 "담당자가 검토 중"이었고 실제로는 담당자
-- 없이 닫혔다.
--
-- 이제 sweep은 요청을 닫는 같은 임계 구역에서 결제 없는 종결을 감사 로그
-- (system.order.cancellation_completed, finalizer의 결제 없는 종결과 같은 action)에
-- 남기고 구매자에게 "주문이 취소됐어요"를 보낸다. 문구는 닫힌 이유(결제 기한 만료·
-- 승인 거절·결제 취소)를 단정할 수 있는 만큼만 말한다. 재고·쿠폰·적립금 반환은
-- 종전처럼 finalize_order_cancellation_with_provider_evidence가 한다.
--
-- 티켓 분기는 finalize_ticket_cancellation_request가 종결을 맡으므로 바꾸지 않는다.
--
-- 함수 본문은 최신 정의를 복사해 위 차이만 넣었다:
--   expire_stale_checkouts ← 20261013110100:517
-- ============================================================================

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
  v_request_outcome text;
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
    v_request_outcome := null;

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
      -- 구매자 알림 문구를 가르는 결과. 이 임계 구역이 만료를 증명했으면 결제창이
      -- 결제 기한까지 끝나지 않은 것이고, 아니면 잠근 attempt가 결제 없이 끝난 것이다.
      v_request_outcome := case
        when v_expired_prepared_transitioned then 'expired'
        else v_attempt.state::text
      end;
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

      -- 구매자는 "담당자가 확인한 뒤 진행 상황을 알려드립니다"를 받은 채 기다리고
      -- 있었다. 담당자 없이 sweep이 닫았으므로 결과를 직접 알리고, 같은 결과를
      -- finalizer의 결제 없는 종결과 같은 감사 행으로 남긴다(2026-10-12 QA-7).
      insert into public.audit_log (actor_id, action, target, diff)
      values (
        null,
        'system.order.cancellation_completed',
        'order:' || r.id::text,
        pg_catalog.jsonb_build_object(
          'requestId', v_request_id,
          'to', 'completed',
          'refundCount', 0,
          'attemptOutcome', v_request_outcome,
          'trigger', 'checkout_expiry_sweep',
          'actor', 'system'
        )
      );

      perform private.notify_order_claim(
        v_request_id,
        'completed',
        '주문이 취소됐어요',
        case v_request_outcome
          when 'expired' then '결제 기한까지 결제가 완료되지 않아 결제 없이 주문을 취소했습니다.'
          when 'declined' then '결제가 승인되지 않아 결제 없이 주문을 취소했습니다.'
          else '결제가 취소되어 주문을 취소했습니다.'
        end
      );
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

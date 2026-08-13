-- ============================================================================
-- Goods payment attempt cancellation guard (#205 review follow-up)
--
-- 20260813220000 is already shared with Preview and remains immutable. This
-- additive migration closes the cancellation race without rewriting that
-- baseline: orders are always locked before their goods attempt, an unresolved
-- provider result becomes a durable cancellation request, and no lower-level
-- writer can restore inventory by moving the order directly to canceled.
-- ============================================================================

create or replace function private.guard_unresolved_goods_payment_cancellation()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if new.status = 'canceled'
    and old.status is distinct from 'canceled'
    and exists (
      select 1
      from public.payment_attempts as attempt
      where attempt.purpose = 'order'
        and attempt.ref_id = old.id
        and (
          attempt.state in (
            'prepared',
            'confirming',
            'unknown',
            'needs_review'
          )
          or (
            attempt.state = 'approved'
            and not exists (
              select 1
              from public.payments as payment
              where payment.id = attempt.payment_id
                and payment.provider = attempt.provider
                and payment.purpose = 'order'
                and payment.ref_id = attempt.ref_id
                and payment.status in ('canceled', 'refunded')
            )
          )
        )
    )
  then
    raise check_violation using
      message = 'goods_payment_attempt_requires_reconciliation';
  end if;

  return new;
end;
$function$;

revoke all on function private.guard_unresolved_goods_payment_cancellation()
  from public, anon, authenticated, service_role;

drop trigger if exists orders_guard_unresolved_goods_payment_cancellation
  on public.orders;

create trigger orders_guard_unresolved_goods_payment_cancellation
before update of status on public.orders
for each row
execute function private.guard_unresolved_goods_payment_cancellation();

create or replace function public.request_order_cancellation(
  p_order_id uuid,
  p_user_id uuid,
  p_reason text,
  p_reason_type text
)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_status public.order_status;
  v_delivered_at timestamptz;
  v_request_id uuid;
  v_has_unresolved_attempt boolean;
begin
  if p_reason_type is null
    or p_reason_type not in ('change_of_mind', 'defect')
  then
    raise check_violation using message = 'invalid cancellation reason type';
  end if;

  -- Shared ordering invariant: order first, then every goods attempt in a
  -- deterministic order. Claim/finalize use the same ordering.
  select order_record.user_id, order_record.status, order_record.delivered_at
  into v_user_id, v_status, v_delivered_at
  from public.orders as order_record
  where order_record.id = p_order_id
  for update;

  if not found or p_user_id is null or v_user_id is distinct from p_user_id then
    return 'not_found';
  end if;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'order'
    and attempt.ref_id = p_order_id
  order by attempt.id
  for update;

  select exists (
    select 1
    from public.payment_attempts as attempt
    where attempt.purpose = 'order'
      and attempt.ref_id = p_order_id
      and attempt.state in (
        'prepared',
        'confirming',
        'unknown',
        'needs_review',
        'approved'
      )
  )
  into v_has_unresolved_attempt;

  if v_status = 'canceled' then
    return 'already_canceled';
  end if;

  if v_status not in ('pending', 'paid', 'shipping', 'done') then
    return 'not_cancelable';
  end if;

  if p_reason is null
    or pg_catalog.btrim(p_reason) <> p_reason
    or pg_catalog.length(p_reason) not between 1 and 200
  then
    raise check_violation using message = 'invalid cancellation reason';
  end if;

  if public.order_withdrawal_deadline_passed(
    v_delivered_at,
    p_reason_type,
    pg_catalog.now()
  ) then
    return 'deadline_expired';
  end if;

  if exists (
    select 1
    from public.order_cancellation_requests as request
    where request.order_id = p_order_id
      and request.status in ('requested', 'processing', 'needs_review')
  ) then
    return 'already_requested';
  end if;

  insert into public.order_cancellation_requests (
    order_id,
    requested_by,
    reason,
    reason_type,
    status
  )
  values (
    p_order_id,
    p_user_id,
    p_reason,
    p_reason_type,
    'requested'
  )
  returning id into v_request_id;

  -- A provider result can no longer be inferred from a payment row alone.
  -- Preserve stock and the order until staff reconciliation resolves the
  -- attempt. Clearly terminal declined/canceled attempts may use the existing
  -- immediate cancellation path.
  if v_status = 'pending'
    and not v_has_unresolved_attempt
    and not exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = p_order_id
    )
  then
    perform public.finalize_order_cancellation_with_provider_evidence(
      p_order_id,
      p_reason,
      array[]::text[]
    );

    update public.order_cancellation_requests as request
    set
      status = 'completed',
      completed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
    where request.id = v_request_id;

    return 'completed';
  end if;

  return 'requested';
end;
$function$;

revoke all on function public.request_order_cancellation(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.request_order_cancellation(uuid, uuid, text, text)
  to service_role;

-- The callback action is valid only until payment_attempts.expires_at. Once
-- that authoritative TTL has elapsed, no provider callback can claim the
-- prepared attempt. Expiry follows the same order -> attempt lock ordering as
-- claim/finalize/cancellation, closes the attempt first, and only then lets the
-- existing order cancellation restore inventory. A fresh prepared attempt or
-- any confirming/ambiguous outcome remains reserved for reconciliation.
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
      -- performed prepared→canceled itself. An absent, previously terminal,
      -- or legacy failed-ledger attempt is not proof that cancellation is safe.
      if not v_expired_prepared_transitioned then
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

  -- Preserve the latest ticket expiry sweep unchanged. Ticket checkout owns
  -- its provider-attempt refinements in #206.
  for r in
    select ticket_orders.id
    from public.ticket_orders
    where ticket_orders.status = 'pending'
      and ticket_orders.expires_at is not null
      and ticket_orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1
        from public.payments as payment
        where payment.purpose = 'ticket'
          and payment.ref_id = ticket_orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1
        from public.ticket_cancellation_requests as request
        where request.ticket_order_id = ticket_orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
    order by ticket_orders.expires_at
    limit 200
    for update of ticket_orders skip locked
  loop
    perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;

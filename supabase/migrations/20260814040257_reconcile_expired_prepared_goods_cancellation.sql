-- ============================================================================
-- Expired prepared Korpay goods cancellation recovery (#208)
--
-- A prepared provider action proves no capture only after its exact durable
-- attempt TTL has elapsed. This narrow service-only seam lets the existing
-- admin cancellation orchestration wait while that action is fresh, or close
-- the no-capture attempt, request, order, and stock atomically after expiry.
-- It never calls a provider and never creates a payment or refund row.
-- ============================================================================

create function public.reconcile_expired_prepared_goods_cancellation(
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
    and attempt.provider = 'korpay'
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

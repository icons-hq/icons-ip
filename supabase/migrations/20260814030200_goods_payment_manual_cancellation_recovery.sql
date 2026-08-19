-- ============================================================================
-- Korpay goods payment manual cancellation recovery (#208)
--
-- The provider cancellation itself happens outside this database contract.
-- A verified admin may enter this canary seam only after checking the provider
-- ledger and attesting that a full cancellation is already complete. The RPCs
-- accept no provider identifier or free-form evidence and record only a
-- server-generated opaque case reference.
-- ============================================================================

create table private.goods_payment_manual_recovery_claims (
  attempt_id uuid primary key
    references public.payment_attempts(id) on delete cascade,
  order_id uuid not null unique
    references public.orders(id) on delete cascade,
  request_id uuid not null unique
    references public.order_cancellation_requests(id) on delete cascade,
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  operation text not null
    check (operation = 'provider_cancel_confirmed'),
  case_ref text not null
    check (case_ref ~ '^case_v1_[0-9a-f]{32}$'),
  claim_token uuid not null unique,
  prior_attempt_state public.payment_attempt_state not null
    check (prior_attempt_state in ('confirming', 'approved', 'unknown', 'needs_review')),
  claimed_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  check (expires_at > claimed_at)
);

create index goods_payment_manual_recovery_claims_expiry_idx
  on private.goods_payment_manual_recovery_claims (expires_at);

alter table private.goods_payment_manual_recovery_claims enable row level security;
revoke all on table private.goods_payment_manual_recovery_claims
  from public, anon, authenticated, service_role;

create table private.goods_payment_manual_recovery_audits (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid not null
    references public.payment_attempts(id) on delete restrict,
  order_id uuid not null
    references public.orders(id) on delete restrict,
  request_id uuid not null
    references public.order_cancellation_requests(id) on delete restrict,
  actor_id uuid not null
    references public.profiles(id) on delete restrict,
  operation text not null
    check (operation = 'provider_cancel_confirmed'),
  case_ref text not null
    check (case_ref ~ '^case_v1_[0-9a-f]{32}$'),
  prior_attempt_state public.payment_attempt_state not null
    check (prior_attempt_state in ('confirming', 'approved', 'unknown', 'needs_review')),
  outcome text not null
    check (outcome = 'provider_cancel_confirmed'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (attempt_id, operation),
  unique (order_id, operation)
);

alter table private.goods_payment_manual_recovery_audits enable row level security;
revoke all on table private.goods_payment_manual_recovery_audits
  from public, anon, authenticated, service_role;

-- The admin console needs an opaque provider order reference and amount to
-- find the same transaction in Korpay before attesting. This admin-only read
-- returns no provider payment key, TID, PAN, callback body, or private evidence.
create function public.admin_goods_manual_recovery_attempts(
  p_order_ids uuid[]
)
returns table (
  order_id uuid,
  request_id uuid,
  attempt_id uuid,
  provider_order_id text,
  state text,
  amount bigint,
  currency text,
  manual_recovery_available boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
begin
  if (select auth.uid()) is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = (select auth.uid())
      and profile.role = 'admin'
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  if p_order_ids is null or pg_catalog.cardinality(p_order_ids) = 0 then
    return;
  end if;

  if pg_catalog.cardinality(p_order_ids) > 100 then
    raise invalid_parameter_value using message = 'too many order ids';
  end if;

  return query
  select
    attempt.ref_id,
    request.id,
    attempt.id,
    attempt.provider_order_id,
    attempt.state::text,
    attempt.amount,
    attempt.currency,
    (
      (
        attempt.state in ('approved', 'unknown', 'needs_review')
        or (
          attempt.state = 'confirming'
          and (
            attempt.claim_expires_at is null
            or attempt.claim_expires_at <= pg_catalog.now()
          )
        )
      )
      and not exists (
        select 1
        from private.goods_payment_manual_recovery_claims as manual_claim
        where manual_claim.attempt_id = attempt.id
          and manual_claim.expires_at > pg_catalog.now()
      )
    ) as manual_recovery_available
  from public.payment_attempts as attempt
  join public.order_cancellation_requests as request
    on request.order_id = attempt.ref_id
   and request.status in ('processing', 'needs_review')
  join public.order_cancellation_claims as cancellation_claim
    on cancellation_claim.order_id = attempt.ref_id
   and cancellation_claim.requested_by = request.requested_by
  where attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = any(p_order_ids)
  order by attempt.ref_id;
end;
$function$;

revoke all on function public.admin_goods_manual_recovery_attempts(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.admin_goods_manual_recovery_attempts(uuid[])
  to authenticated;

create function public.claim_goods_manual_payment_recovery(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_case_ref text,
  p_operation text,
  p_claim_token uuid
)
returns jsonb
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
  v_existing_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
begin
  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_input_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role = 'admin'
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  -- Resolve the order without a lock, then acquire every money/stock lock in
  -- the shared order -> request -> attempt -> payments order.
  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
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
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;

    return pg_catalog.jsonb_build_object(
      'claim_status', 'terminal',
      'outcome', v_terminal.outcome
    );
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
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
      message = 'goods_manual_recovery_order_attempt_mismatch';
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

  select claim.*
  into v_existing_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if found and v_existing_claim.expires_at > pg_catalog.clock_timestamp() then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state = 'confirming'
    and v_attempt.claim_expires_at > pg_catalog.clock_timestamp()
  then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state not in ('confirming', 'approved', 'unknown', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'goods_payment_attempt_not_recoverable';
  end if;

  if v_attempt.state = 'approved' then
    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;
  end if;

  insert into private.goods_payment_manual_recovery_claims (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    claim_token,
    prior_attempt_state,
    claimed_at,
    expires_at
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    p_claim_token,
    v_attempt.state,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + interval '15 minutes'
  )
  on conflict (attempt_id) do update
  set
    order_id = excluded.order_id,
    request_id = excluded.request_id,
    actor_id = excluded.actor_id,
    operation = excluded.operation,
    case_ref = excluded.case_ref,
    claim_token = excluded.claim_token,
    prior_attempt_state = private.goods_payment_manual_recovery_claims.prior_attempt_state,
    claimed_at = excluded.claimed_at,
    expires_at = excluded.expires_at
  where private.goods_payment_manual_recovery_claims.expires_at
    <= pg_catalog.clock_timestamp();

  if not found then
    return pg_catalog.jsonb_build_object('claim_status', 'in_progress');
  end if;

  if v_attempt.state in ('confirming', 'unknown', 'needs_review') then
    update public.payment_attempts as attempt
    set
      state = 'confirming',
      claim_token = p_claim_token,
      claim_expires_at = pg_catalog.clock_timestamp() + interval '15 minutes'
    where attempt.id = v_attempt.id;
  end if;

  return pg_catalog.jsonb_build_object('claim_status', 'claimed');
end;
$function$;

create function public.finalize_goods_manual_payment_recovery(
  p_attempt_id uuid,
  p_actor_id uuid,
  p_request_id uuid,
  p_case_ref text,
  p_operation text,
  p_claim_token uuid,
  p_operator_attested boolean
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
  v_manual_claim private.goods_payment_manual_recovery_claims%rowtype;
  v_terminal private.goods_payment_manual_recovery_audits%rowtype;
  v_payment public.payments%rowtype;
  v_cancellation_claim public.order_cancellation_claims%rowtype;
  v_provider_keys text[] := array[]::text[];
  v_final_attempt_state public.payment_attempt_state;
  v_has_payment boolean := false;
begin
  if p_attempt_id is null
    or p_actor_id is null
    or p_request_id is null
    or p_claim_token is null
    or p_operation is distinct from 'provider_cancel_confirmed'
    or p_case_ref is null
    or p_case_ref !~ '^case_v1_[0-9a-f]{32}$'
    or p_operator_attested is distinct from true
  then
    raise invalid_parameter_value using
      message = 'goods_manual_recovery_attestation_invalid';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_actor_id
      and profile.role = 'admin'
      and profile.suspended_at is null
  ) then
    raise insufficient_privilege using message = 'admin required';
  end if;

  select attempt.ref_id
  into v_order_id
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order';

  if v_order_id is null then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  -- Keep the same global lock order as claim and cancellation writers.
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
  where attempt.id = p_attempt_id
    and attempt.provider = 'korpay'
    and attempt.purpose = 'order'
    and attempt.ref_id = v_order.id
  for update;

  if not found then
    raise no_data_found using message = 'goods_payment_attempt_not_found';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = v_order.id
  order by payment.id
  for update;

  select audit.*
  into v_terminal
  from private.goods_payment_manual_recovery_audits as audit
  where audit.attempt_id = v_attempt.id
    and audit.operation = p_operation;

  if found then
    if v_terminal.order_id is distinct from v_order.id
      or v_terminal.request_id is distinct from v_request.id
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_terminal_mismatch';
    end if;
    return v_terminal.outcome;
  end if;

  if v_request.status not in ('processing', 'needs_review') then
    raise object_not_in_prerequisite_state using
      message = 'cancellation_request_not_recoverable';
  end if;

  if v_attempt.user_id is distinct from v_order.user_id
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
      message = 'goods_manual_recovery_order_attempt_mismatch';
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

  select claim.*
  into v_manual_claim
  from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id
  for update;

  if not found
    or v_manual_claim.order_id is distinct from v_order.id
    or v_manual_claim.request_id is distinct from v_request.id
    or v_manual_claim.actor_id is distinct from p_actor_id
    or v_manual_claim.operation is distinct from p_operation
    or v_manual_claim.case_ref is distinct from p_case_ref
    or v_manual_claim.claim_token is distinct from p_claim_token
  then
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_claim_invalid';
  end if;

  if v_manual_claim.prior_attempt_state in ('confirming', 'unknown', 'needs_review') then
    if v_attempt.state is distinct from 'confirming'
      or v_attempt.claim_token is distinct from p_claim_token
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_claim_invalid';
    end if;

    v_final_attempt_state := public.finalize_goods_payment_attempt(
      v_attempt.id,
      p_claim_token,
      'canceled'::public.payment_attempt_state
    );

    if v_final_attempt_state is distinct from 'canceled' then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_attempt_not_canceled';
    end if;

    -- An ambiguous attempt does not prove that an approved provider payment
    -- ever existed. Close only the attempt and preserve the absence of payment
    -- and refund rows instead of synthesizing provider history.
    if exists (
      select 1
      from public.payments as payment
      where payment.purpose = 'order'
        and payment.ref_id = v_order.id
        and payment.status <> 'failed'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_payment_ambiguous';
    end if;
  elsif v_manual_claim.prior_attempt_state = 'approved' then
    if v_attempt.state is distinct from 'approved'
      or v_attempt.payment_id is null
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    select payment.*
    into v_payment
    from public.payments as payment
    where payment.id = v_attempt.payment_id;

    if not found
      or v_payment.user_id is distinct from v_attempt.user_id
      or v_payment.purpose is distinct from 'order'
      or v_payment.ref_id is distinct from v_order.id
      or v_payment.provider is distinct from 'korpay'
      or v_payment.amount is distinct from v_attempt.amount
      or v_payment.idempotency_key is distinct from 'attempt:' || v_attempt.id::text
      or v_payment.status not in ('paid', 'canceled', 'refunded')
      or v_payment.raw is not null
      or (v_payment.status = 'paid' and v_payment.payment_key is null)
      or exists (
        select 1
        from public.payments as other_payment
        where other_payment.purpose = 'order'
          and other_payment.ref_id = v_order.id
          and other_payment.id <> v_payment.id
          and other_payment.status <> 'failed'
      )
    then
      raise object_not_in_prerequisite_state using
        message = 'goods_approved_payment_evidence_invalid';
    end if;

    if v_payment.status = 'paid' then
      v_provider_keys := array[v_payment.payment_key];
    end if;
    v_has_payment := true;
  else
    raise object_not_in_prerequisite_state using
      message = 'goods_manual_recovery_prior_state_invalid';
  end if;

  perform public.finalize_order_cancellation_with_provider_evidence(
    v_order.id,
    v_request.reason,
    v_provider_keys
  );

  if v_has_payment then
    update public.refunds as refund
    set cancellation_request_id = v_request.id
    where refund.payment_id = v_payment.id
      and (
        refund.cancellation_request_id is null
        or refund.cancellation_request_id = v_request.id
      );

    if not exists (
      select 1
      from public.refunds as refund
      where refund.payment_id = v_payment.id
        and refund.cancellation_request_id = v_request.id
        and refund.amount = v_payment.amount
        and refund.status = 'done'
    ) then
      raise object_not_in_prerequisite_state using
        message = 'goods_manual_recovery_refund_invalid';
    end if;
  end if;

  update public.order_cancellation_requests as request
  set
    status = 'completed',
    last_error_code = null,
    completed_at = pg_catalog.clock_timestamp(),
    updated_at = pg_catalog.clock_timestamp()
  where request.id = v_request.id;

  insert into private.goods_payment_manual_recovery_audits (
    attempt_id,
    order_id,
    request_id,
    actor_id,
    operation,
    case_ref,
    prior_attempt_state,
    outcome
  )
  values (
    v_attempt.id,
    v_order.id,
    v_request.id,
    p_actor_id,
    p_operation,
    p_case_ref,
    v_manual_claim.prior_attempt_state,
    'provider_cancel_confirmed'
  );

  delete from private.goods_payment_manual_recovery_claims as claim
  where claim.attempt_id = v_attempt.id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'admin.payment.goods_manual_provider_cancel_confirmed',
    'order:' || v_order.id::text,
    pg_catalog.jsonb_build_object(
      'attemptId', v_attempt.id,
      'requestId', v_request.id,
      'operation', p_operation,
      'caseRef', p_case_ref,
      'outcome', 'provider_cancel_confirmed'
    )
  );

  return 'provider_cancel_confirmed';
end;
$function$;

revoke all on function public.claim_goods_manual_payment_recovery(
  uuid, uuid, uuid, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_goods_manual_payment_recovery(
  uuid, uuid, uuid, text, text, uuid
) to service_role;

revoke all on function public.finalize_goods_manual_payment_recovery(
  uuid, uuid, uuid, text, text, uuid, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_goods_manual_payment_recovery(
  uuid, uuid, uuid, text, text, uuid, boolean
) to service_role;

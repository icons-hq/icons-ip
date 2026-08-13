-- Review follow-up for the immutable, already-applied 20260813193000 migration.
-- Shared Preview applies only this migration; new environments apply both.

alter table private.account_deletion_control
  add column shipment_tracking_hmac_key bytea not null
    default extensions.gen_random_bytes(32),
  add column shipment_tracking_key_version smallint not null default 1,
  add column transaction_lookup_hmac_ready boolean not null default false,
  add column legacy_transaction_evidence_ready boolean not null default false,
  add column immutable_ticket_contract_ready boolean not null default false,
  add column community_legal_records_ready boolean not null default false,
  add constraint account_deletion_tracking_hmac_key_length_check check (
    pg_catalog.octet_length(shipment_tracking_hmac_key) = 32
  ),
  add constraint account_deletion_tracking_key_version_check check (
    shipment_tracking_key_version > 0
  ),
  add constraint account_deletion_activation_readiness_check check (
    not phase_one_enabled
    or (
      transaction_lookup_hmac_ready
      and legacy_transaction_evidence_ready
      and immutable_ticket_contract_ready
      and community_legal_records_ready
    )
  );

alter table private.account_deletion_legal_snapshots
  drop constraint account_deletion_legal_snapshots_record_type_check,
  add constraint account_deletion_legal_snapshots_record_type_check check (
    record_type in (
      'order',
      'order_cancellation',
      'shipment',
      'payment',
      'refund',
      'ticket_order',
      'ticket_cancellation',
      'ticket_check_in'
    )
  );

create or replace function private.account_deletion_blockers(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with unresolved_payments as (
    select
      coalesce(attempt.payment_id::text, 'attempt:' || attempt.id::text) as blocker_ref,
      coalesce(payment.purpose, attempt.purpose) as purpose
    from public.payment_attempts as attempt
    left join public.payments as payment on payment.id = attempt.payment_id
    where attempt.user_id = p_user_id
      and (
        attempt.state in ('prepared', 'confirming', 'unknown', 'needs_review')
        or (attempt.state = 'approved' and attempt.payment_id is null)
      )

    union

    -- An attempt linked to the same legacy pending payment represents one
    -- obligation, not two public blockers.
    select payment.id::text, payment.purpose
    from public.payments as payment
    where payment.user_id = p_user_id
      and payment.status = 'pending'
  ),
  unresolved_refunds as (
    select refund.id::text as blocker_ref, payment.purpose
    from public.refunds as refund
    join public.payments as payment on payment.id = refund.payment_id
    where payment.user_id = p_user_id
      and refund.status in ('requested', 'failed')
  ),
  blocker_counts as (
    select
      1 as priority,
      'active_order'::text as code,
      pg_catalog.count(*)::integer as blocker_count,
      '/orders'::text as path
    from public.orders as order_record
    where order_record.user_id = p_user_id
      and order_record.status in ('pending', 'paid', 'shipping')

    union all

    select
      2,
      'active_cancellation',
      pg_catalog.count(*)::integer,
      '/orders'
    from (
      select request.order_id::text as blocker_ref
      from public.order_cancellation_requests as request
      join public.orders as order_record on order_record.id = request.order_id
      where order_record.user_id = p_user_id
        and request.status in ('requested', 'processing', 'needs_review')

      union

      select claim.order_id::text
      from public.order_cancellation_claims as claim
      join public.orders as order_record on order_record.id = claim.order_id
      where order_record.user_id = p_user_id
    ) as active_cancellation

    union all

    select 3, 'active_order_payment', pg_catalog.count(*)::integer, '/orders'
    from unresolved_payments
    where purpose = 'order'

    union all

    select 4, 'active_ticket_payment', pg_catalog.count(*)::integer, '/tickets'
    from unresolved_payments
    where purpose = 'ticket'

    union all

    select 5, 'active_payment_attempt', pg_catalog.count(*)::integer, '/settings'
    from unresolved_payments
    where purpose not in ('order', 'ticket')

    union all

    select 6, 'active_order_refund', pg_catalog.count(*)::integer, '/orders'
    from unresolved_refunds
    where purpose = 'order'

    union all

    select 7, 'active_ticket_refund', pg_catalog.count(*)::integer, '/tickets'
    from unresolved_refunds
    where purpose = 'ticket'

    union all

    select 8, 'active_refund', pg_catalog.count(*)::integer, '/settings'
    from unresolved_refunds
    where purpose not in ('order', 'ticket')

    union all

    select
      9,
      'active_ticket',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_orders as ticket_order
    join public.events as event on event.id = ticket_order.event_id
    where ticket_order.user_id = p_user_id
      and (
        ticket_order.status = 'pending'
        or (
          ticket_order.status = 'paid'
          and (event.ends_at is null or event.ends_at > pg_catalog.now())
          and exists (
            select 1
            from public.tickets as ticket
            where ticket.ticket_order_id = ticket_order.id
              and ticket.status = 'valid'
          )
        )
      )

    union all

    select
      10,
      'active_ticket_cancellation',
      pg_catalog.count(*)::integer,
      '/tickets'
    from public.ticket_cancellation_requests as request
    join public.ticket_orders as ticket_order
      on ticket_order.id = request.ticket_order_id
    where ticket_order.user_id = p_user_id
      and request.status in ('requested', 'processing', 'needs_review')

    union all

    select
      11,
      'staff_handover',
      pg_catalog.count(*)::integer,
      '/settings'
    from public.profiles as profile
    where profile.id = p_user_id
      and profile.role in ('staff', 'admin')
  )
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'code', blocker.code,
        'count', blocker.blocker_count,
        'path', blocker.path
      )
      order by blocker.priority
    ) filter (where blocker.blocker_count > 0),
    '[]'::jsonb
  )
  from blocker_counts as blocker;
$$;

revoke all on function private.account_deletion_blockers(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.snapshot_account_deletion_legal_records(
  p_deletion_event_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_tracking_hmac_key bytea;
  v_tracking_key_version smallint;
begin
  select
    control.shipment_tracking_hmac_key,
    control.shipment_tracking_key_version
    into strict v_tracking_hmac_key, v_tracking_key_version
  from private.account_deletion_control as control
  where control.singleton;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'order',
    order_record.id::text,
    pg_catalog.jsonb_build_object(
      'orderRef', order_record.id::text,
      'status', order_record.status,
      'total', order_record.total,
      'shippingFee', order_record.shipping_fee,
      'contractedAt', order_record.created_at,
      'items', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'goodRef', item.good_id,
              'goodName', item.good_name_snapshot,
              'goodType', item.good_type_snapshot,
              'ipRef', item.good_ip_id_snapshot,
              'quantity', item.qty,
              'unitPrice', item.unit_price
            )
            order by item.id
          )
          from public.order_items as item
          where item.order_id = order_record.id
        ),
        '[]'::jsonb
      )
    ),
    'ecommerce_transaction_v1',
    order_record.created_at + interval '5 years'
  from public.orders as order_record
  where order_record.user_id = p_user_id
    and order_record.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'order_cancellation',
    request.id::text,
    pg_catalog.jsonb_build_object(
      'cancellationRef', request.id::text,
      'orderRef', request.order_id::text,
      'status', request.status,
      'decision', case
        when request.status = 'rejected' then 'rejected'
        when request.decided_at is not null
          and request.status in ('processing', 'needs_review', 'completed')
          then 'approved'
        when request.status = 'requested' then 'pending'
        else 'unknown'
      end,
      'reasonType', request.reason_type,
      'requestedAt', request.requested_at,
      'decidedAt', request.decided_at,
      'providerStartedAt', request.provider_started_at,
      'completedAt', request.completed_at
    ),
    'ecommerce_transaction_v1',
    request.requested_at + interval '5 years'
  from public.order_cancellation_requests as request
  join public.orders as order_record on order_record.id = request.order_id
  where order_record.user_id = p_user_id
    and request.requested_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'shipment',
    order_record.id::text,
    pg_catalog.jsonb_build_object(
      'orderRef', order_record.id::text,
      'status', order_record.status,
      'carrier', order_record.shipping_carrier,
      'opaqueTrackingRef', case
        when order_record.tracking_number is null then null
        else pg_catalog.encode(
          extensions.hmac(
            pg_catalog.convert_to(
              'account-deletion-shipment-v1|'
                || order_record.shipping_carrier
                || '|'
                || order_record.tracking_number,
              'UTF8'
            ),
            v_tracking_hmac_key,
            'sha256'
          ),
          'hex'
        )
      end,
      'trackingKeyVersion', case
        when order_record.tracking_number is null then null
        else v_tracking_key_version
      end,
      'shippedAt', order_record.shipped_at,
      'suppliedAt', order_record.delivered_at
    ),
    'ecommerce_transaction_v1',
    coalesce(
      order_record.delivered_at,
      order_record.shipped_at,
      order_record.created_at
    ) + interval '5 years'
  from public.orders as order_record
  where order_record.user_id = p_user_id
    and order_record.delivered_at is not null
    and coalesce(
      order_record.delivered_at,
      order_record.shipped_at,
      order_record.created_at
    ) + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'payment',
    payment.id::text,
    pg_catalog.jsonb_build_object(
      'paymentRef', payment.id::text,
      'provider', payment.provider,
      'purpose', payment.purpose,
      'relatedRef', payment.ref_id,
      'amount', payment.amount,
      'currency', 'KRW',
      'status', payment.status,
      'ledgerRecordedAt', payment.created_at,
      'approvedAt', (
        select pg_catalog.max(evidence.approved_at)
        from public.payment_attempts as attempt
        join private.payment_provider_evidence as evidence
          on evidence.payment_attempt_id = attempt.id
        where attempt.payment_id = payment.id
          and attempt.state = 'approved'
      )
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    payment.created_at + interval '5 years'
  from public.payments as payment
  where payment.user_id = p_user_id
    and exists (
      select 1
      from public.payment_attempts as attempt
      join private.payment_provider_evidence as evidence
        on evidence.payment_attempt_id = attempt.id
      where attempt.payment_id = payment.id
        and attempt.state = 'approved'
        and evidence.approved_at is not null
    )
    and payment.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'refund',
    refund.id::text,
    pg_catalog.jsonb_build_object(
      'refundRef', refund.id::text,
      'paymentRef', refund.payment_id::text,
      'relatedCancellationRef', coalesce(
        refund.cancellation_request_id::text,
        refund.ticket_cancellation_request_id::text
      ),
      'amount', refund.amount,
      'status', refund.status,
      'requestedAt', refund.created_at,
      'refundedAt', case
        when refund.status = 'done' then coalesce(
          order_request.completed_at,
          ticket_request.completed_at
        )
        else null
      end
    ),
    case when payment.purpose = 'ticket'
      then 'ticket_transaction_v1'
      else 'ecommerce_transaction_v1'
    end,
    refund.created_at + interval '5 years'
  from public.refunds as refund
  join public.payments as payment on payment.id = refund.payment_id
  left join public.order_cancellation_requests as order_request
    on order_request.id = refund.cancellation_request_id
  left join public.ticket_cancellation_requests as ticket_request
    on ticket_request.id = refund.ticket_cancellation_request_id
  where payment.user_id = p_user_id
    and refund.status = 'done'
    and coalesce(order_request.completed_at, ticket_request.completed_at) is not null
    and refund.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_order',
    ticket_order.id::text,
    pg_catalog.jsonb_build_object(
      'ticketOrderRef', ticket_order.id::text,
      'eventRef', ticket_order.event_id,
      'status', ticket_order.status,
      'total', ticket_order.total,
      'contractedAt', ticket_order.created_at,
      'tickets', coalesce(
        (
          select pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'ticketRef', ticket.id::text,
              'ticketTypeRef', ticket.ticket_type_id::text,
              'status', ticket.status
            )
            order by ticket.id
          )
          from public.tickets as ticket
          where ticket.ticket_order_id = ticket_order.id
        ),
        '[]'::jsonb
      )
    ),
    'ticket_transaction_v1',
    ticket_order.created_at + interval '5 years'
  from public.ticket_orders as ticket_order
  where ticket_order.user_id = p_user_id
    and ticket_order.created_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_cancellation',
    request.id::text,
    pg_catalog.jsonb_build_object(
      'cancellationRef', request.id::text,
      'ticketOrderRef', request.ticket_order_id::text,
      'source', request.source,
      'status', request.status,
      'policyCode', request.policy_code,
      'cutoffAt', request.cutoff_at,
      'grossAmount', request.gross_amount,
      'feeAmount', request.fee_amount,
      'refundAmount', request.refund_amount,
      'requestedAt', request.requested_at,
      'providerStartedAt', request.provider_started_at,
      'completedAt', request.completed_at
    ),
    'ticket_transaction_v1',
    request.requested_at + interval '5 years'
  from public.ticket_cancellation_requests as request
  join public.ticket_orders as ticket_order
    on ticket_order.id = request.ticket_order_id
  where ticket_order.user_id = p_user_id
    and request.requested_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;

  insert into private.account_deletion_legal_snapshots (
    deletion_event_id,
    record_type,
    record_ref,
    snapshot_data,
    legal_basis,
    retain_until
  )
  select
    p_deletion_event_id,
    'ticket_check_in',
    ticket.id::text,
    pg_catalog.jsonb_build_object(
      'ticketRef', ticket.id::text,
      'ticketOrderRef', ticket.ticket_order_id::text,
      'checkedAt', check_in.checked_at
    ),
    'ticket_transaction_v1',
    check_in.checked_at + interval '5 years'
  from public.check_ins as check_in
  join public.tickets as ticket on ticket.id = check_in.ticket_id
  join public.ticket_orders as ticket_order
    on ticket_order.id = ticket.ticket_order_id
  where ticket_order.user_id = p_user_id
    and check_in.checked_at + interval '5 years' > pg_catalog.now()
  on conflict (deletion_event_id, record_type, record_ref) do update
  set
    snapshot_data = excluded.snapshot_data,
    legal_basis = excluded.legal_basis,
    retain_until = greatest(
      private.account_deletion_legal_snapshots.retain_until,
      excluded.retain_until
    )
  where private.account_deletion_legal_snapshots.destroyed_at is null;
end;
$$;

revoke all on function private.snapshot_account_deletion_legal_records(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Every account write fence participant uses this one transaction-scoped key.
-- The lock is acquired before blocker evaluation or fence lookup so a request
-- and a concurrent write cannot both commit as though they happened first.
create function private.lock_account_action_subject(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    raise not_null_violation using message = 'account_action_subject_required';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('account-action:' || p_user_id::text, 0)
  );
end;
$$;

revoke all on function private.lock_account_action_subject(uuid)
  from public, anon, authenticated, service_role;

create function private.has_recent_account_authentication(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select auth_user.last_sign_in_at >= pg_catalog.now() - interval '10 minutes'
      from auth.users as auth_user
      where auth_user.id = p_user_id
    ),
    false
  );
$$;

revoke all on function private.has_recent_account_authentication(uuid)
  from public, anon, authenticated, service_role;

-- A blocked request is not terminal. Existing fulfillment and payment workers
-- may finish the obligations that caused the block, so every status read and
-- idempotent replay refreshes both the blocker projection and legal snapshot.
-- This remains an internal, non-destructive seam until later deletion phases.
create function private.reconcile_account_deletion_request(p_user_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_request private.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_internal_status text;
begin
  perform private.lock_account_action_subject(p_user_id);

  select request.*
    into v_request
  from private.account_deletion_requests as request
  where request.subject_user_id = p_user_id
  for update;

  if not found then
    return null;
  end if;

  v_blockers := private.account_deletion_blockers(p_user_id);
  v_internal_status := case
    when v_blockers = '[]'::jsonb then 'awaiting_email_intent'
    else 'blocked_active_obligation'
  end;

  perform private.snapshot_account_deletion_legal_records(
    v_request.deletion_event_id,
    p_user_id
  );

  update private.account_deletion_requests as request
  set
    status = v_internal_status,
    blocker_summary = v_blockers,
    updated_at = pg_catalog.now()
  where request.deletion_event_id = v_request.deletion_event_id;

  return private.account_deletion_public_status(p_user_id);
end;
$$;

revoke all on function private.reconcile_account_deletion_request(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.preview_my_account_deletion()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_enabled boolean := false;
  v_blockers jsonb;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;

  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  select control.phase_one_enabled
    into v_enabled
  from private.account_deletion_control as control
  where control.singleton;

  if not coalesce(v_enabled, false) then
    return pg_catalog.jsonb_build_object(
      'available', false,
      'eligible', false,
      'blockers', pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'code', 'not_available',
          'count', 1,
          'path', '/settings'
        )
      )
    );
  end if;

  perform private.lock_account_action_subject(v_user_id);
  v_blockers := private.account_deletion_blockers(v_user_id);
  return pg_catalog.jsonb_build_object(
    'available', true,
    'eligible', v_blockers = '[]'::jsonb,
    'blockers', v_blockers
  );
end;
$$;

create or replace function public.request_my_account_deletion(
  p_confirmation text,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_enabled boolean := false;
  v_existing private.account_deletion_requests%rowtype;
  v_blockers jsonb;
  v_internal_status text;
  v_deletion_event_id uuid;
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if p_confirmation is distinct from '회원 탈퇴를 신청합니다' then
    raise check_violation using message = 'account_deletion_confirmation_mismatch';
  end if;
  if p_idempotency_key is null then
    raise not_null_violation using message = 'account_deletion_idempotency_key_required';
  end if;

  select control.phase_one_enabled
    into v_enabled
  from private.account_deletion_control as control
  where control.singleton
  for share;
  if not coalesce(v_enabled, false) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_not_available';
  end if;

  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  if not private.has_recent_account_authentication(v_user_id) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_reauthentication_required';
  end if;

  perform private.lock_account_action_subject(v_user_id);

  select request.*
    into v_existing
  from private.account_deletion_requests as request
  where request.subject_user_id = v_user_id;

  if found then
    if v_existing.idempotency_key is distinct from p_idempotency_key then
      raise unique_violation using message = 'account_deletion_idempotency_conflict';
    end if;
    return private.reconcile_account_deletion_request(v_user_id);
  end if;

  v_blockers := private.account_deletion_blockers(v_user_id);
  v_internal_status := case
    when v_blockers = '[]'::jsonb then 'awaiting_email_intent'
    else 'blocked_active_obligation'
  end;

  insert into private.account_deletion_requests (
    subject_user_id,
    idempotency_key,
    status,
    blocker_summary
  )
  values (v_user_id, p_idempotency_key, v_internal_status, v_blockers)
  returning deletion_event_id into v_deletion_event_id;

  perform private.snapshot_account_deletion_legal_records(
    v_deletion_event_id,
    v_user_id
  );

  insert into private.account_action_fences (
    subject_user_id,
    deletion_event_id
  )
  values (v_user_id, v_deletion_event_id);

  return private.account_deletion_public_status(v_user_id);
end;
$$;

create or replace function public.get_my_account_deletion_status()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null then
    raise insufficient_privilege using message = 'authentication_required';
  end if;
  if not exists (
    select 1 from public.profiles as profile where profile.id = v_user_id
  ) then
    raise no_data_found using message = 'account_not_found';
  end if;

  return coalesce(
    private.reconcile_account_deletion_request(v_user_id),
    pg_catalog.jsonb_build_object(
      'status', 'not_requested',
      'phase', 'none',
      'nextAction', '/settings',
      'blockers', '[]'::jsonb
    )
  );
end;
$$;

revoke all on function public.preview_my_account_deletion()
  from public, anon, authenticated, service_role;
revoke all on function public.request_my_account_deletion(text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_account_deletion_status()
  from public, anon, authenticated, service_role;
grant execute on function public.preview_my_account_deletion()
  to authenticated;
grant execute on function public.request_my_account_deletion(text, uuid)
  to authenticated;
grant execute on function public.get_my_account_deletion_status()
  to authenticated;

create or replace function private.is_account_write_fenced(p_user_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_user_id is null then
    return false;
  end if;
  perform private.lock_account_action_subject(p_user_id);
  return exists (
    select 1
    from private.account_action_fences as fence
    where fence.subject_user_id = p_user_id
  );
end;
$$;

revoke all on function private.is_account_write_fenced(uuid)
  from public, anon, authenticated, service_role;

create function private.can_write_account_storage_object()
returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and not private.is_account_write_fenced((select auth.uid()));
$$;

revoke all on function private.can_write_account_storage_object()
  from public, anon, authenticated, service_role;
grant execute on function private.can_write_account_storage_object()
  to authenticated;

-- Storage writes do not pass through application-table triggers. Restrictive
-- policies compose with the existing owner/path and community runtime gates,
-- and cover both upload and future upsert contracts.
create policy user_uploads_account_fence_insert
on storage.objects
as restrictive
for insert
to authenticated
with check (
  bucket_id <> 'user-uploads'
  or private.can_write_account_storage_object()
);

create policy user_uploads_account_fence_update
on storage.objects
as restrictive
for update
to authenticated
using (
  bucket_id <> 'user-uploads'
  or private.can_write_account_storage_object()
)
with check (
  bucket_id <> 'user-uploads'
  or private.can_write_account_storage_object()
);

-- ==========================================================================
-- Ticket checkout/refund through the provider-neutral payment seam (#206)
--
-- Capacity reservations are durable before payment, but tickets and QR codes
-- are issued only by an approved finalization. Korpay remains dark until #207
-- installs rotated credentials and the real adapter; every RPC here is
-- service-role only and stores allowlisted provider evidence without raw data.
-- ==========================================================================

create table public.ticket_order_reservations (
  ticket_order_id uuid primary key
    references public.ticket_orders (id) on delete cascade,
  ticket_type_id uuid not null references public.ticket_types (id),
  quantity integer not null check (quantity > 0),
  unit_price integer not null check (unit_price > 0),
  created_at timestamptz not null default now()
);

-- Existing Toss-era rows used QR-less ticket rows as their reservation. Keep
-- those rows intact for legacy settlement and backfill the explicit snapshot.
insert into public.ticket_order_reservations (
  ticket_order_id,
  ticket_type_id,
  quantity,
  unit_price
)
select
  ticket.ticket_order_id,
  min(ticket.ticket_type_id::text)::uuid,
  count(*)::integer,
  ticket_type.price
from public.tickets as ticket
join public.ticket_orders as ticket_order
  on ticket_order.id = ticket.ticket_order_id
join public.ticket_types as ticket_type
  on ticket_type.id = ticket.ticket_type_id
group by ticket.ticket_order_id, ticket_type.price
having count(distinct ticket.ticket_type_id) = 1;

do $ticket_reservation_backfill_contract$
begin
  if exists (
    select 1
    from public.ticket_orders as ticket_order
    where exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_order_id = ticket_order.id
    )
      and not exists (
        select 1
        from public.ticket_order_reservations as reservation
        where reservation.ticket_order_id = ticket_order.id
      )
  ) then
    raise check_violation using message = 'legacy ticket reservation backfill mismatch';
  end if;
end;
$ticket_reservation_backfill_contract$;

alter table public.ticket_order_reservations enable row level security;

create policy ticket_order_reservations_owner_staff_read
on public.ticket_order_reservations
for select
to authenticated
using (
  exists (
    select 1
    from public.ticket_orders as ticket_order
    where ticket_order.id = ticket_order_id
      and (
        ticket_order.user_id = (select auth.uid())
        or (select public.is_staff())
      )
  )
);

revoke all on table public.ticket_order_reservations
  from public, anon, authenticated, service_role;
grant select on table public.ticket_order_reservations
  to authenticated, service_role;
grant insert, update, delete on table public.ticket_order_reservations
  to service_role;

create unique index payment_attempts_one_ticket_order_idx
  on public.payment_attempts (ref_id)
  where purpose = 'ticket' and ref_id is not null;

create function private.ticket_payment_attempt_json(
  p_attempt public.payment_attempts
)
returns jsonb
language sql
stable
set search_path = ''
as $function$
  select pg_catalog.jsonb_build_object(
    'id', p_attempt.id,
    'provider', p_attempt.provider,
    'purpose', p_attempt.purpose,
    'ref_id', p_attempt.ref_id,
    'amount', p_attempt.amount,
    'currency', p_attempt.currency,
    'idempotency_key', p_attempt.idempotency_key,
    'provider_order_id', p_attempt.provider_order_id,
    'provider_product_code', p_attempt.provider_product_code,
    'expires_at', p_attempt.expires_at
  );
$function$;

create function private.ticket_order_snapshot_matches(
  p_ticket_order_id uuid,
  p_event_id text,
  p_total bigint
)
returns boolean
language sql
stable
set search_path = ''
as $function$
  select exists (
    select 1
    from public.ticket_order_reservations as reservation
    join public.ticket_types as ticket_type
      on ticket_type.id = reservation.ticket_type_id
    where reservation.ticket_order_id = p_ticket_order_id
      and ticket_type.event_id = p_event_id
      and reservation.unit_price = ticket_type.price
      and reservation.quantity::bigint * reservation.unit_price::bigint = p_total
      and ticket_type.sold >= reservation.quantity
  );
$function$;

revoke all on function private.ticket_payment_attempt_json(public.payment_attempts)
  from public, anon, authenticated, service_role;
revoke all on function private.ticket_order_snapshot_matches(uuid, text, bigint)
  from public, anon, authenticated, service_role;

-- New reservations hold capacity only. No ticket row exists until an approved
-- provider finalization creates it with a QR in the same transaction.
create or replace function public.reserve_tickets(
  p_user_id uuid,
  p_ticket_type_id uuid,
  p_qty integer,
  p_reservation_key uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := p_user_id;
  v_event_id text;
  v_locked_event_id text;
  v_event_status text;
  v_capacity integer;
  v_sold integer;
  v_price integer;
  v_per_user_limit integer;
  v_sales_open_at timestamptz;
  v_existing_order public.ticket_orders%rowtype;
  v_existing_reservation public.ticket_order_reservations%rowtype;
  v_already_reserved bigint;
  v_order_id uuid;
begin
  if v_user is null then
    raise not_null_violation using message = 'user required';
  end if;

  if not exists (
    select 1
    from public.profiles as profile
    join auth.users as auth_user on auth_user.id = profile.id
    where profile.id = v_user
      and nullif(btrim(coalesce(profile.email, auth_user.email)), '') is not null
      and nullif(btrim(profile.nickname), '') is not null
      and profile.birth_date is not null
      and profile.birth_date <= current_date
      and profile.onboarded_at is not null
      and profile.consents ->> 'terms' = 'true'
      and profile.consents ->> 'privacy' = 'true'
      and profile.suspended_at is null
  ) or private.is_account_write_fenced(v_user) then
    raise insufficient_privilege using message = 'onboarding required';
  end if;

  if p_qty is null or p_qty < 1 then
    raise check_violation using message = 'quantity must be positive';
  end if;
  if p_reservation_key is null then
    raise not_null_violation using message = 'reservation key required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ticket_reservation:' || v_user::text || ':' || p_reservation_key::text,
      0
    )
  );

  select ticket_order.*
  into v_existing_order
  from public.ticket_orders as ticket_order
  where ticket_order.user_id = v_user
    and ticket_order.reservation_key = p_reservation_key
  for share;

  if found then
    select reservation.*
    into v_existing_reservation
    from public.ticket_order_reservations as reservation
    where reservation.ticket_order_id = v_existing_order.id;

    if found
      and v_existing_reservation.ticket_type_id = p_ticket_type_id
      and v_existing_reservation.quantity = p_qty
    then
      return v_existing_order.id;
    end if;
    raise unique_violation using message = 'reservation conflict';
  end if;

  select ticket_type.event_id
  into v_event_id
  from public.ticket_types as ticket_type
  where ticket_type.id = p_ticket_type_id;
  if not found then
    raise no_data_found using message = 'ticket type not found';
  end if;

  select event_record.status
  into v_event_status
  from public.events as event_record
  where event_record.id = v_event_id
  for share of event_record;
  if not found then
    raise no_data_found using message = 'event not found';
  end if;

  select
    ticket_type.event_id,
    ticket_type.capacity,
    ticket_type.sold,
    ticket_type.price,
    ticket_type.per_user_limit,
    ticket_type.sales_open_at
  into
    v_locked_event_id,
    v_capacity,
    v_sold,
    v_price,
    v_per_user_limit,
    v_sales_open_at
  from public.ticket_types as ticket_type
  where ticket_type.id = p_ticket_type_id
  for update of ticket_type;

  if not found then
    raise no_data_found using message = 'ticket type not found';
  end if;
  if v_locked_event_id is distinct from v_event_id then
    raise serialization_failure using message = 'ticket type changed';
  end if;
  if v_event_status <> '예매중' then
    raise check_violation using message = 'event not bookable';
  end if;
  if v_price <= 0 then
    raise check_violation using message = 'paid ticket required';
  end if;
  if v_sales_open_at is not null and now() < v_sales_open_at then
    raise check_violation using message = 'sales not open';
  end if;
  if p_qty::bigint > v_capacity::bigint - v_sold::bigint then
    raise check_violation using message = 'sold out';
  end if;

  select coalesce(sum(reservation.quantity), 0)
  into v_already_reserved
  from public.ticket_order_reservations as reservation
  join public.ticket_orders as ticket_order
    on ticket_order.id = reservation.ticket_order_id
  where reservation.ticket_type_id = p_ticket_type_id
    and ticket_order.user_id = v_user
    and ticket_order.status <> 'canceled';

  if v_already_reserved + p_qty::bigint > v_per_user_limit::bigint then
    raise check_violation using message = 'per-user limit exceeded';
  end if;

  update public.ticket_types
  set sold = sold + p_qty
  where id = p_ticket_type_id;

  insert into public.ticket_orders (
    user_id,
    event_id,
    status,
    total,
    expires_at,
    reservation_key
  )
  values (
    v_user,
    v_event_id,
    'pending',
    v_price::bigint * p_qty::bigint,
    now() + interval '10 minutes',
    p_reservation_key
  )
  returning id into v_order_id;

  insert into public.ticket_order_reservations (
    ticket_order_id,
    ticket_type_id,
    quantity,
    unit_price
  )
  values (v_order_id, p_ticket_type_id, p_qty, v_price);

  return v_order_id;
end;
$function$;

revoke all on function public.reserve_tickets(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_tickets(uuid, uuid, integer, uuid)
  to service_role;

create function public.prepare_ticket_payment_attempt(
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
    or p_provider is distinct from 'korpay'
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

create function public.bind_ticket_payment_callback_nonce(
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

  if not found or v_attempt.provider is distinct from 'korpay' then
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

create function public.claim_ticket_payment_attempt(
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
  if p_provider is distinct from 'korpay'
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
  if found then
    raise object_not_in_prerequisite_state using message = 'ticket_cancellation_in_progress';
  end if;

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

create function public.finalize_ticket_payment_attempt(
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
    and attempt.provider = 'korpay';

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

  select attempt.*
  into v_attempt
  from public.payment_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.purpose = 'ticket'
    and attempt.provider = 'korpay'
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
      select 1 from public.ticket_cancellation_requests as request
      where request.ticket_order_id = v_order.id
        and request.status in ('requested', 'processing', 'needs_review')
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
      then
        v_final_outcome := 'needs_review';
      end if;
    else
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
    end if;
  end if;

  if v_final_outcome = 'approved' then
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
  elsif v_final_outcome in ('declined', 'canceled') then
    update public.ticket_types
    set sold = sold - v_reservation.quantity
    where id = v_reservation.ticket_type_id;

    update public.ticket_orders
    set status = 'canceled', expires_at = null
    where id = v_order.id;
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

create function public.claim_ticket_payment_refund(
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

  if not found or v_attempt.provider is distinct from 'korpay' then
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

create function public.finalize_ticket_payment_refund(
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
    and attempt.provider = 'korpay'
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
    or v_order.status is distinct from 'paid'
    or v_payment.id is null
    or v_payment.provider is distinct from v_attempt.provider
    or v_payment.purpose is distinct from 'ticket'
    or v_payment.ref_id is distinct from v_order.id
    or v_payment.user_id is distinct from v_order.user_id
    or v_payment.amount is distinct from v_order.total
    or v_payment.status is distinct from 'paid'
    or exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = v_order.id
        and ticket.status <> 'valid'
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

-- Cancellation keeps the same global lock order and consumes the explicit
-- reservation snapshot for both legacy and provider-neutral ticket orders.
create or replace function public.finalize_ticket_cancellation_request(
  p_request_id uuid,
  p_actor_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order_id uuid;
  v_order_status public.ticket_order_status;
  v_request_status text;
  v_request_source text;
  v_reservation public.ticket_order_reservations%rowtype;
  v_refund_count integer;
begin
  select request.ticket_order_id
  into v_order_id
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id;
  if v_order_id is null then
    raise no_data_found using message = 'ticket cancellation request not found';
  end if;

  select ticket_order.status
  into v_order_status
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;
  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  select request.status, request.source
  into v_request_status, v_request_source
  from public.ticket_cancellation_requests as request
  where request.id = p_request_id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket' and payment.ref_id = v_order_id
  order by payment.id
  for update of payment;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket' and attempt.ref_id = v_order_id
  order by attempt.id
  for update of attempt;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order_id
  order by ticket.id
  for update of ticket;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = v_order_id
  for update;
  if not found then
    raise check_violation using message = 'ticket reservation missing';
  end if;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id = v_reservation.ticket_type_id
  for update of ticket_type;

  if v_request_status = 'completed' then
    return 'completed';
  end if;
  if v_order_status = 'canceled' then
    update public.ticket_cancellation_requests
    set
      status = 'completed',
      attempt_token = null,
      completed_at = coalesce(completed_at, now()),
      last_error_code = null
    where id = p_request_id;
    return 'completed';
  end if;
  if v_order_status not in ('pending', 'paid') then
    raise check_violation using message = 'ticket order not cancelable';
  end if;

  if exists (
    select 1 from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = v_order_id
      and payment.status in ('pending', 'paid')
  ) or exists (
    select 1 from public.payment_attempts as attempt
    where attempt.purpose = 'ticket'
      and attempt.ref_id = v_order_id
      and attempt.state in ('confirming', 'approved', 'unknown', 'needs_review')
  ) then
    return 'processing';
  end if;

  if v_order_status = 'paid' and not exists (
    select 1
    from public.payments as payment
    join public.refunds as refund on refund.payment_id = payment.id
    where payment.purpose = 'ticket'
      and payment.ref_id = v_order_id
      and payment.status = 'refunded'
      and refund.status = 'done'
  ) then
    raise check_violation using message = 'payment evidence required';
  end if;

  if exists (
    select 1 from public.tickets as ticket
    where ticket.ticket_order_id = v_order_id and ticket.status = 'used'
  ) then
    update public.ticket_cancellation_requests
    set
      status = 'needs_review',
      attempt_token = null,
      last_error_code = 'used_ticket_after_provider_cancellation'
    where id = p_request_id;
    return 'needs_review';
  end if;

  update public.payment_attempts
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where purpose = 'ticket'
    and ref_id = v_order_id
    and state = 'prepared';

  update public.ticket_types
  set sold = sold - v_reservation.quantity
  where id = v_reservation.ticket_type_id;

  update public.tickets
  set status = 'refunded'
  where ticket_order_id = v_order_id;

  update public.ticket_orders
  set status = 'canceled', expires_at = null
  where id = v_order_id;

  update public.ticket_cancellation_requests
  set
    status = 'completed',
    attempt_token = null,
    completed_at = coalesce(completed_at, now()),
    last_error_code = null
  where id = p_request_id;

  select count(*)::integer
  into v_refund_count
  from public.refunds as refund
  where refund.ticket_cancellation_request_id = p_request_id
    and refund.status = 'done';

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_actor_id,
    'ticket.cancellation.completed',
    'ticket_order:' || v_order_id::text,
    jsonb_build_object(
      'requestId', p_request_id,
      'source', v_request_source,
      'to', 'completed',
      'refundCount', v_refund_count
    )
  );
  return 'completed';
end;
$function$;

create or replace function public.request_ticket_cancellation(
  p_user_id uuid,
  p_ticket_order_id uuid
)
returns table (request_id uuid, result text)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order_user_id uuid;
  v_order_status public.ticket_order_status;
  v_order_total bigint;
  v_event_id text;
  v_cutoff_at timestamptz;
  v_existing_request record;
  v_reservation public.ticket_order_reservations%rowtype;
begin
  select
    ticket_order.user_id,
    ticket_order.status,
    ticket_order.total,
    ticket_order.event_id
  into
    v_order_user_id,
    v_order_status,
    v_order_total,
    v_event_id
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found or p_user_id is null or v_order_user_id is distinct from p_user_id then
    request_id := null;
    result := 'not_found';
    return next;
    return;
  end if;
  if v_order_status = 'canceled' then
    select request.id into request_id
    from public.ticket_cancellation_requests as request
    where request.ticket_order_id = p_ticket_order_id
      and request.status = 'completed'
    order by request.requested_at desc, request.id
    limit 1;
    result := case when request_id is null then 'already_canceled' else 'completed' end;
    return next;
    return;
  end if;
  if v_order_status not in ('pending', 'paid') then
    request_id := null;
    result := 'not_cancelable';
    return next;
    return;
  end if;

  select request.id, request.status
  into v_existing_request
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  limit 1
  for update of request;
  if found then
    request_id := v_existing_request.id;
    result := v_existing_request.status;
    return next;
    return;
  end if;

  select event_record.starts_at
  into v_cutoff_at
  from public.events as event_record
  where event_record.id = v_event_id
  for share of event_record;
  if v_cutoff_at is null or now() >= v_cutoff_at then
    request_id := null;
    result := 'policy_closed';
    return next;
    return;
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket' and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket' and attempt.ref_id = p_ticket_order_id
  order by attempt.id
  for update of attempt;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = p_ticket_order_id
  order by ticket.id
  for update of ticket;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = p_ticket_order_id
  for update;
  if not found then
    request_id := null;
    result := 'not_cancelable';
    return next;
    return;
  end if;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id = v_reservation.ticket_type_id
  for update of ticket_type;

  if v_order_status = 'paid' and (
    not exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = p_ticket_order_id
    )
    or exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_order_id = p_ticket_order_id
        and ticket.status <> 'valid'
    )
  ) then
    request_id := null;
    result := 'not_cancelable';
    return next;
    return;
  end if;

  insert into public.ticket_cancellation_requests (
    ticket_order_id,
    requested_by,
    source,
    status,
    policy_code,
    cutoff_at,
    gross_amount,
    fee_amount,
    refund_amount,
    reason
  )
  values (
    p_ticket_order_id,
    p_user_id,
    'user',
    'requested',
    'event_start_full_refund_v1',
    v_cutoff_at,
    v_order_total,
    0,
    v_order_total,
    '사용자 예매 취소 요청'
  )
  returning id into request_id;

  insert into public.audit_log (actor_id, action, target, diff)
  values (
    p_user_id,
    'ticket.cancellation.requested',
    'ticket_order:' || p_ticket_order_id::text,
    jsonb_build_object(
      'requestId', request_id,
      'source', 'user',
      'policyCode', 'event_start_full_refund_v1',
      'to', 'requested'
    )
  );

  if v_order_status = 'pending'
    and not exists (
      select 1 from public.payments as payment
      where payment.purpose = 'ticket'
        and payment.ref_id = p_ticket_order_id
        and payment.status in ('pending', 'paid')
    )
    and not exists (
      select 1 from public.payment_attempts as attempt
      where attempt.purpose = 'ticket'
        and attempt.ref_id = p_ticket_order_id
        and attempt.state in ('confirming', 'approved', 'unknown', 'needs_review')
    )
  then
    result := public.finalize_ticket_cancellation_request(request_id, p_user_id);
  else
    result := 'requested';
  end if;
  return next;
end;
$function$;

-- Expiry and no-payment cancellation use the same explicit capacity snapshot.
-- Any confirming or ambiguous attempt preserves the reservation for staff
-- reconciliation; only a prepared/declined/canceled attempt can be released.
create or replace function public.refund_ticket_order(
  p_ticket_order_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order_status public.ticket_order_status;
  v_reservation public.ticket_order_reservations%rowtype;
begin
  -- Keep the legacy signature stable for callers while retaining the reason
  -- as an explicit input to this operational path.
  perform p_reason;

  select ticket_order.status
  into v_order_status
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;
  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;
  if v_order_status = 'canceled' then
    return;
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = p_ticket_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket' and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  perform attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket' and attempt.ref_id = p_ticket_order_id
  order by attempt.id
  for update of attempt;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = p_ticket_order_id
  order by ticket.id
  for update of ticket;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = p_ticket_order_id
  for update;
  if not found then
    raise check_violation using message = 'ticket reservation missing';
  end if;

  perform ticket_type.id
  from public.ticket_types as ticket_type
  where ticket_type.id = v_reservation.ticket_type_id
  for update of ticket_type;

  if v_order_status <> 'pending' then
    raise check_violation using message = 'payment evidence required';
  end if;
  if exists (
    select 1 from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
      and payment.status in ('pending', 'paid')
  ) then
    raise check_violation using message = 'provider cancellation required';
  end if;
  if exists (
    select 1 from public.payment_attempts as attempt
    where attempt.purpose = 'ticket'
      and attempt.ref_id = p_ticket_order_id
      and attempt.state in ('confirming', 'approved', 'unknown', 'needs_review')
  ) then
    raise check_violation using message = 'provider reconciliation required';
  end if;

  update public.payment_attempts
  set
    state = 'canceled',
    claim_token = null,
    claim_expires_at = null
  where purpose = 'ticket'
    and ref_id = p_ticket_order_id
    and state = 'prepared';

  update public.ticket_types
  set sold = sold - v_reservation.quantity
  where id = v_reservation.ticket_type_id;

  update public.tickets
  set status = 'refunded'
  where ticket_order_id = p_ticket_order_id;

  update public.ticket_orders
  set status = 'canceled', expires_at = null
  where id = p_ticket_order_id;
end;
$function$;

create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_count integer := 0;
  r record;
begin
  for r in
    select orders.id
    from public.orders
    where orders.status = 'pending'
      and orders.expires_at is not null
      and orders.expires_at < now() - interval '5 minutes'
      and not exists (
        select 1 from public.payments as payment
        where payment.purpose = 'order'
          and payment.ref_id = orders.id
          and payment.status in ('pending', 'paid')
      )
      and not exists (
        select 1 from public.order_cancellation_requests as request
        where request.order_id = orders.id
          and request.status in ('requested', 'processing', 'needs_review')
      )
      and not exists (
        select 1 from public.payment_attempts as attempt
        where attempt.purpose = 'order'
          and attempt.ref_id = orders.id
          and attempt.state in ('confirming', 'unknown', 'needs_review', 'approved')
      )
    order by orders.expires_at
    limit 200
    for update of orders skip locked
  loop
    perform public.cancel_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;

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
          and request.status in ('requested', 'processing', 'needs_review')
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
    perform public.refund_ticket_order(r.id, '결제 시간 만료 자동 취소');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

-- New Toss ticket checkout is closed. This compatibility finalizer may only
-- settle a locally known Toss row created before the provider seam, and only
-- when its legacy placeholder tickets still match the reservation snapshot.
create or replace function public.confirm_ticket_payment(
  p_idempotency_key text,
  p_ticket_order_id uuid,
  p_payment_key text,
  p_amount bigint,
  p_raw jsonb
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $function$
declare
  v_order public.ticket_orders%rowtype;
  v_payment public.payments%rowtype;
  v_reservation public.ticket_order_reservations%rowtype;
  v_ticket_count integer;
begin
  if p_idempotency_key is null
    or p_idempotency_key is distinct from p_payment_key
    or nullif(btrim(p_payment_key), '') is null
    or btrim(p_payment_key) <> p_payment_key
    or length(p_payment_key) > 200
    or p_amount is null
    or p_amount <= 0
  then
    raise check_violation using message = 'invalid payment evidence';
  end if;

  select ticket_order.*
  into v_order
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update;
  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order.id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;
  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  select payment.*
  into v_payment
  from public.payments as payment
  where payment.idempotency_key = p_idempotency_key
    and payment.payment_key = p_payment_key
  for update;
  if not found
    or v_payment.provider is distinct from 'toss'
    or v_payment.purpose is distinct from 'ticket'
    or v_payment.ref_id is distinct from v_order.id
    or v_payment.user_id is distinct from v_order.user_id
    or v_payment.amount is distinct from p_amount
    or v_order.total is distinct from p_amount
  then
    raise object_not_in_prerequisite_state using message = 'legacy_toss_payment_unknown';
  end if;

  if v_payment.status in ('paid', 'refunded') then
    return;
  end if;
  if v_payment.status is distinct from 'pending'
    or v_order.status is distinct from 'pending'
    or (v_order.expires_at is not null and now() >= v_order.expires_at)
  then
    raise check_violation using message = 'payment not payable';
  end if;

  select reservation.*
  into v_reservation
  from public.ticket_order_reservations as reservation
  where reservation.ticket_order_id = v_order.id
  for update;
  if not found
    or v_reservation.quantity::bigint * v_reservation.unit_price::bigint <> v_order.total
  then
    raise check_violation using message = 'legacy ticket reservation mismatch';
  end if;

  perform ticket.id
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order.id
  order by ticket.id
  for update of ticket;

  select count(*)::integer
  into v_ticket_count
  from public.tickets as ticket
  where ticket.ticket_order_id = v_order.id
    and ticket.ticket_type_id = v_reservation.ticket_type_id
    and ticket.status = 'valid';
  if v_ticket_count <> v_reservation.quantity then
    raise object_not_in_prerequisite_state using message = 'legacy_toss_payment_unknown';
  end if;

  update public.payments
  set status = 'paid', raw = p_raw
  where id = v_payment.id;

  update public.ticket_orders
  set status = 'paid', expires_at = null
  where id = v_order.id;

  update public.tickets
  set qr_token = encode(extensions.gen_random_bytes(16), 'hex')
  where ticket_order_id = v_order.id
    and qr_token is null;
end;
$function$;

revoke all on function public.prepare_ticket_payment_attempt(
  uuid, uuid, public.payment_provider
) from public, anon, authenticated, service_role;
grant execute on function public.prepare_ticket_payment_attempt(
  uuid, uuid, public.payment_provider
) to service_role;

revoke all on function public.bind_ticket_payment_callback_nonce(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.bind_ticket_payment_callback_nonce(uuid, text)
  to service_role;

revoke all on function public.claim_ticket_payment_attempt(
  public.payment_provider, text, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_payment_attempt(
  public.payment_provider, text, text, uuid
) to service_role;

revoke all on function public.finalize_ticket_payment_attempt(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_ticket_payment_attempt(
  uuid, uuid, public.payment_attempt_state, text, text, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.claim_ticket_payment_refund(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_ticket_payment_refund(uuid, uuid, uuid)
  to service_role;

revoke all on function public.finalize_ticket_payment_refund(
  uuid, uuid, uuid, public.payment_attempt_state, bigint, text, text, text, text, text, text, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.finalize_ticket_payment_refund(
  uuid, uuid, uuid, public.payment_attempt_state, bigint, text, text, text, text, text, text, timestamptz
) to service_role;

revoke all on function public.finalize_ticket_cancellation_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_ticket_cancellation(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.request_ticket_cancellation(uuid, uuid)
  to service_role;
revoke all on function public.refund_ticket_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order(uuid, text)
  to service_role;
revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;

-- `begin_ticket_payment_approval` can create a Toss row and is therefore no
-- longer executable. Known legacy rows enter only through the strict webhook
-- finalizer above.
revoke all on function public.begin_ticket_payment_approval(uuid, uuid, text, bigint)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  to service_role;

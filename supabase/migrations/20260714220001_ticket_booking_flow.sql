-- Ticket booking contract (#54): idempotent reservations and verified payment finalization.

alter table public.ticket_orders
  add column reservation_key uuid;

create unique index ticket_orders_user_reservation_key_uidx
  on public.ticket_orders (user_id, reservation_key)
  where reservation_key is not null;

-- Private ticket state is readable through RLS but never directly writable by browsers.
revoke all on table public.ticket_orders, public.tickets, public.check_ins
  from public, anon, authenticated, service_role;
grant select on table public.ticket_orders, public.tickets, public.check_ins
  to authenticated;
grant select, insert, update, delete
  on table public.ticket_orders, public.tickets, public.check_ins
  to service_role;

drop function public.reserve_tickets(uuid, integer);

create function public.reserve_tickets(
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
as $$
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
  v_existing_ticket_type_id uuid;
  v_existing_ticket_type_count bigint;
  v_existing_qty bigint;
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
  ) then
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
    select
      min(ticket.ticket_type_id::text)::uuid,
      count(distinct ticket.ticket_type_id),
      count(*)
      into
        v_existing_ticket_type_id,
        v_existing_ticket_type_count,
        v_existing_qty
    from public.tickets as ticket
    where ticket.ticket_order_id = v_existing_order.id;

    if v_existing_ticket_type_count = 1
      and v_existing_ticket_type_id = p_ticket_type_id
      and v_existing_qty = p_qty::bigint
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

  select count(*)
    into v_already_reserved
  from public.tickets as ticket
  join public.ticket_orders as ticket_order
    on ticket_order.id = ticket.ticket_order_id
  where ticket.ticket_type_id = p_ticket_type_id
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

  insert into public.tickets (ticket_order_id, ticket_type_id)
  select v_order_id, p_ticket_type_id
  from generate_series(1, p_qty);

  return v_order_id;
end;
$$;

revoke all on function public.reserve_tickets(uuid, uuid, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reserve_tickets(uuid, uuid, integer, uuid)
  to service_role;

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
as $$
declare
  v_user uuid;
  v_total bigint;
  v_order_status public.ticket_order_status;
  v_expires_at timestamptz;
  v_existing_payment public.payments%rowtype;
  v_has_existing_payment boolean := false;
begin
  if p_idempotency_key is null
    or nullif(btrim(p_idempotency_key), '') is null
    or length(p_idempotency_key) > 200
    or p_payment_key is null
    or nullif(btrim(p_payment_key), '') is null
    or length(p_payment_key) > 200
  then
    raise check_violation using message = 'invalid payment evidence';
  end if;

  if p_idempotency_key is distinct from p_payment_key then
    raise unique_violation using message = 'idempotency conflict';
  end if;

  select
    ticket_order.user_id,
    ticket_order.total,
    ticket_order.status,
    ticket_order.expires_at
    into
      v_user,
      v_total,
      v_order_status,
      v_expires_at
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ticket_payment:' || p_idempotency_key, 0)
  );

  select payment.*
    into v_existing_payment
  from public.payments as payment
  where payment.idempotency_key = p_idempotency_key
  for update of payment;

  v_has_existing_payment := found;

  if v_has_existing_payment then
    if v_existing_payment.purpose <> 'ticket'
      or v_existing_payment.ref_id is distinct from p_ticket_order_id
      or v_existing_payment.user_id is distinct from v_user
      or v_existing_payment.amount is distinct from p_amount
      or v_existing_payment.payment_key is distinct from p_payment_key
    then
      raise unique_violation using message = 'idempotency conflict';
    end if;

    if v_existing_payment.status in ('paid', 'refunded') then
      return;
    end if;

    if v_existing_payment.status <> 'pending' then
      raise check_violation using message = 'payment not payable';
    end if;
  end if;

  if v_order_status <> 'pending' then
    raise check_violation using message = 'ticket order not payable';
  end if;

  if v_expires_at is not null and now() >= v_expires_at then
    raise check_violation using message = 'ticket order expired';
  end if;

  if p_amount is distinct from v_total then
    raise check_violation using message = 'amount mismatch';
  end if;

  if v_has_existing_payment then
    update public.payments
    set
      status = 'paid',
      raw = p_raw
    where id = v_existing_payment.id;
  else
    insert into public.payments (
      user_id,
      purpose,
      ref_id,
      amount,
      status,
      payment_key,
      idempotency_key,
      raw
    )
    values (
      v_user,
      'ticket',
      p_ticket_order_id,
      p_amount,
      'paid',
      p_payment_key,
      p_idempotency_key,
      p_raw
    );
  end if;

  update public.ticket_orders
  set
    status = 'paid',
    expires_at = null
  where id = p_ticket_order_id;

  update public.tickets
  set qr_token = encode(extensions.gen_random_bytes(16), 'hex')
  where ticket_order_id = p_ticket_order_id
    and qr_token is null;
end;
$$;

revoke all on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_ticket_payment(text, uuid, text, bigint, jsonb)
  to service_role;

-- Provider가 취소됐다고 fresh 조회한 정확한 paymentKey만 정합화한다. 같은 예매에
-- 다른 결제 시도가 남아 있으면 그 시도의 돈과 선점을 건드리지 않는다.
create function public.refund_ticket_order_with_provider_evidence(
  p_ticket_order_id uuid,
  p_reason text,
  p_provider_payment_key text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_user_id uuid;
  v_order_status public.ticket_order_status;
  v_order_total bigint;
  v_payment_id uuid;
  v_payment_user_id uuid;
  v_payment_purpose public.payment_purpose;
  v_payment_ref_id uuid;
  v_payment_amount bigint;
  v_payment_status public.payment_status;
  v_payment_key text;
  v_current_was_paid boolean := false;
  v_has_other_active_payment boolean;
  v_has_paid_cancellation_evidence boolean;
  v_ticket record;
begin
  if p_provider_payment_key is null
    or nullif(btrim(p_provider_payment_key), '') is null
    or length(p_provider_payment_key) > 200
  then
    raise check_violation using message = 'invalid payment evidence';
  end if;

  select
    ticket_order.user_id,
    ticket_order.status,
    ticket_order.total
    into
      v_order_user_id,
      v_order_status,
      v_order_total
  from public.ticket_orders as ticket_order
  where ticket_order.id = p_ticket_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  -- 결제 확정과 같은 order → payment 순서로 모든 시도를 결정적으로 잠근다.
  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  select
    payment.id,
    payment.user_id,
    payment.purpose,
    payment.ref_id,
    payment.amount,
    payment.status,
    payment.payment_key
    into
      v_payment_id,
      v_payment_user_id,
      v_payment_purpose,
      v_payment_ref_id,
      v_payment_amount,
      v_payment_status,
      v_payment_key
  from public.payments as payment
  where payment.idempotency_key = p_provider_payment_key;

  if not found
    or v_payment_purpose is distinct from 'ticket'
    or v_payment_ref_id is distinct from p_ticket_order_id
    or v_payment_user_id is distinct from v_order_user_id
    or v_payment_amount is distinct from v_order_total
    or v_payment_key is distinct from p_provider_payment_key
  then
    raise check_violation using message = 'payment evidence mismatch';
  end if;

  -- Provider가 취소한 현재 키 하나만 먼저 terminal 장부로 수렴시킨다.
  if v_payment_status = 'paid' then
    v_current_was_paid := true;

    insert into public.refunds (payment_id, amount, reason, status)
    values (v_payment_id, v_payment_amount, p_reason, 'done')
    on conflict (payment_id) do update
    set
      amount = excluded.amount,
      reason = coalesce(public.refunds.reason, excluded.reason),
      status = 'done';

    update public.payments
    set status = 'refunded'
    where id = v_payment_id;
  elsif v_payment_status in ('pending', 'failed') then
    update public.payments
    set status = 'canceled'
    where id = v_payment_id;
  end if;

  -- 이미 닫힌 예매의 같은 provider 취소 replay는 sold를 다시 원복하지 않는다.
  if v_order_status = 'canceled' then
    return;
  end if;

  if v_order_status not in ('pending', 'paid') then
    raise check_violation using message = 'ticket order not cancelable';
  end if;

  select exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
      and payment.id <> v_payment_id
      and payment.status in ('pending', 'paid')
  ) into v_has_other_active_payment;

  -- 다른 live 결제는 이 취소 key의 증거가 아니므로 예매와 선점을 보존한다.
  if v_has_other_active_payment then
    return;
  end if;

  -- paid 예매는 이번 키가 실제 paid였거나, 앞선 호출이 paid 키를 정확히
  -- 환불 완료한 장부가 있어야만 마지막 선점을 해제할 수 있다.
  if v_order_status = 'paid' then
    select exists (
      select 1
      from public.payments as payment
      join public.refunds as refund on refund.payment_id = payment.id
      where payment.purpose = 'ticket'
        and payment.ref_id = p_ticket_order_id
        and payment.status = 'refunded'
        and refund.status = 'done'
    ) into v_has_paid_cancellation_evidence;

    if not v_current_was_paid and not v_has_paid_cancellation_evidence then
      raise check_violation using message = 'payment evidence required';
    end if;
  end if;

  -- 다른 결제 시도가 모두 terminal인 실제 종료 시점에만 사용 여부를 검사한다.
  if exists (
    select 1
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
      and ticket.status = 'used'
  ) then
    raise check_violation using message = 'used ticket cannot be refunded';
  end if;

  for v_ticket in
    select ticket.ticket_type_id, count(*)::integer as qty
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
    group by ticket.ticket_type_id
    order by ticket.ticket_type_id
  loop
    update public.ticket_types
    set sold = sold - v_ticket.qty
    where id = v_ticket.ticket_type_id;
  end loop;

  update public.tickets
  set status = 'refunded'
  where ticket_order_id = p_ticket_order_id;

  update public.ticket_orders
  set
    status = 'canceled',
    expires_at = null
  where id = p_ticket_order_id;
end;
$$;

revoke all on function public.refund_ticket_order_with_provider_evidence(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order_with_provider_evidence(uuid, text, text)
  to service_role;

-- Cron/expiry는 provider active payment가 전혀 없는 pending 예매만 닫는 wrapper를 유지한다.
create or replace function public.refund_ticket_order(
  p_ticket_order_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_status public.ticket_order_status;
  v_ticket record;
begin
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

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'ticket'
    and payment.ref_id = p_ticket_order_id
  order by payment.id
  for update of payment;

  if v_order_status <> 'pending' then
    raise check_violation using message = 'payment evidence required';
  end if;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'ticket'
      and payment.ref_id = p_ticket_order_id
      and payment.status in ('pending', 'paid')
  ) then
    raise check_violation using message = 'provider cancellation required';
  end if;

  for v_ticket in
    select ticket.ticket_type_id, count(*)::integer as qty
    from public.tickets as ticket
    where ticket.ticket_order_id = p_ticket_order_id
    group by ticket.ticket_type_id
    order by ticket.ticket_type_id
  loop
    update public.ticket_types
    set sold = sold - v_ticket.qty
    where id = v_ticket.ticket_type_id;
  end loop;

  update public.tickets
  set status = 'refunded'
  where ticket_order_id = p_ticket_order_id;

  update public.ticket_orders
  set
    status = 'canceled',
    expires_at = null
  where id = p_ticket_order_id;
end;
$$;

revoke all on function public.refund_ticket_order(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.refund_ticket_order(uuid, text)
  to service_role;

-- Keep the latest order-cancellation filters and lock ticket expirations before cleanup.
create or replace function public.expire_stale_checkouts()
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
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
          and request.status in ('requested', 'processing', 'needs_review')
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
        select 1
        from public.payments as payment
        where payment.purpose = 'ticket'
          and payment.ref_id = ticket_orders.id
          and payment.status in ('pending', 'paid')
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
$$;

revoke all on function public.expire_stale_checkouts()
  from public, anon, authenticated, service_role;
grant execute on function public.expire_stale_checkouts()
  to service_role;

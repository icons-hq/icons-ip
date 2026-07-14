-- 현장 검표 계약 (#97): service-role 경계, staff 재검증, 멱등 원장과 감사.

drop function if exists public.check_in_ticket(text);

create function public.check_in_ticket(
  p_staff_id uuid,
  p_qr_token text
)
returns table (
  result text,
  checked_at timestamptz,
  event_id text,
  event_title text,
  ticket_type_id uuid,
  ticket_type_name text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_order_id uuid;
  v_order_status public.ticket_order_status;
  v_ticket_id uuid;
  v_ticket_status public.ticket_status;
  v_ticket_type_id uuid;
  v_event_id text;
  v_event_title text;
  v_ticket_type_name text;
  v_checked_at timestamptz;
begin
  if p_staff_id is null or not exists (
    select 1
    from public.profiles as profile
    where profile.id = p_staff_id
      and profile.role in ('staff', 'admin')
  ) then
    raise insufficient_privilege using message = 'staff access required';
  end if;

  if p_qr_token is null or p_qr_token !~ '^[0-9a-f]{32}$' then
    raise check_violation using message = 'invalid qr token';
  end if;

  -- QR lookup 자체는 잠그지 않는다. order 잠금이 검표·취소의 직렬화 기준이다.
  select ticket.id, ticket.ticket_order_id
  into v_ticket_id, v_order_id
  from public.tickets as ticket
  where ticket.qr_token = p_qr_token;

  if not found then
    return query
    select
      'not_found'::text,
      null::timestamptz,
      null::text,
      null::text,
      null::uuid,
      null::text;
    return;
  end if;

  select ticket_order.status
  into v_order_status
  from public.ticket_orders as ticket_order
  where ticket_order.id = v_order_id
  for update of ticket_order;

  if not found then
    raise no_data_found using message = 'ticket order not found';
  end if;

  perform request.id
  from public.ticket_cancellation_requests as request
  where request.ticket_order_id = v_order_id
    and request.status in ('requested', 'processing', 'needs_review')
  order by request.requested_at desc, request.id
  for update of request;

  if found then
    raise check_violation using message = 'ticket cancellation in progress';
  end if;

  select
    ticket.status,
    ticket.ticket_type_id,
    ticket_type.event_id,
    event.title,
    ticket_type.name
  into
    v_ticket_status,
    v_ticket_type_id,
    v_event_id,
    v_event_title,
    v_ticket_type_name
  from public.tickets as ticket
  join public.ticket_types as ticket_type on ticket_type.id = ticket.ticket_type_id
  join public.events as event on event.id = ticket_type.event_id
  where ticket.id = v_ticket_id
    and ticket.ticket_order_id = v_order_id
    and ticket.qr_token = p_qr_token
  for update of ticket;

  if not found then
    raise check_violation using message = 'ticket changed during check-in';
  end if;

  if v_ticket_status = 'valid' then
    if v_order_status <> 'paid' then
      raise check_violation using message = 'ticket order not paid';
    end if;

    v_checked_at := clock_timestamp();

    update public.tickets
    set status = 'used'
    where id = v_ticket_id;

    insert into public.check_ins (ticket_id, checked_at, by_staff)
    values (v_ticket_id, v_checked_at, p_staff_id);

    insert into public.audit_log (actor_id, action, target, diff)
    values (
      p_staff_id,
      'admin.ticket.checked_in',
      format('tickets:%s', v_ticket_id),
      jsonb_build_object(
        'before', jsonb_build_object('status', 'valid'),
        'after', jsonb_build_object('status', 'used')
      )
    );

    return query
    select
      'checked_in'::text,
      v_checked_at,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  if v_ticket_status = 'used' then
    select check_in.checked_at
    into v_checked_at
    from public.check_ins as check_in
    where check_in.ticket_id = v_ticket_id;

    if not found then
      raise check_violation using message = 'used ticket check-in ledger missing';
    end if;

    return query
    select
      'already_used'::text,
      v_checked_at,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  if v_ticket_status = 'refunded' then
    return query
    select
      'refunded'::text,
      null::timestamptz,
      v_event_id,
      v_event_title,
      v_ticket_type_id,
      v_ticket_type_name;
    return;
  end if;

  raise check_violation using message = 'unsupported ticket status';
end;
$$;

revoke all on function public.check_in_ticket(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.check_in_ticket(uuid, text)
  to service_role;

-- Audited ticket-session configuration with allocation-safe capacity updates (#96).

drop policy if exists ticket_types_insert on public.ticket_types;
drop policy if exists ticket_types_update on public.ticket_types;
drop policy if exists ticket_types_delete on public.ticket_types;

revoke all on table public.ticket_types from public, anon, authenticated;
grant select on table public.ticket_types to anon, authenticated;

create or replace function public.admin_upsert_ticket_type(
  target_operation_id uuid,
  target_ticket_type_id uuid,
  target_event_id text,
  target_name text,
  target_price integer,
  target_capacity integer
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_event_id text := btrim(target_event_id, E' \t\n\r\f\v');
  normalized_name text := btrim(target_name, E' \t\n\r\f\v');
  request_payload jsonb;
  previous_ticket_type public.ticket_types%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
  ticket_type_exists boolean := false;
  has_ticket_history boolean := false;
  existing_actor_id uuid;
  existing_action text;
  existing_target text;
  existing_diff jsonb;
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if target_operation_id is null then
    raise exception 'invalid_operation_id' using errcode = '22004';
  end if;

  if target_ticket_type_id is null then
    raise exception 'invalid_ticket_type_id' using errcode = '22004';
  end if;

  if normalized_event_id is null or normalized_event_id = '' then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  if normalized_name is null or normalized_name = '' then
    raise exception 'invalid_ticket_type_name' using errcode = '22023';
  end if;

  if target_price is null or target_price < 0 then
    raise exception 'invalid_ticket_type_price' using errcode = '22023';
  end if;

  if target_capacity is null or target_capacity < 0 then
    raise exception 'invalid_ticket_type_capacity' using errcode = '22023';
  end if;

  request_payload := jsonb_build_object(
    'event_id', normalized_event_id,
    'name', normalized_name,
    'price', target_price,
    'capacity', target_capacity
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_ticket_type_operation:' || target_operation_id::text, 0)
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.ticket_type.upserted'
      and existing_target = 'ticket_types:' || target_ticket_type_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_ticket_type_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_ticket_type:' || target_ticket_type_id::text, 0)
  );

  perform 1
  from public.events
  where id = normalized_event_id
  for key share;

  if not found then
    raise exception 'event_not_found' using errcode = 'P0002';
  end if;

  select ticket_type.*
    into previous_ticket_type
  from public.ticket_types as ticket_type
  where ticket_type.id = target_ticket_type_id
  for update;

  ticket_type_exists := found;

  if ticket_type_exists then
    if target_capacity < previous_ticket_type.sold then
      raise exception 'capacity_below_sold' using errcode = '23514';
    end if;

    select exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_type_id = target_ticket_type_id
    ) into has_ticket_history;

    if has_ticket_history and (
      previous_ticket_type.event_id is distinct from normalized_event_id
      or previous_ticket_type.name is distinct from normalized_name
      or previous_ticket_type.price is distinct from target_price
    ) then
      raise exception 'ticket_type_catalog_locked' using errcode = '23514';
    end if;

    previous_payload := jsonb_build_object(
      'event_id', previous_ticket_type.event_id,
      'name', previous_ticket_type.name,
      'price', previous_ticket_type.price,
      'capacity', previous_ticket_type.capacity,
      'sold', previous_ticket_type.sold
    );

    update public.ticket_types
    set event_id = normalized_event_id,
        name = normalized_name,
        price = target_price,
        capacity = target_capacity
    where id = target_ticket_type_id;

    after_payload := jsonb_build_object(
      'event_id', normalized_event_id,
      'name', normalized_name,
      'price', target_price,
      'capacity', target_capacity,
      'sold', previous_ticket_type.sold
    );
  else
    insert into public.ticket_types (id, event_id, name, price, capacity)
    values (
      target_ticket_type_id,
      normalized_event_id,
      normalized_name,
      target_price,
      target_capacity
    );

    after_payload := jsonb_build_object(
      'event_id', normalized_event_id,
      'name', normalized_name,
      'price', target_price,
      'capacity', target_capacity,
      'sold', 0
    );
  end if;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.ticket_type.upserted',
    'ticket_types:' || target_ticket_type_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_ticket_type_id;
end;
$$;

revoke all on function public.admin_upsert_ticket_type(uuid, uuid, text, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_ticket_type(uuid, uuid, text, text, integer, integer)
  to authenticated;

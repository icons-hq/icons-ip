-- Audited, idempotent inventory adjustments for staff operations (#94).

create or replace function public.admin_adjust_stock(
  target_adjustment_id uuid,
  target_good_id text,
  target_expected_stock_qty integer,
  target_delta integer,
  target_reason text
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_reason text;
  previous_stock_qty integer;
  next_stock_qty bigint;
  requested_diff jsonb;
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

  normalized_reason := btrim(target_reason, E' \t\n\r\f\v');

  if target_adjustment_id is null then
    raise exception 'invalid_adjustment_id' using errcode = '22004';
  end if;

  if target_expected_stock_qty is null or target_expected_stock_qty < 0 then
    raise exception 'invalid_expected_stock_qty' using errcode = '22023';
  end if;

  if target_delta is null or target_delta = 0 then
    raise exception 'invalid_stock_delta' using errcode = '22023';
  end if;

  if normalized_reason is null
    or char_length(normalized_reason) < 1
    or char_length(normalized_reason) > 200
  then
    raise exception 'invalid_stock_reason' using errcode = '22023';
  end if;

  -- A lost-response retry must observe the first committed audit before deciding
  -- whether this adjustment ID is an idempotent replay or a conflicting reuse.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_stock_adjustment:' || target_adjustment_id::text, 0)
  );

  next_stock_qty := target_expected_stock_qty::bigint + target_delta::bigint;
  requested_diff := jsonb_build_object(
    'from', target_expected_stock_qty,
    'delta', target_delta,
    'to', next_stock_qty,
    'reason', normalized_reason
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_adjustment_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.good.stock_adjusted'
      and existing_target = 'goods:' || target_good_id
      and existing_diff = requested_diff
    then
      return (existing_diff ->> 'to')::integer;
    end if;

    raise exception 'adjustment_conflict' using errcode = '23505';
  end if;

  select good.stock_qty
    into previous_stock_qty
  from public.goods as good
  where good.id = target_good_id
  for update;

  if not found then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  if previous_stock_qty <> target_expected_stock_qty then
    raise exception 'stock_changed' using errcode = 'P0001';
  end if;

  next_stock_qty := previous_stock_qty::bigint + target_delta::bigint;

  if next_stock_qty < 0 or next_stock_qty > 2147483647 then
    raise exception 'stock_out_of_range' using errcode = '22003';
  end if;

  update public.goods
  set stock_qty = next_stock_qty::integer
  where id = target_good_id;

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_adjustment_id,
    actor_id,
    'admin.good.stock_adjusted',
    'goods:' || target_good_id,
    jsonb_build_object(
      'from', previous_stock_qty,
      'delta', target_delta,
      'to', next_stock_qty,
      'reason', normalized_reason
    )
  );

  return next_stock_qty::integer;
end;
$$;

revoke all on function public.admin_adjust_stock(uuid, text, integer, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_adjust_stock(uuid, text, integer, integer, text)
  to authenticated;

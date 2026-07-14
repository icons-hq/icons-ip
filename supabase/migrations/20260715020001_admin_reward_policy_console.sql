-- Audited reward-policy operations and durable draw-ticket attribution (#99).

-- Existing policies were pool-IP scoped. Preserve that meaning while adding
-- explicit target and operating-window fields for subsequent audited writes.
alter table public.reward_policies
  add column target_ip_id text,
  add column target_good_id text,
  add column active_from timestamptz,
  add column active_to timestamptz;

update public.reward_policies as reward_policy
set
  target_ip_id = card_pool.ip_id,
  active_from = reward_policy.created_at
from public.card_pools as card_pool
where card_pool.id = reward_policy.pool_id;

alter table public.reward_policies
  alter column target_ip_id set not null,
  alter column active_from set default now(),
  alter column active_from set not null,
  add constraint reward_policies_active_window_check
    check (active_to is null or active_to > active_from)
    not valid;

alter table public.reward_policies
  validate constraint reward_policies_active_window_check;

alter table public.goods
  add constraint goods_id_ip_id_key unique (id, ip_id);

alter table public.reward_policies
  add constraint reward_policies_target_ip_id_fkey
    foreign key (target_ip_id)
    references public.ips (id)
    not valid,
  add constraint reward_policies_target_good_ip_fkey
    foreign key (target_good_id, target_ip_id)
    references public.goods (id, ip_id)
    not valid,
  add constraint reward_policies_id_pool_id_key unique (id, pool_id);

alter table public.reward_policies
  validate constraint reward_policies_target_ip_id_fkey;
alter table public.reward_policies
  validate constraint reward_policies_target_good_ip_fkey;

alter table public.draw_tickets
  add column reward_policy_id uuid,
  add column revoked_at timestamptz,
  add constraint draw_tickets_consumed_revoked_check
    check (consumed_at is null or revoked_at is null)
    not valid,
  add constraint draw_tickets_reward_policy_pool_fkey
    foreign key (reward_policy_id, pool_id)
    references public.reward_policies (id, pool_id)
    not valid;

alter table public.draw_tickets
  validate constraint draw_tickets_consumed_revoked_check;
alter table public.draw_tickets
  validate constraint draw_tickets_reward_policy_pool_fkey;

create index reward_policies_target_active_idx
  on public.reward_policies (target_ip_id, active, active_from, active_to);
create index draw_tickets_reward_policy_idx
  on public.draw_tickets (reward_policy_id, created_at desc)
  where reward_policy_id is not null;

-- Every policy write, including privileged maintenance, observes the same
-- target, pool readiness, interval, and issued-ledger invariants.
create or replace function public.validate_reward_policy_mutation()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  pool_record public.card_pools%rowtype;
  good_ip_id text;
  pool_is_ready boolean := false;
  requires_eligible_pool boolean;
begin
  if new.trigger is distinct from 'order_paid' then
    raise exception 'invalid_reward_trigger' using errcode = '22023';
  end if;

  if new.min_amount is null or new.min_amount < 0 then
    raise exception 'invalid_min_amount' using errcode = '22023';
  end if;

  if new.tickets_per_grant is null or new.tickets_per_grant not between 1 and 100 then
    raise exception 'invalid_tickets_per_grant' using errcode = '22023';
  end if;

  if new.active_from is null then
    raise exception 'invalid_reward_policy_active_from' using errcode = '22004';
  end if;

  if new.active_to is not null and new.active_to <= new.active_from then
    raise exception 'invalid_reward_policy_active_window' using errcode = '23514';
  end if;

  select pool.*
    into pool_record
  from public.card_pools as pool
  where pool.id = new.pool_id
  for share;

  if not found then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  perform 1
  from public.ips
  where id = new.target_ip_id
  for key share;

  if not found then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if new.target_good_id is not null then
    select good.ip_id
      into good_ip_id
    from public.goods as good
    where good.id = new.target_good_id
    for key share;

    if not found then
      raise exception 'good_not_found' using errcode = 'P0002';
    end if;

    if good_ip_id is distinct from new.target_ip_id then
      raise exception 'reward_policy_good_ip_mismatch' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and old.pool_id is distinct from new.pool_id
    and exists (
      select 1
      from public.draw_tickets as ticket
      where ticket.reward_policy_id = old.id
    )
  then
    raise exception 'reward_policy_pool_locked' using errcode = '23514';
  end if;

  requires_eligible_pool := new.active
    or tg_op = 'INSERT'
    or (tg_op = 'UPDATE' and old.pool_id is distinct from new.pool_id);

  if requires_eligible_pool then
    if pool_record.active_to is not null and now() >= pool_record.active_to then
      raise exception 'reward_pool_not_ready' using errcode = '55000';
    end if;

    select
      count(*) = 5
      and coalesce(sum(pool_odd.probability), 0) = 1
      and coalesce(bool_and(pool_odd.probability between 0 and 1), false)
      and not exists (
        select 1
        from public.pool_odds as positive_odd
        where positive_odd.pool_id = new.pool_id
          and positive_odd.probability > 0
          and not exists (
            select 1
            from public.cards as card
            where card.pool_id = new.pool_id
              and card.rarity = positive_odd.rarity
          )
      )
      into pool_is_ready
    from public.pool_odds as pool_odd
    where pool_odd.pool_id = new.pool_id;

    if not pool_is_ready then
      raise exception 'reward_pool_not_ready' using errcode = '55000';
    end if;

    if new.active
      and greatest(new.active_from, pool_record.active_from)
      >= least(
        coalesce(new.active_to, 'infinity'::timestamptz),
        coalesce(pool_record.active_to, 'infinity'::timestamptz)
      )
    then
      raise exception 'reward_policy_pool_window_disjoint' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger reward_policies_validate_mutation
before insert or update on public.reward_policies
for each row execute function public.validate_reward_policy_mutation();

-- Pool dates are a database-wide contract. An active policy must be disabled
-- before a pool edit can erase their complete half-open interval intersection.
create or replace function public.guard_active_reward_policy_pool_window()
returns trigger
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (
    select 1
    from public.reward_policies as reward_policy
    where reward_policy.pool_id = new.id
      and reward_policy.active
      and greatest(reward_policy.active_from, new.active_from)
        >= least(
          coalesce(reward_policy.active_to, 'infinity'::timestamptz),
          coalesce(new.active_to, 'infinity'::timestamptz)
        )
  ) then
    raise exception 'active_reward_policy_window_conflict' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger card_pools_guard_active_reward_policy_window
before update of active_from, active_to on public.card_pools
for each row
when (
  old.active_from is distinct from new.active_from
  or old.active_to is distinct from new.active_to
)
execute function public.guard_active_reward_policy_pool_window();

-- Public policy reads remain catalog data. Client, staff, and service-role
-- direct writes are closed so audited RPCs are the only operating path.
drop policy if exists reward_policies_insert on public.reward_policies;
drop policy if exists reward_policies_update on public.reward_policies;
drop policy if exists reward_policies_delete on public.reward_policies;

revoke all on table public.reward_policies
  from public, anon, authenticated, service_role;
grant select on table public.reward_policies
  to anon, authenticated, service_role;

create or replace function public.admin_upsert_reward_policy(
  target_operation_id uuid,
  target_policy_id uuid,
  target_pool_id uuid,
  target_trigger text,
  target_ip_id text,
  target_good_id text,
  target_min_amount bigint,
  target_tickets_per_grant integer,
  target_active boolean,
  target_active_from timestamptz,
  target_active_to timestamptz
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
  normalized_trigger text := btrim(target_trigger, E' \t\n\r\f\v');
  normalized_ip_id text := btrim(target_ip_id, E' \t\n\r\f\v');
  normalized_good_id text := case
    when target_good_id is null then null
    else btrim(target_good_id, E' \t\n\r\f\v')
  end;
  request_payload jsonb;
  previous_policy public.reward_policies%rowtype;
  previous_payload jsonb := null;
  after_payload jsonb;
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

  if target_policy_id is null then
    raise exception 'invalid_reward_policy_id' using errcode = '22004';
  end if;

  if target_pool_id is null then
    raise exception 'pool_not_found' using errcode = 'P0002';
  end if;

  if normalized_trigger is distinct from 'order_paid' then
    raise exception 'invalid_reward_trigger' using errcode = '22023';
  end if;

  if normalized_ip_id is null or normalized_ip_id = '' then
    raise exception 'ip_not_found' using errcode = 'P0002';
  end if;

  if normalized_good_id = '' then
    raise exception 'good_not_found' using errcode = 'P0002';
  end if;

  if target_min_amount is null or target_min_amount < 0 then
    raise exception 'invalid_min_amount' using errcode = '22023';
  end if;

  if target_tickets_per_grant is null
    or target_tickets_per_grant not between 1 and 100
  then
    raise exception 'invalid_tickets_per_grant' using errcode = '22023';
  end if;

  if target_active is null then
    raise exception 'invalid_reward_policy_active' using errcode = '22004';
  end if;

  if target_active_from is null then
    raise exception 'invalid_reward_policy_active_from' using errcode = '22004';
  end if;

  if target_active_to is not null and target_active_to <= target_active_from then
    raise exception 'invalid_reward_policy_active_window' using errcode = '23514';
  end if;

  request_payload := jsonb_build_object(
    'pool_id', target_pool_id,
    'trigger', normalized_trigger,
    'target_ip_id', normalized_ip_id,
    'target_good_id', normalized_good_id,
    'min_amount', target_min_amount,
    'tickets_per_grant', target_tickets_per_grant,
    'active', target_active,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'admin_reward_policy_operation:' || target_operation_id::text,
      0
    )
  );

  select audit.actor_id, audit.action, audit.target, audit.diff
    into existing_actor_id, existing_action, existing_target, existing_diff
  from public.audit_log as audit
  where audit.id = target_operation_id;

  if found then
    if existing_actor_id = actor_id
      and existing_action = 'admin.reward_policy.upserted'
      and existing_target = 'reward_policies:' || target_policy_id::text
      and existing_diff -> 'request' = request_payload
    then
      return target_policy_id;
    end if;

    raise exception 'operation_conflict' using errcode = '23505';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin_reward_policy:' || target_policy_id::text, 0)
  );

  select reward_policy.*
    into previous_policy
  from public.reward_policies as reward_policy
  where reward_policy.id = target_policy_id
  for update;

  if found then
    previous_payload := jsonb_build_object(
      'id', previous_policy.id,
      'pool_id', previous_policy.pool_id,
      'trigger', previous_policy.trigger,
      'target_ip_id', previous_policy.target_ip_id,
      'target_good_id', previous_policy.target_good_id,
      'min_amount', previous_policy.min_amount,
      'tickets_per_grant', previous_policy.tickets_per_grant,
      'active', previous_policy.active,
      'active_from', previous_policy.active_from,
      'active_to', previous_policy.active_to
    );

    update public.reward_policies
    set
      pool_id = target_pool_id,
      trigger = normalized_trigger,
      target_ip_id = normalized_ip_id,
      target_good_id = normalized_good_id,
      min_amount = target_min_amount,
      tickets_per_grant = target_tickets_per_grant,
      active = target_active,
      active_from = target_active_from,
      active_to = target_active_to
    where id = target_policy_id;
  else
    insert into public.reward_policies (
      id,
      pool_id,
      trigger,
      target_ip_id,
      target_good_id,
      min_amount,
      tickets_per_grant,
      active,
      active_from,
      active_to
    )
    values (
      target_policy_id,
      target_pool_id,
      normalized_trigger,
      normalized_ip_id,
      normalized_good_id,
      target_min_amount,
      target_tickets_per_grant,
      target_active,
      target_active_from,
      target_active_to
    );
  end if;

  after_payload := jsonb_build_object(
    'id', target_policy_id,
    'pool_id', target_pool_id,
    'trigger', normalized_trigger,
    'target_ip_id', normalized_ip_id,
    'target_good_id', normalized_good_id,
    'min_amount', target_min_amount,
    'tickets_per_grant', target_tickets_per_grant,
    'active', target_active,
    'active_from', target_active_from,
    'active_to', target_active_to
  );

  insert into public.audit_log (id, actor_id, action, target, diff)
  values (
    target_operation_id,
    actor_id,
    'admin.reward_policy.upserted',
    'reward_policies:' || target_policy_id::text,
    jsonb_build_object(
      'request', request_payload,
      'before', previous_payload,
      'after', after_payload
    )
  );

  return target_policy_id;
end;
$$;

create or replace function public.admin_list_reward_policies()
returns table (
  id uuid,
  pool_id uuid,
  trigger text,
  target_ip_id text,
  target_good_id text,
  min_amount bigint,
  tickets_per_grant integer,
  active boolean,
  active_from timestamptz,
  active_to timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  issued_count bigint,
  available_count bigint,
  opened_count bigint,
  revoked_count bigint,
  order_count bigint,
  last_issued_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  actor_id uuid := (select auth.uid());
begin
  if actor_id is null then
    raise exception 'auth_required' using errcode = '28000';
  end if;

  if not public.is_staff() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    reward_policy.id,
    reward_policy.pool_id,
    reward_policy.trigger,
    reward_policy.target_ip_id,
    reward_policy.target_good_id,
    reward_policy.min_amount,
    reward_policy.tickets_per_grant,
    reward_policy.active,
    reward_policy.active_from,
    reward_policy.active_to,
    reward_policy.created_at,
    reward_policy.updated_at,
    count(ticket.id)::bigint as issued_count,
    count(ticket.id) filter (
      where ticket.consumed_at is null and ticket.revoked_at is null
    )::bigint as available_count,
    count(ticket.id) filter (where ticket.consumed_at is not null)::bigint
      as opened_count,
    count(ticket.id) filter (where ticket.revoked_at is not null)::bigint
      as revoked_count,
    count(distinct ticket.source_id) filter (
      where ticket.source = 'order_paid'
    )::bigint as order_count,
    max(ticket.created_at) as last_issued_at
  from public.reward_policies as reward_policy
  left join public.draw_tickets as ticket
    on ticket.reward_policy_id = reward_policy.id
  group by reward_policy.id
  order by reward_policy.created_at desc, reward_policy.id;
end;
$$;

-- Preserve the latest order/payment/cancellation locking contract while using
-- explicit target snapshots, policy windows, and durable policy attribution.
create or replace function public.confirm_order_payment(
  p_idempotency_key text,
  p_order_id uuid,
  p_payment_key text,
  p_amount bigint,
  p_raw jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid;
  v_total bigint;
  v_status public.order_status;
  v_expires_at timestamptz;
  v_existing record;
begin
  select orders.user_id, orders.total, orders.status, orders.expires_at
    into v_user, v_total, v_status, v_expires_at
  from public.orders
  where orders.id = p_order_id
  for update;

  select payments.id, payments.purpose, payments.ref_id, payments.amount, payments.status
    into v_existing
  from public.payments
  where payments.idempotency_key = p_idempotency_key
  for update;

  if v_existing.id is not null then
    if v_existing.purpose <> 'order' or v_existing.ref_id is distinct from p_order_id then
      raise exception 'idempotency conflict';
    end if;
    if v_existing.status in ('paid', 'refunded') then
      return;
    end if;
    if v_existing.status <> 'pending' then
      raise exception 'payment not payable';
    end if;
  end if;

  if exists (
    select 1
    from public.order_cancellation_claims as claim
    where claim.order_id = p_order_id
  ) then
    raise exception 'order not payable';
  end if;

  if v_user is null then
    raise exception 'order not found';
  end if;
  if v_status <> 'pending' then
    raise exception 'order not payable';
  end if;
  if v_expires_at is not null and now() >= v_expires_at then
    raise exception 'order expired';
  end if;
  if p_amount <> v_total then
    raise exception 'amount mismatch';
  end if;
  if v_existing.id is not null and v_existing.amount <> p_amount then
    raise exception 'amount mismatch';
  end if;

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
    'order',
    p_order_id,
    p_amount,
    'paid',
    p_payment_key,
    p_idempotency_key,
    p_raw
  )
  on conflict (idempotency_key) do update
    set
      status = 'paid',
      payment_key = excluded.payment_key,
      raw = excluded.raw;

  if v_status = 'pending' then
    update public.orders
    set status = 'paid', expires_at = null
    where id = p_order_id;

    insert into public.draw_tickets (
      user_id,
      pool_id,
      source,
      source_id,
      ordinal,
      reward_policy_id
    )
    select
      v_user,
      reward_policy.pool_id,
      'order_paid',
      p_order_id,
      row_number() over (order by reward_policy.id, grant_series.n),
      reward_policy.id
    from public.reward_policies as reward_policy
    join public.card_pools as card_pool
      on card_pool.id = reward_policy.pool_id
    join lateral (
      select coalesce(sum(order_item.qty * order_item.unit_price), 0) as target_subtotal
      from public.order_items as order_item
      where order_item.order_id = p_order_id
        and order_item.good_ip_id_snapshot = reward_policy.target_ip_id
        and (
          reward_policy.target_good_id is null
          or order_item.good_id = reward_policy.target_good_id
        )
    ) as subtotal on true
    cross join lateral generate_series(
      1,
      reward_policy.tickets_per_grant
    ) as grant_series(n)
    where reward_policy.trigger = 'order_paid'
      and reward_policy.active
      and subtotal.target_subtotal > 0
      and subtotal.target_subtotal >= reward_policy.min_amount
      and now() >= reward_policy.active_from
      and (reward_policy.active_to is null or now() < reward_policy.active_to)
      and now() >= card_pool.active_from
      and (card_pool.active_to is null or now() < card_pool.active_to)
    on conflict (source, source_id, ordinal) do nothing;
  end if;
end;
$$;

-- #93 renamed the full cancellation implementation behind a guarded public
-- wrapper. Keep that entrypoint structure and change only ticket recall to a
-- locked, durable, mutually exclusive soft revoke.
create or replace function public.finalize_order_cancellation_with_provider_evidence(
  p_order_id uuid,
  p_reason text,
  p_provider_payment_keys text[]
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.order_status;
  v_provider_payment_keys text[] := coalesce(
    array_remove(p_provider_payment_keys, null),
    array[]::text[]
  );
  v_item record;
begin
  select orders.status
  into v_status
  from public.orders
  where orders.id = p_order_id
  for update;

  if not found then
    raise no_data_found using message = 'order not found';
  end if;

  if v_status not in ('pending', 'paid', 'canceled') then
    raise exception using
      errcode = 'P0001',
      message = 'order not cancelable';
  end if;

  perform payment.id
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
  order by payment.id
  for update;

  if exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and payment.status in ('pending', 'paid')
      and (
        payment.payment_key is null
        or not (payment.payment_key = any(v_provider_payment_keys))
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'provider cancellation required';
  end if;

  if v_status = 'paid' and not exists (
    select 1
    from public.payments as payment
    where payment.purpose = 'order'
      and payment.ref_id = p_order_id
      and (
        payment.status in ('canceled', 'refunded')
        or payment.payment_key = any(v_provider_payment_keys)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'payment evidence required';
  end if;

  if v_status <> 'canceled' then
    for v_item in
      select order_item.good_id, order_item.qty
      from public.order_items as order_item
      where order_item.order_id = p_order_id
      order by order_item.good_id
    loop
      update public.goods
      set stock_qty = stock_qty + v_item.qty
      where id = v_item.good_id;
    end loop;

    perform ticket.id
    from public.draw_tickets as ticket
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null
    order by ticket.id
    for update;

    update public.draw_tickets as ticket
    set revoked_at = now()
    where ticket.source = 'order_paid'
      and ticket.source_id = p_order_id
      and ticket.consumed_at is null
      and ticket.revoked_at is null;
  end if;

  insert into public.refunds (payment_id, amount, reason, status)
  select
    payment.id,
    payment.amount,
    p_reason,
    'done'
  from public.payments as payment
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    )
  on conflict (payment_id) do update
  set
    amount = excluded.amount,
    reason = coalesce(public.refunds.reason, excluded.reason),
    status = 'done';

  update public.payments as payment
  set status = 'refunded'
  where payment.purpose = 'order'
    and payment.ref_id = p_order_id
    and (
      payment.status in ('canceled', 'refunded')
      or payment.payment_key = any(v_provider_payment_keys)
    );

  if v_status <> 'canceled' then
    update public.orders
    set
      status = 'canceled',
      expires_at = null
    where id = p_order_id;
  end if;

  delete from public.order_cancellation_claims
  where order_id = p_order_id;
end;
$$;

create or replace function public.open_draw_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
  v_ticket record;
  v_cards jsonb;
  v_idem text;
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  select ticket.id,
         ticket.user_id,
         ticket.pool_id,
         ticket.consumed_at,
         ticket.revoked_at
    into v_ticket
  from public.draw_tickets as ticket
  where ticket.id = p_ticket_id
  for update;

  if v_ticket.id is null then
    raise exception 'ticket not found';
  end if;
  if v_ticket.user_id <> v_user then
    raise exception 'forbidden';
  end if;
  if v_ticket.revoked_at is not null then
    raise exception 'ticket_revoked' using errcode = '55000';
  end if;

  v_idem := 'draw_ticket:' || v_ticket.id::text;

  if v_ticket.consumed_at is not null then
    select grant_record.granted_cards
      into v_cards
    from public.card_grants as grant_record
    where grant_record.idempotency_key = v_idem;

    if v_cards is not null then
      return v_cards;
    end if;

    raise exception 'ticket already consumed';
  end if;

  v_cards := public.grant_cards(
    v_user,
    v_ticket.pool_id,
    'draw_ticket',
    v_ticket.id,
    v_idem,
    1
  );

  update public.draw_tickets
  set consumed_at = now()
  where id = p_ticket_id
    and consumed_at is null
    and revoked_at is null;

  return v_cards;
end;
$$;

-- Explicit ACL sealing is required for every SECURITY DEFINER function.
revoke all on function public.validate_reward_policy_mutation()
  from public, anon, authenticated, service_role;
revoke all on function public.guard_active_reward_policy_pool_window()
  from public, anon, authenticated, service_role;

revoke all on function public.admin_upsert_reward_policy(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_reward_policy(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) to authenticated;

revoke all on function public.admin_list_reward_policies()
  from public, anon, authenticated, service_role;
grant execute on function public.admin_list_reward_policies()
  to authenticated;

revoke all on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_order_payment(text, uuid, text, bigint, jsonb)
  to service_role;

revoke all on function public.finalize_order_cancellation_with_provider_evidence(
  uuid, text, text[]
) from public, anon, authenticated, service_role;

revoke all on function public.open_draw_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.open_draw_ticket(uuid)
  to authenticated;

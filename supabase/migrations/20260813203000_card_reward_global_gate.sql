-- Card rewards stay globally unavailable until the separate legal and
-- operating review approves an explicit activation migration. The row lives in
-- private and no application role can mutate or directly read it.

create table private.card_reward_control (
  singleton boolean primary key default true,
  enabled boolean not null default false,
  changed_at timestamptz not null default now(),
  constraint card_reward_control_singleton_check check (singleton)
);

insert into private.card_reward_control (singleton, enabled)
values (true, false);

alter table private.card_reward_control enable row level security;

revoke all on table private.card_reward_control
  from public, anon, authenticated, service_role;

create function private.touch_card_reward_control_changed_at()
returns trigger
language plpgsql
volatile
set search_path = ''
as $$
begin
  new.changed_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.touch_card_reward_control_changed_at()
  from public, anon, authenticated, service_role;

create trigger trg_card_reward_control_changed_at
before update of enabled on private.card_reward_control
for each row execute function private.touch_card_reward_control_changed_at();

create function public.card_rewards_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select control.enabled
      from private.card_reward_control as control
      where control.singleton
    ),
    false
  );
$$;

revoke all on function public.card_rewards_enabled()
  from public, anon, authenticated, service_role;
grant execute on function public.card_rewards_enabled()
  to anon, authenticated;

create function private.require_card_rewards_enabled()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gate_enabled boolean;
begin
  select control.enabled
  into gate_enabled
  from private.card_reward_control as control
  where control.singleton
  for share;

  if not coalesce(gate_enabled, false) then
    raise exception 'card_rewards_disabled' using errcode = '55000';
  end if;
end;
$$;

revoke all on function private.require_card_rewards_enabled()
  from public, anon, authenticated, service_role;

-- Preserve each existing function under a private implementation name, then
-- leave the public signature as the single fail-closed wrapper.
alter function public.open_draw_ticket(uuid)
  rename to open_draw_ticket_unguarded;

create function public.open_draw_ticket(p_ticket_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_card_rewards_enabled();
  return public.open_draw_ticket_unguarded(p_ticket_id);
end;
$$;

alter function public.play_game(text)
  rename to play_game_unguarded;

create function public.play_game(p_game_id text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_card_rewards_enabled();
  return public.play_game_unguarded(p_game_id);
end;
$$;

alter function public.admin_grant_draw_tickets(uuid, uuid, uuid, integer, text)
  rename to admin_grant_draw_tickets_unguarded;

create function public.admin_grant_draw_tickets(
  target_operation_id uuid,
  target_profile_id uuid,
  target_pool_id uuid,
  target_quantity integer,
  target_reason text
)
returns integer
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_card_rewards_enabled();
  return public.admin_grant_draw_tickets_unguarded(
    target_operation_id,
    target_profile_id,
    target_pool_id,
    target_quantity,
    target_reason
  );
end;
$$;

alter function public.admin_upsert_reward_policy(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) rename to admin_upsert_reward_policy_unguarded;

create function public.admin_upsert_reward_policy(
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
begin
  if target_active then
    perform private.require_card_rewards_enabled();
  end if;

  return public.admin_upsert_reward_policy_unguarded(
    target_operation_id,
    target_policy_id,
    target_pool_id,
    target_trigger,
    target_ip_id,
    target_good_id,
    target_min_amount,
    target_tickets_per_grant,
    target_active,
    target_active_from,
    target_active_to
  );
end;
$$;

alter function public.admin_upsert_game(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) rename to admin_upsert_game_unguarded;

create function public.admin_upsert_game(
  target_operation_id uuid,
  target_previous_game_id text,
  target_game_id text,
  target_title text,
  target_reward_pool_id uuid,
  target_event_id text,
  target_per_user_daily_limit integer,
  target_active_from timestamptz,
  target_active_to timestamptz,
  target_end_now boolean
)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  -- Ending an already-running card game is a fail-safe operation and remains
  -- available. Every create/update activation request is blocked while OFF.
  if not coalesce(target_end_now, false) then
    perform private.require_card_rewards_enabled();
  end if;

  return public.admin_upsert_game_unguarded(
    target_operation_id,
    target_previous_game_id,
    target_game_id,
    target_title,
    target_reward_pool_id,
    target_event_id,
    target_per_user_daily_limit,
    target_active_from,
    target_active_to,
    target_end_now
  );
end;
$$;

-- Automatic order reward issuance cannot be cleanly wrapped because payment
-- confirmation must still succeed while rewards are disabled. A BEFORE INSERT
-- trigger independently blocks every new draw ticket, including order issuance
-- and direct SQL reached through a SECURITY DEFINER path.
create function private.guard_draw_ticket_issuance()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  gate_enabled boolean;
begin
  -- Serialize issuance against an operator disabling the singleton. Either the
  -- issuance transaction finishes first, or it observes OFF after the update.
  select control.enabled
  into gate_enabled
  from private.card_reward_control as control
  where control.singleton
  for share;

  if not coalesce(gate_enabled, false) then
    -- Automatic reward issuance must not roll back a valid goods payment.
    -- Returning NULL from a BEFORE ROW trigger suppresses only the ticket row.
    return null;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_draw_ticket_issuance()
  from public, anon, authenticated, service_role;

create trigger trg_card_reward_draw_ticket_issuance
before insert on public.draw_tickets
for each row execute function private.guard_draw_ticket_issuance();

-- Wrapper and renamed implementation ACLs must be sealed independently because
-- function rename preserves grants and CREATE FUNCTION inherits defaults.
revoke all on function public.open_draw_ticket_unguarded(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.open_draw_ticket(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.open_draw_ticket(uuid) to authenticated;

revoke all on function public.play_game_unguarded(text)
  from public, anon, authenticated, service_role;
revoke all on function public.play_game(text)
  from public, anon, authenticated, service_role;
grant execute on function public.play_game(text) to authenticated;

revoke all on function public.admin_grant_draw_tickets_unguarded(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_grant_draw_tickets(uuid, uuid, uuid, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_grant_draw_tickets(uuid, uuid, uuid, integer, text)
  to authenticated;

revoke all on function public.admin_upsert_reward_policy_unguarded(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_reward_policy(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_reward_policy(
  uuid, uuid, uuid, text, text, text, bigint, integer, boolean,
  timestamptz, timestamptz
) to authenticated;

revoke all on function public.admin_upsert_game_unguarded(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.admin_upsert_game(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_upsert_game(
  uuid, text, text, text, uuid, text, integer, timestamptz, timestamptz, boolean
) to authenticated;

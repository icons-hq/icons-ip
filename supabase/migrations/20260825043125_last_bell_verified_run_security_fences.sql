-- Verified-run acceptance hardening. This is deliberately additive to the
-- first ledger migration: the public RPC signatures and the guest cookie
-- contract stay stable while account-write and transition observation checks
-- are tightened in the database.

create function private.last_bell_assert_account_write_allowed(p_user_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_auth_email text;
begin
  -- Reuse the suspension assertion and the deletion fence's transaction
  -- scoped lock instead of duplicating either policy at each RPC callsite.
  perform private.assert_active_user(p_user_id);
  if private.is_account_write_fenced(p_user_id) then
    raise object_not_in_prerequisite_state
      using message = 'account_deletion_write_fenced';
  end if;

  select profile.*
    into v_profile
  from public.profiles as profile
  where profile.id = p_user_id
  for share;
  if not found then
    raise exception 'profile_not_found' using errcode = '22023';
  end if;

  select auth_user.email
    into v_auth_email
  from auth.users as auth_user
  where auth_user.id = p_user_id;

  -- Keep the DB condition aligned with lib/auth/onboarding.ts, including the
  -- auth-email fallback used by accounts whose profile email is still blank.
  if coalesce(nullif(pg_catalog.btrim(v_profile.email), ''), nullif(pg_catalog.btrim(v_auth_email), '')) is null
    or nullif(pg_catalog.btrim(v_profile.nickname), '') is null
    or v_profile.birth_date is null
    or v_profile.birth_date > current_date
    or coalesce((v_profile.consents ->> 'terms')::boolean, false) is not true
    or coalesce((v_profile.consents ->> 'privacy')::boolean, false) is not true
    or v_profile.onboarded_at is null
  then
    raise check_violation using message = 'onboarding_required';
  end if;
end;
$$;

revoke all on function private.last_bell_assert_account_write_allowed(uuid)
  from public, anon, authenticated, service_role;

create function private.last_bell_guard_run_account_write()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if new.user_id is not null then
    perform private.last_bell_assert_account_write_allowed(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function private.last_bell_guard_run_account_write()
  from public, anon, authenticated, service_role;

-- Covers account-run insertion, server-recorded progression/completion, and
-- the guest -> account claim update. The service role cannot bypass these
-- state fences merely by calling a public authority RPC directly.
create trigger last_bell_runs_account_write_fence
before insert or update on private.last_bell_runs
for each row execute function private.last_bell_guard_run_account_write();

alter table private.last_bell_runs
  add column last_progressed_at timestamptz not null default pg_catalog.now();

update private.last_bell_runs
set last_progressed_at = started_at;

alter table private.last_bell_progression_rules
  add column minimum_transition_ms integer not null default 0
  check (minimum_transition_ms >= 0);

-- `minimum_elapsed_ms` remains the whole-route lower bound. These additional
-- per-stage waits are anchored to a server-observed prior milestone, so an
-- attacker cannot wait once at run start and then replay every event at once.
-- The values are the authored cumulative-milestone differences: stage 1 is
-- emitted by the initial fixed tick, while stages 2..11 preserve the 600s
-- complete-route floor. They still allow arbitrary longer exploration,
-- pauses, retries, and idempotent multi-tab replays.
update private.last_bell_progression_rules
set minimum_transition_ms = case stage
  when 1 then 0
  when 2 then 65000
  when 3 then 0
  when 4 then 185000
  when 5 then 130000
  when 6 then 45000
  when 7 then 0
  when 8 then 0
  when 9 then 35000
  when 10 then 130000
  when 11 then 10000
  else 0
end;

create or replace function public.last_bell_record_event(
  p_run_id uuid,
  p_user_id uuid,
  p_guest_token_digest text,
  p_sequence integer,
  p_operation_id uuid,
  p_event_type text,
  p_chapter_id text,
  p_zone_id text,
  p_objective_id text default null,
  p_collectible_key text default null,
  p_checkpoint_id text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_run private.last_bell_runs%rowtype;
  v_digest bytea;
  v_existing private.last_bell_run_events%rowtype;
  v_rule private.last_bell_progression_rules%rowtype;
  v_mapping private.last_bell_collectible_goods%rowtype;
  v_effective_elapsed_ms bigint;
  v_observed_at timestamptz := pg_catalog.clock_timestamp();
begin
  if p_run_id is null or p_sequence is null or p_sequence < 1 or p_operation_id is null then
    raise check_violation using message = 'invalid_run_event';
  end if;

  if p_user_id is null then
    if p_guest_token_digest is null then
      raise check_violation using message = 'invalid_guest_run_cookie';
    end if;
    v_digest := private.last_bell_digest_from_hex(p_guest_token_digest);
  end if;

  select run_record.*
    into v_run
  from private.last_bell_runs as run_record
  where run_record.id = p_run_id
  for update;

  if not found then
    raise no_data_found using message = 'run_not_found';
  end if;

  if not (
    (p_user_id is not null and v_run.user_id = p_user_id)
    or (p_user_id is null and v_run.user_id is null and v_run.guest_token_digest = v_digest)
  ) then
    raise insufficient_privilege using message = 'run_access_denied';
  end if;

  if v_run.status <> 'active' or v_run.active_until <= pg_catalog.now() then
    raise object_not_in_prerequisite_state using message = 'run_not_active';
  end if;

  select event_record.*
    into v_existing
  from private.last_bell_run_events as event_record
  where event_record.run_id = p_run_id
    and event_record.operation_id = p_operation_id;

  if found then
    if v_existing.sequence = p_sequence
      and v_existing.event_type = p_event_type
      and v_existing.chapter_id = p_chapter_id
      and v_existing.zone_id = p_zone_id
      and v_existing.objective_id is not distinct from p_objective_id
      and v_existing.collectible_key is not distinct from p_collectible_key
      and v_existing.checkpoint_id is not distinct from p_checkpoint_id
    then
      return jsonb_build_object('status', 'idempotent', 'sequence', p_sequence, 'progressStage', v_run.progress_stage);
    end if;
    raise unique_violation using message = 'run_operation_conflict';
  end if;

  if p_sequence <> v_run.last_sequence + 1 then
    raise check_violation using message = 'run_sequence_invalid';
  end if;

  if p_event_type = 'pickup' then
    if p_collectible_key is null or p_objective_id is not null or p_checkpoint_id is not null then
      raise check_violation using message = 'invalid_pickup_event';
    end if;

    select mapping.*
      into v_mapping
    from private.last_bell_collectible_goods as mapping
    where mapping.catalog_version = v_run.catalog_version
      and mapping.collectible_key = p_collectible_key
    for key share;

    if not found
      or v_mapping.chapter_id <> p_chapter_id
      or v_mapping.zone_id <> p_zone_id
    then
      raise check_violation using message = 'invalid_collectible_pickup';
    end if;

    if (p_chapter_id = 'chapter-01' and v_run.progress_stage not between 1 and 5)
      or (p_chapter_id = 'chapter-02' and v_run.progress_stage not between 7 and 8)
    then
      raise check_violation using message = 'pickup_not_reachable';
    end if;

    if exists (
      select 1
      from private.last_bell_run_collectibles as picked
      where picked.run_id = p_run_id and picked.collectible_key = p_collectible_key
    ) then
      raise unique_violation using message = 'duplicate_pickup';
    end if;

    insert into private.last_bell_run_collectibles (
      run_id, collectible_key, catalog_version, good_id, chapter_id, zone_id, sale_ends_at
    )
    values (
      p_run_id, p_collectible_key, v_run.catalog_version, v_mapping.good_id,
      v_mapping.chapter_id, v_mapping.zone_id, v_mapping.sale_ends_at
    );
  elsif p_event_type = 'capture' then
    if p_objective_id is not null or p_collectible_key is not null or p_checkpoint_id is not null
      or not (
        (p_chapter_id = 'chapter-01' and p_zone_id in ('classroom', 'corridor', 'infirmary', 'broadcast', 'utility', 'stairwell'))
        or (p_chapter_id = 'chapter-02' and p_zone_id in ('stairwell', 'rooftop'))
      )
    then
      raise check_violation using message = 'invalid_capture_event';
    end if;
  else
    select rule.*
      into v_rule
    from private.last_bell_progression_rules as rule
    where rule.stage = v_run.progress_stage + 1
    for key share;

    if not found
      or v_rule.event_type <> p_event_type
      or v_rule.chapter_id <> p_chapter_id
      or v_rule.zone_id <> p_zone_id
      or v_rule.objective_id is distinct from p_objective_id
      or v_rule.checkpoint_id is distinct from p_checkpoint_id
      or p_collectible_key is not null
    then
      raise check_violation using message = 'run_progression_invalid';
    end if;

    v_effective_elapsed_ms := v_run.timeline_offset_ms
      + pg_catalog.floor(extract(epoch from (v_observed_at - v_run.started_at)) * 1000)::bigint;
    if v_effective_elapsed_ms < v_rule.minimum_elapsed_ms
      or v_observed_at < v_run.last_progressed_at + v_rule.minimum_transition_ms * interval '1 millisecond'
    then
      raise check_violation using message = 'run_progression_too_fast';
    end if;

    update private.last_bell_runs
    set progress_stage = v_rule.stage, last_progressed_at = v_observed_at
    where id = p_run_id;

    v_run.progress_stage := v_rule.stage;
    v_run.last_progressed_at := v_observed_at;

    if p_event_type = 'chapter_complete' then
      perform private.last_bell_vest_chapter_collectibles(p_run_id, p_chapter_id);
      -- First-play Chapter 1 grants stay private until the verified ending.
      -- A replay chapter exit vests only that chapter's verified pickups.
      if v_run.run_mode = 'chapter-replay'
        and v_run.start_chapter_id = p_chapter_id
      then
        if v_run.user_id is not null then
          perform private.last_bell_materialize_entitlements(p_run_id, v_run.user_id);
        end if;
        if v_run.start_chapter_id = 'chapter-01' then
          update private.last_bell_runs
          set
            status = 'completed',
            completed_at = pg_catalog.now(),
            claim_until = pg_catalog.now() + interval '7 days'
          where id = p_run_id;
        end if;
      end if;
    end if;
  end if;

  insert into private.last_bell_run_events (
    run_id, sequence, operation_id, event_type, chapter_id, zone_id,
    objective_id, collectible_key, checkpoint_id
  )
  values (
    p_run_id, p_sequence, p_operation_id, p_event_type, p_chapter_id, p_zone_id,
    p_objective_id, p_collectible_key, p_checkpoint_id
  );

  update private.last_bell_runs
  set last_sequence = p_sequence
  where id = p_run_id;

  return jsonb_build_object('status', 'recorded', 'sequence', p_sequence, 'progressStage', v_run.progress_stage);
end;
$$;

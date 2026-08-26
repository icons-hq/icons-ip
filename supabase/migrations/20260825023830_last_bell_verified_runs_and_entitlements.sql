-- ============================================================================
-- Last Bell verified story runs and story-goods purchase eligibility.
--
-- The local `/games/prototype-last-bell` stays outside this ledger. Only the
-- server route handlers may call the service-role RPCs below. A collectible
-- never carries a client-supplied `good_id`: the run pins a catalog version,
-- and the database resolves every collectible to a good from that version.
-- ============================================================================

alter table public.goods
  add column purchase_access text not null default 'public'
  check (purchase_access in ('public', 'story_entitlement'));

comment on column public.goods.purchase_access is
  'public은 일반 구매 가능, story_entitlement는 검증된 Last Bell 구매권이 있어야 한다.';

-- ---------------------------------------------------------------------------
-- Private verified-run ledger
-- ---------------------------------------------------------------------------

create table private.last_bell_catalog_versions (
  version text primary key,
  active_from timestamptz not null,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  constraint last_bell_catalog_versions_version_valid
    check (pg_catalog.btrim(version) = version and pg_catalog.char_length(version) between 1 and 80),
  constraint last_bell_catalog_versions_window_valid
    check (retired_at is null or retired_at > active_from)
);

create index last_bell_catalog_versions_active_idx
  on private.last_bell_catalog_versions (active_from desc)
  where retired_at is null;

create table private.last_bell_collectible_goods (
  catalog_version text not null references private.last_bell_catalog_versions (version) on delete restrict,
  collectible_key text not null,
  good_id text not null references public.goods (id) on delete restrict,
  chapter_id text not null check (chapter_id in ('chapter-01', 'chapter-02')),
  zone_id text not null check (zone_id in ('classroom', 'corridor', 'infirmary', 'broadcast', 'utility', 'stairwell')),
  sale_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (catalog_version, collectible_key),
  unique (catalog_version, good_id),
  constraint last_bell_collectible_key_valid check (collectible_key in (
    'idcard', 'badge', 'photo', 'radio', 'kit', 'zipup', 'archery', 'postcard', 'candle', 'blanket'
  ))
);

create index last_bell_collectible_goods_lookup_idx
  on private.last_bell_collectible_goods (catalog_version, chapter_id, zone_id);

create table private.last_bell_runs (
  id uuid primary key default extensions.gen_random_uuid(),
  -- A guest run has only a SHA-256 digest. The raw opaque token is never stored
  -- here (it lives only in an HttpOnly cookie).
  guest_token_digest bytea,
  -- user_id is NULL until a guest completes and claims. A claimed guest keeps
  -- its digest for auditability, but only the bound account may resume it.
  user_id uuid references public.profiles (id) on delete restrict,
  catalog_version text not null references private.last_bell_catalog_versions (version) on delete restrict,
  start_chapter_id text not null check (start_chapter_id in ('chapter-01', 'chapter-02')),
  run_mode text not null check (run_mode in ('first-play', 'chapter-replay')),
  timeline_offset_ms integer not null default 0 check (timeline_offset_ms in (0, 425000)),
  progress_stage integer not null default 0 check (progress_stage between 0 and 11),
  last_sequence integer not null default 0 check (last_sequence >= 0),
  status text not null default 'active' check (status in ('active', 'completed', 'expired')),
  started_at timestamptz not null default now(),
  active_until timestamptz not null,
  completed_at timestamptz,
  claim_until timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint last_bell_runs_identity_valid
    check (user_id is not null or guest_token_digest is not null),
  constraint last_bell_runs_guest_digest_valid
    check (guest_token_digest is null or pg_catalog.octet_length(guest_token_digest) = 32),
  constraint last_bell_runs_completion_valid
    check (
      (status = 'completed' and completed_at is not null and claim_until is not null)
      or (status <> 'completed' and completed_at is null and claim_until is null)
    ),
  constraint last_bell_runs_claim_valid
    check (claimed_at is null or (user_id is not null and status = 'completed'))
);

create trigger last_bell_runs_updated
before update on private.last_bell_runs
for each row execute function public.set_updated_at();

-- An authenticated account and a guest cookie each resume one active run.
create unique index last_bell_active_user_run_uidx
  on private.last_bell_runs (user_id)
  where status = 'active' and user_id is not null;
create unique index last_bell_active_guest_run_uidx
  on private.last_bell_runs (guest_token_digest)
  where status = 'active' and guest_token_digest is not null and user_id is null;
create index last_bell_runs_claim_idx
  on private.last_bell_runs (claim_until)
  where status = 'completed' and user_id is null;

create table private.last_bell_run_events (
  run_id uuid not null references private.last_bell_runs (id) on delete cascade,
  sequence integer not null check (sequence > 0),
  operation_id uuid not null,
  event_type text not null check (event_type in (
    'objective', 'pickup', 'checkpoint', 'capture', 'chapter_complete', 'game_complete'
  )),
  chapter_id text not null check (chapter_id in ('chapter-01', 'chapter-02')),
  zone_id text not null check (zone_id in ('classroom', 'corridor', 'infirmary', 'broadcast', 'utility', 'stairwell', 'rooftop')),
  objective_id text,
  collectible_key text,
  checkpoint_id text,
  created_at timestamptz not null default now(),
  primary key (run_id, sequence),
  unique (run_id, operation_id)
);

create index last_bell_run_events_type_idx
  on private.last_bell_run_events (run_id, event_type, created_at);

create table private.last_bell_run_collectibles (
  run_id uuid not null references private.last_bell_runs (id) on delete cascade,
  collectible_key text not null,
  catalog_version text not null,
  good_id text not null references public.goods (id) on delete restrict,
  chapter_id text not null check (chapter_id in ('chapter-01', 'chapter-02')),
  zone_id text not null check (zone_id in ('classroom', 'corridor', 'infirmary', 'broadcast', 'utility', 'stairwell')),
  sale_ends_at timestamptz not null,
  picked_at timestamptz not null default now(),
  primary key (run_id, collectible_key),
  unique (run_id, good_id),
  foreign key (catalog_version, collectible_key)
    references private.last_bell_collectible_goods (catalog_version, collectible_key)
    on delete restrict
);

create table private.last_bell_run_good_grants (
  run_id uuid not null references private.last_bell_runs (id) on delete cascade,
  good_id text not null references public.goods (id) on delete restrict,
  collectible_key text not null,
  catalog_version text not null,
  chapter_id text not null check (chapter_id in ('chapter-01', 'chapter-02')),
  sale_ends_at timestamptz not null,
  vested_at timestamptz not null default now(),
  primary key (run_id, good_id),
  unique (run_id, collectible_key)
);

-- ---------------------------------------------------------------------------
-- Public, user-readable eligibility ledger and immutable order evidence
-- ---------------------------------------------------------------------------

create table public.goods_purchase_entitlements (
  id uuid primary key default extensions.gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete restrict,
  good_id text not null references public.goods (id) on delete restrict,
  source text not null default 'last_bell' check (source = 'last_bell'),
  source_run_id uuid not null references private.last_bell_runs (id) on delete restrict,
  catalog_version text not null references private.last_bell_catalog_versions (version) on delete restrict,
  valid_until timestamptz not null,
  granted_at timestamptz not null default now(),
  unique (user_id, good_id)
);

create index goods_purchase_entitlements_inventory_idx
  on public.goods_purchase_entitlements (user_id, valid_until desc, granted_at desc);

alter table public.goods_purchase_entitlements enable row level security;

create policy goods_purchase_entitlements_owner_read
on public.goods_purchase_entitlements
for select
to authenticated
using ((select auth.uid()) = user_id);

create table private.order_goods_purchase_entitlement_snapshots (
  order_id uuid not null references public.orders (id) on delete restrict,
  good_id text not null references public.goods (id) on delete restrict,
  entitlement_id uuid not null references public.goods_purchase_entitlements (id) on delete restrict,
  catalog_version text not null references private.last_bell_catalog_versions (version) on delete restrict,
  valid_until timestamptz not null,
  captured_at timestamptz not null default now(),
  primary key (order_id, good_id)
);

-- ---------------------------------------------------------------------------
-- Internal helpers. They are security-definer only because they are invoked
-- by triggers and service-role RPCs; none is exposed through the Data API.
-- ---------------------------------------------------------------------------

create function private.last_bell_digest_from_hex(p_digest text)
returns bytea
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
begin
  if p_digest !~ '^[0-9a-f]{64}$' then
    raise check_violation using message = 'invalid_guest_run_cookie';
  end if;
  return pg_catalog.decode(p_digest, 'hex');
end;
$$;

create function private.last_bell_user_can_purchase_good(
  p_user_id uuid,
  p_good_id text,
  p_at timestamptz default pg_catalog.now()
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when good.purchase_access = 'public' then true
    when p_user_id is null then false
    else exists (
      select 1
      from public.goods_purchase_entitlements as entitlement
      where entitlement.user_id = p_user_id
        and entitlement.good_id = p_good_id
        and entitlement.valid_until > p_at
    )
  end
  from public.goods as good
  where good.id = p_good_id
$$;

create function private.last_bell_guard_cart_item_purchase_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null or v_user_id is distinct from new.user_id then
    raise insufficient_privilege using message = 'cart owner required';
  end if;

  if not coalesce(private.last_bell_user_can_purchase_good(v_user_id, new.good_id, pg_catalog.now()), false) then
    raise check_violation using message = 'story_entitlement_required';
  end if;

  return new;
end;
$$;

create trigger last_bell_cart_item_purchase_access
before insert or update of user_id, good_id, qty on public.cart_items
for each row execute function private.last_bell_guard_cart_item_purchase_access();

create function private.last_bell_guard_order_item_purchase_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
begin
  select order_record.user_id
    into v_user_id
  from public.orders as order_record
  where order_record.id = new.order_id;

  if v_user_id is null then
    raise foreign_key_violation using message = 'order_not_found';
  end if;

  if not coalesce(private.last_bell_user_can_purchase_good(v_user_id, new.good_id, pg_catalog.now()), false) then
    raise check_violation using message = 'story_entitlement_required';
  end if;

  return new;
end;
$$;

create trigger last_bell_order_item_purchase_access
before insert or update of order_id, good_id on public.order_items
for each row execute function private.last_bell_guard_order_item_purchase_access();

create function private.last_bell_snapshot_order_item_entitlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_entitlement public.goods_purchase_entitlements%rowtype;
  v_purchase_access text;
begin
  select order_record.user_id, good.purchase_access
    into v_user_id, v_purchase_access
  from public.orders as order_record
  join public.goods as good on good.id = new.good_id
  where order_record.id = new.order_id;

  if v_purchase_access <> 'story_entitlement' then
    return new;
  end if;

  select entitlement.*
    into v_entitlement
  from public.goods_purchase_entitlements as entitlement
  where entitlement.user_id = v_user_id
    and entitlement.good_id = new.good_id
    and entitlement.valid_until > pg_catalog.now()
  for key share;

  if not found then
    raise check_violation using message = 'story_entitlement_required';
  end if;

  insert into private.order_goods_purchase_entitlement_snapshots (
    order_id, good_id, entitlement_id, catalog_version, valid_until
  )
  values (
    new.order_id, new.good_id, v_entitlement.id, v_entitlement.catalog_version, v_entitlement.valid_until
  )
  on conflict (order_id, good_id) do nothing;

  return new;
end;
$$;

create trigger last_bell_order_item_entitlement_snapshot
after insert on public.order_items
for each row execute function private.last_bell_snapshot_order_item_entitlement();

create function private.last_bell_materialize_entitlements(
  p_run_id uuid,
  p_user_id uuid
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  if p_user_id is null then
    return 0;
  end if;

  insert into public.goods_purchase_entitlements (
    user_id, good_id, source_run_id, catalog_version, valid_until
  )
  select
    p_user_id,
    grant_record.good_id,
    p_run_id,
    grant_record.catalog_version,
    grant_record.sale_ends_at
  from private.last_bell_run_good_grants as grant_record
  where grant_record.run_id = p_run_id
  on conflict (user_id, good_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create function private.last_bell_vest_chapter_collectibles(
  p_run_id uuid,
  p_chapter_id text
)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer := 0;
begin
  insert into private.last_bell_run_good_grants (
    run_id, good_id, collectible_key, catalog_version, chapter_id, sale_ends_at
  )
  select
    collectible.run_id,
    collectible.good_id,
    collectible.collectible_key,
    collectible.catalog_version,
    collectible.chapter_id,
    collectible.sale_ends_at
  from private.last_bell_run_collectibles as collectible
  where collectible.run_id = p_run_id
    and collectible.chapter_id = p_chapter_id
  on conflict (run_id, good_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

-- The milestone table makes the fixed route inspectable and testable. Pickup
-- and capture events are intentionally interleaved and do not consume a stage.
create table private.last_bell_progression_rules (
  stage integer primary key check (stage between 1 and 11),
  event_type text not null check (event_type in ('objective', 'checkpoint', 'chapter_complete', 'game_complete')),
  objective_id text,
  checkpoint_id text,
  chapter_id text not null check (chapter_id in ('chapter-01', 'chapter-02')),
  zone_id text not null check (zone_id in ('classroom', 'corridor', 'utility', 'stairwell', 'rooftop')),
  minimum_elapsed_ms integer not null check (minimum_elapsed_ms >= 0),
  constraint last_bell_progression_rules_event_shape check (
    (event_type = 'objective' and objective_id is not null and checkpoint_id is null)
    or (event_type = 'checkpoint' and checkpoint_id is not null and objective_id is null)
    or (event_type in ('chapter_complete', 'game_complete') and objective_id is null and checkpoint_id is null)
  )
);

insert into private.last_bell_progression_rules (
  stage, event_type, objective_id, checkpoint_id, chapter_id, zone_id, minimum_elapsed_ms
)
values
  (1, 'objective', 'ch1.open-classroom-door', null, 'chapter-01', 'classroom', 0),
  (2, 'checkpoint', null, 'ch1_first_bay', 'chapter-01', 'corridor', 65000),
  (3, 'objective', 'ch1.restore-emergency-power', null, 'chapter-01', 'corridor', 65000),
  (4, 'checkpoint', null, 'ch1_power', 'chapter-01', 'utility', 250000),
  (5, 'objective', 'ch1.ring-last-bell', null, 'chapter-01', 'stairwell', 380000),
  (6, 'chapter_complete', null, null, 'chapter-01', 'stairwell', 425000),
  (7, 'objective', 'ch2.search-stairwell', null, 'chapter-02', 'stairwell', 425000),
  (8, 'checkpoint', null, 'ch2_stairwell', 'chapter-02', 'stairwell', 425000),
  (9, 'objective', 'ch2.approach-namra', null, 'chapter-02', 'rooftop', 460000),
  (10, 'chapter_complete', null, null, 'chapter-02', 'rooftop', 590000),
  (11, 'game_complete', null, null, 'chapter-02', 'rooftop', 600000);

-- ---------------------------------------------------------------------------
-- Service-only RPCs
-- ---------------------------------------------------------------------------

create function public.last_bell_start_run(
  p_user_id uuid,
  p_guest_token_digest text,
  p_start_chapter_id text default 'chapter-01',
  p_run_mode text default 'first-play'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_catalog_version text;
  v_digest bytea;
  v_run private.last_bell_runs%rowtype;
  v_initial_stage integer;
  v_offset_ms integer;
  v_has_completed_first_play boolean := false;
begin
  if p_start_chapter_id not in ('chapter-01', 'chapter-02') then
    raise check_violation using message = 'invalid_start_chapter';
  end if;
  if p_run_mode not in ('first-play', 'chapter-replay') then
    raise check_violation using message = 'invalid_run_mode';
  end if;
  if p_start_chapter_id = 'chapter-02' and p_run_mode <> 'chapter-replay' then
    raise check_violation using message = 'chapter_replay_required';
  end if;

  if p_user_id is null then
    if p_guest_token_digest is null then
      raise check_violation using message = 'invalid_guest_run_cookie';
    end if;
    v_digest := private.last_bell_digest_from_hex(p_guest_token_digest);
  elsif p_guest_token_digest is not null then
    raise check_violation using message = 'authenticated_run_cannot_use_guest_cookie';
  end if;

  -- Serialize repeated Start clicks and multi-tab starts before the partial
  -- unique indexes are consulted.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      coalesce(p_user_id::text, pg_catalog.encode(v_digest, 'hex')),
      0
    )
  );

  update private.last_bell_runs
  set status = 'expired'
  where status = 'active'
    and active_until <= pg_catalog.now()
    and (
      (p_user_id is not null and user_id = p_user_id)
      or (p_user_id is null and user_id is null and guest_token_digest = v_digest)
    );

  select run_record.*
    into v_run
  from private.last_bell_runs as run_record
  where run_record.status = 'active'
    and run_record.active_until > pg_catalog.now()
    and (
      (p_user_id is not null and run_record.user_id = p_user_id)
      or (p_user_id is null and run_record.user_id is null and run_record.guest_token_digest = v_digest)
    )
  order by run_record.started_at desc
  limit 1
  for update;

  if found then
    return jsonb_build_object(
      'runId', v_run.id,
      'catalogVersion', v_run.catalog_version,
      'startChapterId', v_run.start_chapter_id,
      'runMode', v_run.run_mode,
      'resumed', true,
      'activeUntil', v_run.active_until,
      'lastSequence', v_run.last_sequence,
      'progressStage', v_run.progress_stage,
      'pickedCollectibleKeys', coalesce((
        select jsonb_agg(picked.collectible_key order by picked.picked_at, picked.collectible_key)
        from private.last_bell_run_collectibles as picked
        where picked.run_id = v_run.id
      ), '[]'::jsonb)
    );
  end if;

  if p_run_mode = 'chapter-replay' then
    if p_user_id is not null then
      select exists (
        select 1
        from private.last_bell_runs as completed_run
        where completed_run.user_id = p_user_id
          and completed_run.status = 'completed'
          and completed_run.start_chapter_id = 'chapter-01'
          and completed_run.run_mode = 'first-play'
      )
        into v_has_completed_first_play;
    else
      select exists (
        select 1
        from private.last_bell_runs as completed_run
        where completed_run.user_id is null
          and completed_run.guest_token_digest = v_digest
          and completed_run.status = 'completed'
          and completed_run.claim_until > pg_catalog.now()
          and completed_run.start_chapter_id = 'chapter-01'
          and completed_run.run_mode = 'first-play'
      )
        into v_has_completed_first_play;
    end if;
    if not v_has_completed_first_play then
      raise object_not_in_prerequisite_state using message = 'chapter_replay_locked';
    end if;
  end if;

  select version_record.version
    into v_catalog_version
  from private.last_bell_catalog_versions as version_record
  where version_record.active_from <= pg_catalog.now()
    and (version_record.retired_at is null or version_record.retired_at > pg_catalog.now())
  order by version_record.active_from desc
  limit 1
  for share;

  if v_catalog_version is null
    or not (
      select count(*) = 10
        and count(distinct mapping.collectible_key) = 10
        and bool_and(mapping.sale_ends_at > pg_catalog.now())
        and bool_and(good.archived_at is null and good.purchase_access = 'story_entitlement')
      from private.last_bell_collectible_goods as mapping
      join public.goods as good on good.id = mapping.good_id
      where mapping.catalog_version = v_catalog_version
    )
  then
    raise object_not_in_prerequisite_state using message = 'last_bell_catalog_unavailable';
  end if;

  v_initial_stage := case when p_start_chapter_id = 'chapter-02' then 6 else 0 end;
  v_offset_ms := case when p_start_chapter_id = 'chapter-02' then 425000 else 0 end;

  insert into private.last_bell_runs (
    guest_token_digest, user_id, catalog_version, start_chapter_id, run_mode,
    timeline_offset_ms, progress_stage, active_until
  )
  values (
    v_digest, p_user_id, v_catalog_version, p_start_chapter_id, p_run_mode,
    v_offset_ms, v_initial_stage, pg_catalog.now() + interval '24 hours'
  )
  returning * into v_run;

  return jsonb_build_object(
    'runId', v_run.id,
    'catalogVersion', v_run.catalog_version,
    'startChapterId', v_run.start_chapter_id,
    'runMode', v_run.run_mode,
    'resumed', false,
    'activeUntil', v_run.active_until,
    'lastSequence', v_run.last_sequence,
    'progressStage', v_run.progress_stage,
    'pickedCollectibleKeys', '[]'::jsonb
  );
end;
$$;

create function public.last_bell_record_event(
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
      + pg_catalog.floor(extract(epoch from (pg_catalog.clock_timestamp() - v_run.started_at)) * 1000)::bigint;
    if v_effective_elapsed_ms < v_rule.minimum_elapsed_ms then
      raise check_violation using message = 'run_progression_too_fast';
    end if;

    update private.last_bell_runs
    set progress_stage = v_rule.stage
    where id = p_run_id;

    v_run.progress_stage := v_rule.stage;

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

create function public.last_bell_complete_run(
  p_run_id uuid,
  p_user_id uuid,
  p_guest_token_digest text
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
begin
  if p_run_id is null then
    raise check_violation using message = 'invalid_run';
  end if;
  if p_user_id is null then
    if p_guest_token_digest is null then
      raise check_violation using message = 'invalid_guest_run_cookie';
    end if;
    v_digest := private.last_bell_digest_from_hex(p_guest_token_digest);
  end if;

  select run_record.* into v_run
  from private.last_bell_runs as run_record
  where run_record.id = p_run_id
  for update;

  if not found then raise no_data_found using message = 'run_not_found'; end if;
  if not (
    (p_user_id is not null and v_run.user_id = p_user_id)
    or (p_user_id is null and v_run.user_id is null and v_run.guest_token_digest = v_digest)
  ) then
    raise insufficient_privilege using message = 'run_access_denied';
  end if;

  if v_run.status = 'completed' then
    return jsonb_build_object('status', 'idempotent', 'claimUntil', v_run.claim_until);
  end if;
  if v_run.status <> 'active' or v_run.active_until <= pg_catalog.now() then
    raise object_not_in_prerequisite_state using message = 'run_not_active';
  end if;
  if v_run.progress_stage <> (
    case
      when v_run.run_mode = 'chapter-replay' and v_run.start_chapter_id = 'chapter-01' then 6
      else 11
    end
  ) then
    raise check_violation using message = 'run_not_finished';
  end if;

  update private.last_bell_runs
  set
    status = 'completed',
    completed_at = pg_catalog.now(),
    claim_until = pg_catalog.now() + interval '7 days'
  where id = p_run_id
  returning * into v_run;

  if v_run.user_id is not null then
    perform private.last_bell_materialize_entitlements(p_run_id, v_run.user_id);
  end if;

  return jsonb_build_object('status', 'completed', 'claimUntil', v_run.claim_until);
end;
$$;

create function public.last_bell_claim_run(
  p_run_id uuid,
  p_user_id uuid,
  p_guest_token_digest text
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
  v_granted integer := 0;
begin
  if p_run_id is null or p_user_id is null then
    raise check_violation using message = 'invalid_claim';
  end if;
  if p_guest_token_digest is null then
    raise check_violation using message = 'invalid_guest_run_cookie';
  end if;
  v_digest := private.last_bell_digest_from_hex(p_guest_token_digest);

  select run_record.* into v_run
  from private.last_bell_runs as run_record
  where run_record.id = p_run_id
  for update;

  if not found then raise no_data_found using message = 'run_not_found'; end if;
  if v_run.guest_token_digest is distinct from v_digest then
    raise insufficient_privilege using message = 'run_access_denied';
  end if;
  if v_run.status <> 'completed' or v_run.claim_until <= pg_catalog.now() then
    raise object_not_in_prerequisite_state using message = 'claim_not_available';
  end if;

  if v_run.user_id is not null then
    if v_run.user_id <> p_user_id then
      raise insufficient_privilege using message = 'run_claimed_by_another_user';
    end if;
    return jsonb_build_object('status', 'idempotent', 'granted', 0);
  end if;

  update private.last_bell_runs
  set user_id = p_user_id, claimed_at = pg_catalog.now()
  where id = p_run_id;

  v_granted := private.last_bell_materialize_entitlements(p_run_id, p_user_id);
  return jsonb_build_object('status', 'claimed', 'granted', v_granted);
end;
$$;

create function public.last_bell_list_inventory(p_user_id uuid)
returns table (
  collectible_key text,
  good_id text,
  valid_until timestamptz,
  is_purchasable boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    grant_record.collectible_key,
    entitlement.good_id,
    entitlement.valid_until,
    entitlement.valid_until > pg_catalog.now() as is_purchasable
  from public.goods_purchase_entitlements as entitlement
  join private.last_bell_run_good_grants as grant_record
    on grant_record.run_id = entitlement.source_run_id
   and grant_record.good_id = entitlement.good_id
  where entitlement.user_id = p_user_id
  order by entitlement.granted_at desc, entitlement.good_id
$$;

-- ---------------------------------------------------------------------------
-- Privileges and RLS: every run/action RPC is service-role only. New private
-- relations have no API grants; the one public ledger is self-read only.
-- ---------------------------------------------------------------------------

alter table private.last_bell_catalog_versions enable row level security;
alter table private.last_bell_collectible_goods enable row level security;
alter table private.last_bell_runs enable row level security;
alter table private.last_bell_run_events enable row level security;
alter table private.last_bell_run_collectibles enable row level security;
alter table private.last_bell_run_good_grants enable row level security;
alter table private.order_goods_purchase_entitlement_snapshots enable row level security;
alter table private.last_bell_progression_rules enable row level security;

revoke all on table private.last_bell_catalog_versions,
  private.last_bell_collectible_goods,
  private.last_bell_runs,
  private.last_bell_run_events,
  private.last_bell_run_collectibles,
  private.last_bell_run_good_grants,
  private.order_goods_purchase_entitlement_snapshots,
  private.last_bell_progression_rules
from public, anon, authenticated, service_role;

revoke all on table public.goods_purchase_entitlements
  from public, anon, authenticated, service_role;
grant select on table public.goods_purchase_entitlements to authenticated;

revoke all on function private.last_bell_digest_from_hex(text),
  private.last_bell_user_can_purchase_good(uuid, text, timestamptz),
  private.last_bell_guard_cart_item_purchase_access(),
  private.last_bell_guard_order_item_purchase_access(),
  private.last_bell_snapshot_order_item_entitlement(),
  private.last_bell_materialize_entitlements(uuid, uuid),
  private.last_bell_vest_chapter_collectibles(uuid, text)
from public, anon, authenticated, service_role;

revoke all on function public.last_bell_start_run(uuid, text, text, text),
  public.last_bell_record_event(uuid, uuid, text, integer, uuid, text, text, text, text, text, text),
  public.last_bell_complete_run(uuid, uuid, text),
  public.last_bell_claim_run(uuid, uuid, text),
  public.last_bell_list_inventory(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.last_bell_start_run(uuid, text, text, text),
  public.last_bell_record_event(uuid, uuid, text, integer, uuid, text, text, text, text, text, text),
  public.last_bell_complete_run(uuid, uuid, text),
  public.last_bell_claim_run(uuid, uuid, text),
  public.last_bell_list_inventory(uuid)
to service_role;

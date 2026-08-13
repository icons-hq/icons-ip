-- #191: PII-free durable email intent/fence, provider event reducer and
-- default-off activation seam. Existing SMTP and legacy order mail remain
-- untouched until the Production Hook canary proves direct SMTP traffic is 0.

create table private.email_dispatch_control (
  singleton boolean primary key default true,
  enabled boolean not null default false,
  hook_contract_ready boolean not null default false,
  provider_credentials_ready boolean not null default false,
  webhook_contract_ready boolean not null default false,
  privacy_retention_ready boolean not null default false,
  account_deletion_notice_ready boolean not null default false,
  changed_at timestamptz not null default pg_catalog.now(),
  constraint email_dispatch_control_singleton_check check (singleton),
  constraint email_dispatch_control_activation_check check (
    not enabled
    or (
      hook_contract_ready
      and provider_credentials_ready
      and webhook_contract_ready
      and privacy_retention_ready
      and account_deletion_notice_ready
    )
  )
);

insert into private.email_dispatch_control (singleton) values (true);

create table private.email_intents (
  id uuid primary key default extensions.gen_random_uuid(),
  source text not null check (source in ('auth_hook', 'account_deletion')),
  source_reference_digest bytea not null check (
    pg_catalog.octet_length(source_reference_digest) = 32
  ),
  recipient_digest bytea not null check (
    pg_catalog.octet_length(recipient_digest) = 32
  ),
  message_kind text not null check (
    message_kind in (
      'auth_signup',
      'auth_recovery',
      'auth_email_change_current',
      'auth_email_change_new',
      'auth_reauthentication',
      'account_deletion_notice'
    )
  ),
  content_revision text not null check (
    char_length(content_revision) between 1 and 80
    and content_revision ~ '^[a-z0-9_]+$'
  ),
  idempotency_key text generated always as ('email/' || id::text) stored,
  state text not null default 'queued' check (
    state in (
      'queued', 'dispatching', 'accepted', 'unknown', 'needs_review',
      'sent', 'delivered', 'delayed', 'bounced', 'complained',
      'suppressed', 'failed'
    )
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  provider_reference_digest bytea check (
    provider_reference_digest is null
    or pg_catalog.octet_length(provider_reference_digest) = 32
  ),
  state_occurred_at timestamptz,
  claimed_at timestamptz,
  first_dispatched_at timestamptz,
  idempotency_expires_at timestamptz,
  accepted_at timestamptz,
  delivered_at timestamptz,
  terminal_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  unique (source, source_reference_digest),
  unique (provider_reference_digest),
  unique (idempotency_key),
  constraint email_intents_timestamp_order_check check (
    updated_at >= created_at
    and (claimed_at is null or claimed_at >= created_at)
    and (first_dispatched_at is null or first_dispatched_at >= created_at)
    and (first_dispatched_at is null) = (idempotency_expires_at is null)
    and (
      first_dispatched_at is null
      or idempotency_expires_at = first_dispatched_at + interval '24 hours'
    )
    and (accepted_at is null or accepted_at >= created_at)
  )
);

-- The fence is an explicit durable acknowledgement that enqueue finished. It
-- prevents Hook success from racing ahead of the intent commit and lets #137
-- reference a minimal notification fact without exposing recipient/content.
create table private.email_intent_fences (
  intent_id uuid primary key references private.email_intents(id) on delete restrict,
  source text not null check (source in ('auth_hook', 'account_deletion')),
  source_reference_digest bytea not null check (
    pg_catalog.octet_length(source_reference_digest) = 32
  ),
  created_at timestamptz not null default pg_catalog.now(),
  unique (source, source_reference_digest)
);

create table private.email_provider_events (
  svix_id text primary key check (
    char_length(svix_id) between 1 and 200
    and svix_id ~ '^[A-Za-z0-9._:-]+$'
  ),
  intent_id uuid references private.email_intents(id) on delete restrict,
  provider_reference_digest bytea not null check (
    pg_catalog.octet_length(provider_reference_digest) = 32
  ),
  event_type text not null check (
    event_type in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'suppressed', 'failed')
  ),
  occurred_at timestamptz not null,
  received_at timestamptz not null default pg_catalog.now(),
  constraint email_provider_event_time_check check (
    occurred_at <= received_at + interval '5 minutes'
  )
);

create index email_intents_operational_idx
  on private.email_intents (state, updated_at desc);
create index email_provider_events_intent_idx
  on private.email_provider_events (intent_id, occurred_at, svix_id);

-- Existing plaintext rows are no longer authoritative delivery evidence.
-- Keep the data in place for the approved retention decision, prevent future
-- writes, and expose only an explicit classification to controlled operators.
alter table public.email_deliveries
  add column evidence_class text not null default 'legacy_unverified'
    check (evidence_class = 'legacy_unverified'),
  add column retention_disposition text not null default 'pending_policy'
    check (retention_disposition in ('pending_policy', 'migrated', 'destroyed')),
  add column destroyed_at timestamptz;

create function private.redact_legacy_email_delivery_write()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- The transient recipient/subject still reach the provider from application
    -- memory, but a new legacy row never receives a plaintext copy.
    new.recipient := 'redacted@invalid.local';
    new.subject := 'legacy_' || new.template;
    new.last_error := case when new.last_error is null then null else 'legacy_failure' end;
  elsif new.retention_disposition = 'destroyed'
    and old.retention_disposition = 'pending_policy'
    and new.destroyed_at is not null
  then
    -- The readiness-guarded retention hook is the only transition that may
    -- destroy pre-migration evidence.
    new.recipient := 'redacted@invalid.local';
    new.subject := 'legacy_' || new.template;
    new.last_error := case when old.last_error is null then null else 'legacy_failure' end;
  else
    -- Retry/completion remains operational while preserving the approved
    -- retention scope. It cannot replace old plaintext or introduce a new raw
    -- provider error after this migration.
    new.recipient := old.recipient;
    new.subject := old.subject;
    new.last_error := case
      when old.last_error is not null then old.last_error
      when new.last_error is null then null
      else 'legacy_failure'
    end;
  end if;
  new.evidence_class := 'legacy_unverified';
  return new;
end;
$$;

create trigger redact_legacy_email_delivery_write
before insert or update of recipient, subject, last_error
on public.email_deliveries
for each row execute function private.redact_legacy_email_delivery_write();

create function private.destroy_legacy_email_delivery_plaintext(p_before timestamptz)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_before is null or p_before > pg_catalog.now() then
    raise check_violation using message = 'invalid_email_retention_cutoff';
  end if;
  if not exists (
    select 1 from private.email_dispatch_control as control
    where control.singleton and control.privacy_retention_ready
  ) then
    raise object_not_in_prerequisite_state using message = 'email_retention_policy_not_ready';
  end if;
  update public.email_deliveries set
    recipient = 'redacted@invalid.local',
    subject = 'legacy_' || template,
    last_error = case when last_error is null then null else 'legacy_failure' end,
    retention_disposition = 'destroyed',
    destroyed_at = coalesce(destroyed_at, pg_catalog.now())
  where created_at < p_before
    and retention_disposition = 'pending_policy';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function private.destroy_email_dispatch_evidence(p_before timestamptz)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  v_intent_ids uuid[] := '{}'::uuid[];
  v_event_count integer := 0;
  v_fence_count integer := 0;
  v_intent_count integer := 0;
begin
  if p_before is null or p_before > pg_catalog.now() - interval '24 hours' then
    raise check_violation using message = 'invalid_email_retention_cutoff';
  end if;
  if not exists (
    select 1 from private.email_dispatch_control as control
    where control.singleton and control.privacy_retention_ready
  ) then
    raise object_not_in_prerequisite_state using message = 'email_retention_policy_not_ready';
  end if;

  select coalesce(pg_catalog.array_agg(intent.id), '{}'::uuid[])
    into v_intent_ids
  from private.email_intents as intent
  where intent.updated_at < p_before
    and intent.state in ('delivered', 'bounced', 'complained', 'suppressed', 'failed')
    -- #137 owns the legal lifetime of deletion notices. This generic retention
    -- hook cannot destroy them before that worker has a dedicated policy.
    and intent.source <> 'account_deletion';

  delete from private.email_provider_events as event
  where (event.intent_id = any(v_intent_ids))
    or (event.intent_id is null and event.received_at < p_before);
  get diagnostics v_event_count = row_count;

  delete from private.email_intent_fences as fence
  where fence.intent_id = any(v_intent_ids);
  get diagnostics v_fence_count = row_count;

  delete from private.email_intents as intent
  where intent.id = any(v_intent_ids);
  get diagnostics v_intent_count = row_count;

  return pg_catalog.jsonb_build_object(
    'eventsDestroyed', v_event_count,
    'fencesDestroyed', v_fence_count,
    'intentsDestroyed', v_intent_count
  );
end;
$$;

revoke all on function private.redact_legacy_email_delivery_write()
  from public, anon, authenticated, service_role;
revoke all on function private.destroy_legacy_email_delivery_plaintext(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.destroy_email_dispatch_evidence(timestamptz)
  from public, anon, authenticated, service_role;

alter table private.email_dispatch_control enable row level security;
alter table private.email_intents enable row level security;
alter table private.email_intent_fences enable row level security;
alter table private.email_provider_events enable row level security;

revoke all on table private.email_dispatch_control
  from public, anon, authenticated, service_role;
revoke all on table private.email_intents
  from public, anon, authenticated, service_role;
revoke all on table private.email_intent_fences
  from public, anon, authenticated, service_role;
revoke all on table private.email_provider_events
  from public, anon, authenticated, service_role;

create function private.email_digest_from_hex(p_value text)
returns bytea
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  v_value text := lower(btrim(coalesce(p_value, ''), E' \t\n\r\f\v'));
begin
  if v_value !~ '^[0-9a-f]{64}$' then
    raise check_violation using message = 'invalid_email_dispatch_digest';
  end if;
  return decode(v_value, 'hex');
end;
$$;

revoke all on function private.email_digest_from_hex(text)
  from public, anon, authenticated, service_role;

create function public.enqueue_email_intent(
  target_source text,
  target_source_reference_digest text,
  target_recipient_digest text,
  target_message_kind text,
  target_content_revision text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_source_digest bytea := private.email_digest_from_hex(target_source_reference_digest);
  v_recipient_digest bytea := private.email_digest_from_hex(target_recipient_digest);
  v_intent private.email_intents%rowtype;
  v_created boolean := false;
begin
  if target_source not in ('auth_hook', 'account_deletion') then
    raise check_violation using message = 'invalid_email_source';
  end if;
  if target_message_kind not in (
    'auth_signup', 'auth_recovery', 'auth_email_change_current',
    'auth_email_change_new', 'auth_reauthentication', 'account_deletion_notice'
  ) then
    raise check_violation using message = 'invalid_email_message_kind';
  end if;
  if target_content_revision is null
    or target_content_revision !~ '^[a-z0-9_]{1,80}$'
  then
    raise check_violation using message = 'invalid_email_content_revision';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'email_intent:' || target_source || ':' || encode(v_source_digest, 'hex'),
      0
    )
  );

  select intent.* into v_intent
  from private.email_intents as intent
  where intent.source = target_source
    and intent.source_reference_digest = v_source_digest
  for update;

  if found then
    if v_intent.recipient_digest is distinct from v_recipient_digest
      or v_intent.message_kind is distinct from target_message_kind
      or v_intent.content_revision is distinct from target_content_revision
    then
      raise unique_violation using message = 'email_intent_idempotency_conflict';
    end if;
  else
    insert into private.email_intents (
      source, source_reference_digest, recipient_digest,
      message_kind, content_revision
    ) values (
      target_source, v_source_digest, v_recipient_digest,
      target_message_kind, target_content_revision
    ) returning * into v_intent;
    v_created := true;
  end if;

  insert into private.email_intent_fences (
    intent_id, source, source_reference_digest
  ) values (
    v_intent.id, v_intent.source, v_intent.source_reference_digest
  ) on conflict (intent_id) do nothing;

  if not exists (
    select 1 from private.email_intent_fences as fence
    where fence.intent_id = v_intent.id
      and fence.source = v_intent.source
      and fence.source_reference_digest = v_intent.source_reference_digest
  ) then
    raise integrity_constraint_violation using message = 'email_intent_fence_missing';
  end if;

  return pg_catalog.jsonb_build_object(
    'kind', case when v_created then 'enqueued' else 'existing' end,
    'intentId', v_intent.id,
    'idempotencyKey', v_intent.idempotency_key,
    'state', v_intent.state
  );
end;
$$;

-- Secure email change produces two messages. Persist both intent/fence rows in
-- one RPC transaction before either provider call, so retries can never leave a
-- sent current-address message without a durable new-address counterpart.
create function public.enqueue_email_intent_batch(target_intents jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_length integer;
  v_item record;
  v_outcomes jsonb := '{}'::jsonb;
  v_outcome jsonb;
begin
  if pg_catalog.jsonb_typeof(target_intents) is distinct from 'array' then
    raise check_violation using message = 'invalid_email_dispatch_batch';
  end if;
  v_length := pg_catalog.jsonb_array_length(target_intents);
  if v_length < 1 or v_length > 10 then
    raise check_violation using message = 'invalid_email_dispatch_batch_size';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(target_intents) as entry(item)
    group by item ->> 'source', item ->> 'sourceReferenceDigest'
    having pg_catalog.count(*) > 1
  ) then
    raise unique_violation using message = 'duplicate_email_dispatch_batch_source';
  end if;

  -- Stable ordering avoids advisory-lock inversion when the same batch races.
  for v_item in
    select entry.item, entry.ordinality
    from pg_catalog.jsonb_array_elements(target_intents)
      with ordinality as entry(item, ordinality)
    order by entry.item ->> 'source', entry.item ->> 'sourceReferenceDigest'
  loop
    if pg_catalog.jsonb_typeof(v_item.item) is distinct from 'object' then
      raise check_violation using message = 'invalid_email_dispatch_batch_item';
    end if;
    v_outcome := public.enqueue_email_intent(
      v_item.item ->> 'source',
      v_item.item ->> 'sourceReferenceDigest',
      v_item.item ->> 'recipientDigest',
      v_item.item ->> 'messageKind',
      v_item.item ->> 'contentRevision'
    );
    v_outcomes := pg_catalog.jsonb_set(
      v_outcomes,
      array[(v_item.ordinality - 1)::text],
      v_outcome,
      true
    );
  end loop;

  return (
    select pg_catalog.jsonb_agg(
      v_outcomes -> ((position.index - 1)::text)
      order by position.index
    )
    from pg_catalog.generate_series(1, v_length) as position(index)
  );
end;
$$;

create function public.claim_email_intent_dispatch(
  target_intent_id uuid,
  target_recipient_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_control private.email_dispatch_control%rowtype;
  v_intent private.email_intents%rowtype;
  v_recipient_digest bytea := private.email_digest_from_hex(target_recipient_digest);
begin
  select * into strict v_control
  from private.email_dispatch_control as control
  where control.singleton
  for share;

  select * into v_intent
  from private.email_intents as intent
  where intent.id = target_intent_id
  for update;
  if not found then raise no_data_found using message = 'email_intent_not_found'; end if;
  if v_intent.recipient_digest is distinct from v_recipient_digest then
    raise check_violation using message = 'email_intent_recipient_mismatch';
  end if;
  if not exists (
    select 1 from private.email_intent_fences as fence where fence.intent_id = v_intent.id
  ) then
    raise object_not_in_prerequisite_state using message = 'email_intent_fence_missing';
  end if;

  if not v_control.enabled then
    return pg_catalog.jsonb_build_object('kind', 'disabled', 'state', v_intent.state);
  end if;
  if v_intent.state in ('accepted', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'suppressed', 'failed') then
    return pg_catalog.jsonb_build_object('kind', 'already_dispatched', 'state', v_intent.state);
  end if;
  if v_intent.state = 'needs_review' then
    return pg_catalog.jsonb_build_object('kind', 'needs_review', 'state', v_intent.state);
  end if;
  -- Resend retains idempotency keys for 24 hours. Stop automatic retries five
  -- minutes before that boundary so a provider request cannot cross it and send
  -- a duplicate after the key has expired.
  if v_intent.idempotency_expires_at is not null
    and pg_catalog.now() + interval '5 minutes' >= v_intent.idempotency_expires_at
  then
    update private.email_intents set state = 'needs_review', updated_at = pg_catalog.now()
    where id = v_intent.id;
    return pg_catalog.jsonb_build_object('kind', 'needs_review', 'state', 'needs_review');
  end if;
  if v_intent.state = 'dispatching'
    and v_intent.claimed_at > pg_catalog.now() - interval '10 minutes'
  then
    return pg_catalog.jsonb_build_object('kind', 'in_progress', 'state', v_intent.state);
  end if;
  if v_intent.attempt_count >= 100 then
    update private.email_intents set state = 'needs_review', updated_at = pg_catalog.now()
    where id = v_intent.id;
    return pg_catalog.jsonb_build_object('kind', 'needs_review', 'state', 'needs_review');
  end if;

  update private.email_intents set
    state = 'dispatching',
    attempt_count = attempt_count + 1,
    claimed_at = pg_catalog.now(),
    first_dispatched_at = coalesce(first_dispatched_at, pg_catalog.now()),
    idempotency_expires_at = coalesce(
      idempotency_expires_at,
      pg_catalog.now() + interval '24 hours'
    ),
    updated_at = pg_catalog.now()
  where id = v_intent.id
  returning * into v_intent;

  return pg_catalog.jsonb_build_object(
    'kind', 'claimed',
    'intentId', v_intent.id,
    'idempotencyKey', v_intent.idempotency_key
  );
end;
$$;

create function private.email_terminal_rank(p_state text)
returns integer
language sql
immutable
security invoker
set search_path = ''
as $$
  select case p_state
    when 'complained' then 70
    when 'bounced' then 60
    when 'suppressed' then 50
    when 'failed' then 40
    when 'delivered' then 30
    when 'delayed' then 20
    when 'sent' then 10
    else 0
  end;
$$;

revoke all on function private.email_terminal_rank(text)
  from public, anon, authenticated, service_role;

create function public.record_email_intent_accepted(
  target_intent_id uuid,
  target_provider_reference_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_digest bytea := private.email_digest_from_hex(target_provider_reference_digest);
  v_intent private.email_intents%rowtype;
  v_owner private.email_intents%rowtype;
  v_event record;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'email-provider:' || encode(v_provider_digest, 'hex'),
      0
    )
  );

  select * into v_intent
  from private.email_intents as intent
  where intent.id = target_intent_id
  for update;
  if not found then raise no_data_found using message = 'email_intent_not_found'; end if;

  if v_intent.provider_reference_digest is not null
    and v_intent.provider_reference_digest is distinct from v_provider_digest
  then
    update private.email_intents set state = 'needs_review', updated_at = pg_catalog.now()
    where id = v_intent.id;
    return pg_catalog.jsonb_build_object('state', 'needs_review');
  end if;
  if v_intent.provider_reference_digest = v_provider_digest then
    return pg_catalog.jsonb_build_object('state', v_intent.state);
  end if;
  if v_intent.state = 'needs_review' then
    return pg_catalog.jsonb_build_object('state', 'needs_review');
  end if;
  if v_intent.state not in ('dispatching', 'unknown', 'accepted', 'sent', 'delivered', 'delayed') then
    raise object_not_in_prerequisite_state using message = 'email_intent_not_dispatchable';
  end if;

  select * into v_owner
  from private.email_intents as intent
  where intent.provider_reference_digest = v_provider_digest
    and intent.id <> v_intent.id
  for update;
  if found then
    update private.email_intents set state = 'needs_review', updated_at = pg_catalog.now()
    where id in (v_intent.id, v_owner.id);
    return pg_catalog.jsonb_build_object('state', 'needs_review');
  end if;

  update private.email_intents set
    provider_reference_digest = v_provider_digest,
    state = case when state in ('sent', 'delivered', 'delayed') then state else 'accepted' end,
    accepted_at = coalesce(accepted_at, pg_catalog.now()),
    updated_at = pg_catalog.now()
  where id = v_intent.id
  returning * into v_intent;

  -- A timeout can lose the HTTP response after Resend accepted and emitted a webhook.
  -- Attach any PII-free unmatched events now that the provider reference is durable,
  -- then reduce the strongest lifecycle evidence without requiring a provider replay.
  update private.email_provider_events
  set intent_id = v_intent.id
  where intent_id is null
    and provider_reference_digest = v_provider_digest;

  select event.event_type, event.occurred_at
    into v_event
  from private.email_provider_events as event
  where event.intent_id = v_intent.id
  order by
    private.email_terminal_rank(event.event_type) desc,
    event.occurred_at desc,
    event.svix_id desc
  limit 1;

  if found and private.email_terminal_rank(v_event.event_type)
    > private.email_terminal_rank(v_intent.state)
  then
    update private.email_intents set
      state = v_event.event_type,
      state_occurred_at = v_event.occurred_at,
      delivered_at = case when v_event.event_type = 'delivered'
        then coalesce(delivered_at, v_event.occurred_at) else delivered_at end,
      terminal_at = case when v_event.event_type in ('bounced', 'complained', 'suppressed', 'failed')
        then coalesce(terminal_at, v_event.occurred_at) else terminal_at end,
      updated_at = pg_catalog.now()
    where id = v_intent.id
    returning * into v_intent;
  end if;

  return pg_catalog.jsonb_build_object('state', v_intent.state);
end;
$$;

create function public.record_email_intent_dispatch_failure(
  target_intent_id uuid,
  target_failure text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_state text;
  v_retryable boolean;
begin
  if target_failure not in ('retryable', 'ambiguous', 'permanent') then
    raise check_violation using message = 'invalid_email_dispatch_failure';
  end if;

  v_state := case target_failure
    when 'retryable' then 'queued'
    when 'ambiguous' then 'unknown'
    else 'needs_review'
  end;
  v_retryable := target_failure in ('retryable', 'ambiguous');

  update private.email_intents set state = v_state, updated_at = pg_catalog.now()
  where id = target_intent_id and state = 'dispatching';
  if not found then
    raise object_not_in_prerequisite_state using message = 'email_intent_not_dispatching';
  end if;

  return pg_catalog.jsonb_build_object('state', v_state, 'retryable', v_retryable);
end;
$$;

create function public.reduce_email_provider_event(
  target_svix_id text,
  target_provider_reference_digest text,
  target_event_type text,
  target_occurred_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_provider_digest bytea := private.email_digest_from_hex(target_provider_reference_digest);
  v_intent private.email_intents%rowtype;
  v_existing private.email_provider_events%rowtype;
  v_next_state text;
  v_matched boolean := false;
begin
  if target_svix_id is null or target_svix_id !~ '^[A-Za-z0-9._:-]{1,200}$' then
    raise check_violation using message = 'invalid_email_provider_event_id';
  end if;
  if target_event_type not in ('sent', 'delivered', 'delayed', 'bounced', 'complained', 'suppressed', 'failed') then
    raise check_violation using message = 'invalid_email_provider_event_type';
  end if;
  if target_occurred_at is null or target_occurred_at > pg_catalog.now() + interval '5 minutes' then
    raise check_violation using message = 'invalid_email_provider_event_time';
  end if;

  -- Every provider-reference owner/attachment path takes the digest lock first.
  -- Event reducers then take the svix lock. This global order makes acceptance
  -- versus webhook attachment atomic and makes concurrent duplicate delivery a
  -- durable replay instead of a unique-violation response.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'email-provider:' || encode(v_provider_digest, 'hex'),
      0
    )
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('email-provider-event:' || target_svix_id, 0)
  );

  select * into v_existing
  from private.email_provider_events as event
  where event.svix_id = target_svix_id;
  if found then
    if v_existing.provider_reference_digest is distinct from v_provider_digest
      or v_existing.event_type is distinct from target_event_type
      or v_existing.occurred_at is distinct from target_occurred_at
    then
      raise unique_violation using message = 'email_provider_event_id_conflict';
    end if;
    return pg_catalog.jsonb_build_object(
      'kind', 'duplicate',
      'state', coalesce((select state from private.email_intents where id = v_existing.intent_id), 'unknown')
    );
  end if;

  select * into v_intent
  from private.email_intents as intent
  where intent.provider_reference_digest = v_provider_digest
  for update;
  v_matched := found;

  insert into private.email_provider_events (
    svix_id, intent_id, provider_reference_digest, event_type, occurred_at
  ) values (
    target_svix_id,
    case when v_matched then v_intent.id else null end,
    v_provider_digest,
    target_event_type,
    target_occurred_at
  );

  if not v_matched then
    return pg_catalog.jsonb_build_object('kind', 'unmatched', 'state', 'unknown');
  end if;

  -- Lifecycle rank is monotonic, so out-of-order delivery cannot regress delivered to
  -- sent/delayed or erase a bounce with a later replay. Repeated events at the same rank
  -- retain the latest provider occurrence timestamp.
  v_next_state := v_intent.state;
  if v_intent.state <> 'needs_review'
    and private.email_terminal_rank(target_event_type)
    > private.email_terminal_rank(v_intent.state)
  then
    v_next_state := target_event_type;
  end if;

  update private.email_intents set
    state = v_next_state,
    state_occurred_at = case
      when v_next_state = target_event_type then greatest(
        coalesce(state_occurred_at, '-infinity'::timestamptz),
        target_occurred_at
      )
      else state_occurred_at
    end,
    delivered_at = case when target_event_type = 'delivered'
      then coalesce(delivered_at, target_occurred_at) else delivered_at end,
    terminal_at = case when target_event_type in ('bounced', 'complained', 'suppressed', 'failed')
      then coalesce(terminal_at, target_occurred_at) else terminal_at end,
    updated_at = pg_catalog.now()
  where id = v_intent.id
  returning * into v_intent;

  return pg_catalog.jsonb_build_object(
    'kind', 'reduced', 'intentId', v_intent.id, 'state', v_intent.state
  );
end;
$$;

-- #137 additive integration: no deletion progresses merely because the request
-- exists. A future worker must enqueue this exact notice and observe its fence.
alter table private.account_deletion_requests
  add column notification_intent_id uuid
    references private.email_intents(id) on delete restrict;

create function private.account_deletion_email_fence_ready(p_deletion_event_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from private.account_deletion_requests as request
    join private.email_intents as intent on intent.id = request.notification_intent_id
    join private.email_intent_fences as fence on fence.intent_id = intent.id
    where request.deletion_event_id = p_deletion_event_id
      and intent.source = 'account_deletion'
      and intent.message_kind = 'account_deletion_notice'
  );
$$;

revoke all on function private.account_deletion_email_fence_ready(uuid)
  from public, anon, authenticated, service_role;

-- Preserve the existing staff operational surface but never read legacy plaintext
-- recipient, subject or error values back through the Data API.
create or replace function public.admin_search_email_deliveries(
  p_status text default null,
  p_limit integer default 20,
  p_offset integer default 0
)
returns table (
  dedupe_key text,
  template text,
  recipient text,
  subject text,
  status text,
  attempt_count integer,
  last_error text,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
begin
  if (select auth.uid()) is null or not public.is_staff() then
    raise insufficient_privilege using message = 'staff required';
  end if;
  if p_status is not null and p_status not in ('pending', 'sent', 'failed') then
    raise check_violation using message = 'invalid email delivery status filter';
  end if;

  return query
  select
    delivery.dedupe_key,
    delivery.template,
    'masked'::text,
    ('legacy_' || delivery.template)::text,
    delivery.status,
    delivery.attempt_count,
    case when delivery.last_error is null then null else 'legacy_unverified' end,
    delivery.claimed_at,
    delivery.completed_at,
    delivery.created_at,
    count(*) over()::bigint
  from public.email_deliveries as delivery
  where p_status is null or delivery.status = p_status
  order by delivery.claimed_at desc, delivery.dedupe_key desc
  limit v_limit offset v_offset;
end;
$$;

revoke all on function public.admin_search_email_deliveries(text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_search_email_deliveries(text, integer, integer)
  to authenticated;

-- Service-only RPC surface. Default PUBLIC execute must be revoked from every role.
revoke all on function public.enqueue_email_intent(text, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_intent(text, text, text, text, text)
  to service_role;
revoke all on function public.enqueue_email_intent_batch(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.enqueue_email_intent_batch(jsonb)
  to service_role;
revoke all on function public.claim_email_intent_dispatch(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_email_intent_dispatch(uuid, text)
  to service_role;
revoke all on function public.record_email_intent_accepted(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_intent_accepted(uuid, text)
  to service_role;
revoke all on function public.record_email_intent_dispatch_failure(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.record_email_intent_dispatch_failure(uuid, text)
  to service_role;
revoke all on function public.reduce_email_provider_event(text, text, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.reduce_email_provider_event(text, text, text, timestamptz)
  to service_role;

comment on table private.email_intents is
  'PII-free email lifecycle. Recipient, source and provider references are keyed HMAC digests.';
comment on table private.email_provider_events is
  'PII-free Resend lifecycle projection; raw webhook payloads are never retained.';

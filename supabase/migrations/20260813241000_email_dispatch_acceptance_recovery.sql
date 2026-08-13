-- #191 review follow-up: if Resend accepted but the acceptance RPC response is
-- lost, release only the exact active dispatch claim. A committed acceptance
-- always wins under the row lock and is never downgraded to unknown.

alter table private.email_intents
  add column dispatch_claim_id uuid;

create or replace function public.claim_email_intent_dispatch(
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
  v_claim_id uuid;
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

  v_claim_id := extensions.gen_random_uuid();
  update private.email_intents set
    state = 'dispatching',
    dispatch_claim_id = v_claim_id,
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
    'claimId', v_intent.dispatch_claim_id,
    'idempotencyKey', v_intent.idempotency_key
  );
end;
$$;

create function public.recover_email_acceptance_persistence_failure(
  target_intent_id uuid,
  target_claim_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_intent private.email_intents%rowtype;
begin
  if target_intent_id is null or target_claim_id is null then
    raise check_violation using message = 'invalid_email_dispatch_recovery_claim';
  end if;

  select * into v_intent
  from private.email_intents as intent
  where intent.id = target_intent_id
  for update;
  if not found then raise no_data_found using message = 'email_intent_not_found'; end if;

  if v_intent.state = 'dispatching'
    and v_intent.dispatch_claim_id = target_claim_id
  then
    update private.email_intents set
      state = 'unknown',
      dispatch_claim_id = null,
      updated_at = pg_catalog.now()
    where id = v_intent.id
    returning * into v_intent;
    return pg_catalog.jsonb_build_object('kind', 'released', 'state', 'unknown');
  end if;

  return pg_catalog.jsonb_build_object('kind', 'preserved', 'state', v_intent.state);
end;
$$;

revoke all on function public.recover_email_acceptance_persistence_failure(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.recover_email_acceptance_persistence_failure(uuid, uuid)
  to service_role;

comment on function public.recover_email_acceptance_persistence_failure(uuid, uuid) is
  'Conditionally releases only the exact dispatch claim after an ambiguous acceptance persistence failure; stores no provider reference or payload.';

\set ON_ERROR_STOP on

begin;

select 1 / case when (
  not has_function_privilege(
    'anon',
    'public.recover_email_acceptance_persistence_failure(uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'public.recover_email_acceptance_persistence_failure(uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.recover_email_acceptance_persistence_failure(uuid,uuid)',
    'execute'
  )
) then 1 else 0 end as assert_acceptance_recovery_rpc_is_service_only;

select 1 / case when (
  select pg_catalog.array_agg(parameter_name::text order by ordinal_position)
  from information_schema.parameters
  where specific_schema = 'public'
    and specific_name like 'recover_email_acceptance_persistence_failure_%'
    and parameter_mode = 'IN'
) = array['target_intent_id', 'target_claim_id']::text[]
then 1 else 0 end as assert_recovery_accepts_no_provider_reference_or_payload;

update private.email_dispatch_control set
  hook_contract_ready = true,
  provider_credentials_ready = true,
  webhook_contract_ready = true,
  privacy_retention_ready = true,
  account_deletion_notice_ready = true,
  enabled = true
where singleton;

set local role service_role;

select (public.enqueue_email_intent(
  'auth_hook', repeat('41', 32), repeat('42', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as release_intent_id \gset

select public.claim_email_intent_dispatch(
  :'release_intent_id'::uuid, repeat('42', 32)
) as first_release_claim \gset

select (:'first_release_claim'::jsonb ->> 'claimId') as first_release_claim_id \gset
select (:'first_release_claim'::jsonb ->> 'idempotencyKey') as release_idempotency_key \gset

reset role;

select pg_catalog.jsonb_build_object(
  'attemptCount', intent.attempt_count,
  'claimedAt', intent.claimed_at,
  'firstDispatchedAt', intent.first_dispatched_at,
  'idempotencyExpiresAt', intent.idempotency_expires_at,
  'providerReferenceDigest', pg_catalog.encode(intent.provider_reference_digest, 'hex'),
  'fence', (
    select pg_catalog.jsonb_build_object(
      'source', fence.source,
      'sourceReferenceDigest', pg_catalog.encode(fence.source_reference_digest, 'hex'),
      'createdAt', fence.created_at
    )
    from private.email_intent_fences as fence
    where fence.intent_id = intent.id
  )
) as release_invariants
from private.email_intents as intent
where intent.id = :'release_intent_id'::uuid
\gset release_before_

set local role service_role;

select 1 / case when public.recover_email_acceptance_persistence_failure(
  :'release_intent_id'::uuid,
  '00000000-0000-4000-8000-000000002411'::uuid
) = pg_catalog.jsonb_build_object('kind', 'preserved', 'state', 'dispatching')
then 1 else 0 end as assert_wrong_claim_cannot_release_dispatch_lease;

select 1 / case when public.claim_email_intent_dispatch(
  :'release_intent_id'::uuid, repeat('42', 32)
) = pg_catalog.jsonb_build_object('kind', 'in_progress', 'state', 'dispatching')
then 1 else 0 end as assert_wrong_claim_keeps_fresh_lease;

select 1 / case when public.recover_email_acceptance_persistence_failure(
  :'release_intent_id'::uuid,
  :'first_release_claim_id'::uuid
) = pg_catalog.jsonb_build_object('kind', 'released', 'state', 'unknown')
then 1 else 0 end as assert_exact_claim_releases_lost_acceptance_write;

reset role;

select 1 / case when (
  select state = 'unknown'
    and dispatch_claim_id is null
    and provider_reference_digest is null
  from private.email_intents
  where id = :'release_intent_id'::uuid
) then 1 else 0 end as assert_release_persists_no_provider_reference;

select 1 / case when (
  select pg_catalog.jsonb_build_object(
    'attemptCount', intent.attempt_count,
    'claimedAt', intent.claimed_at,
    'firstDispatchedAt', intent.first_dispatched_at,
    'idempotencyExpiresAt', intent.idempotency_expires_at,
    'providerReferenceDigest', pg_catalog.encode(intent.provider_reference_digest, 'hex'),
    'fence', (
      select pg_catalog.jsonb_build_object(
        'source', fence.source,
        'sourceReferenceDigest', pg_catalog.encode(fence.source_reference_digest, 'hex'),
        'createdAt', fence.created_at
      )
      from private.email_intent_fences as fence
      where fence.intent_id = intent.id
    )
  ) = :'release_before_release_invariants'::jsonb
  from private.email_intents as intent
  where intent.id = :'release_intent_id'::uuid
) then 1 else 0 end as assert_release_preserves_dispatch_and_fence_invariants;

set local role service_role;

select public.claim_email_intent_dispatch(
  :'release_intent_id'::uuid, repeat('42', 32)
) as second_release_claim \gset

select 1 / case when (
  :'second_release_claim'::jsonb ->> 'kind' = 'claimed'
  and :'second_release_claim'::jsonb ->> 'idempotencyKey' = :'release_idempotency_key'
  and :'second_release_claim'::jsonb ->> 'claimId' <> :'first_release_claim_id'
) then 1 else 0 end as assert_immediate_replay_reuses_same_idempotency_key;

select (public.enqueue_email_intent(
  'auth_hook', repeat('51', 32), repeat('52', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as committed_intent_id \gset

select public.claim_email_intent_dispatch(
  :'committed_intent_id'::uuid, repeat('52', 32)
) as committed_claim \gset

select public.record_email_intent_accepted(
  :'committed_intent_id'::uuid, repeat('53', 32)
);

select 1 / case when public.recover_email_acceptance_persistence_failure(
  :'committed_intent_id'::uuid,
  (:'committed_claim'::jsonb ->> 'claimId')::uuid
) = pg_catalog.jsonb_build_object('kind', 'preserved', 'state', 'accepted')
then 1 else 0 end as assert_committed_acceptance_wins_response_loss_recovery;

reset role;

select 1 / case when (
  select state = 'accepted'
    and provider_reference_digest = decode(repeat('53', 32), 'hex')
  from private.email_intents
  where id = :'committed_intent_id'::uuid
) then 1 else 0 end as assert_recovery_never_downgrades_committed_acceptance;

set local role service_role;

select 1 / case when public.reduce_email_provider_event(
  'acceptance-recovery-delivered', repeat('53', 32),
  'delivered', '2026-08-13T13:05:00Z'::timestamptz
) ->> 'state' = 'delivered'
then 1 else 0 end as assert_signed_terminal_event_reduces_committed_acceptance;

select 1 / case when public.recover_email_acceptance_persistence_failure(
  :'committed_intent_id'::uuid,
  (:'committed_claim'::jsonb ->> 'claimId')::uuid
) = pg_catalog.jsonb_build_object('kind', 'preserved', 'state', 'delivered')
then 1 else 0 end as assert_terminal_state_wins_response_loss_recovery;

do $$
begin
  begin
    perform public.recover_email_acceptance_persistence_failure(
      '00000000-0000-4000-8000-000000002412'::uuid,
      '00000000-0000-4000-8000-000000002413'::uuid
    );
  exception when no_data_found then
    if sqlerrm = 'email_intent_not_found' then return; end if;
    raise;
  end;
  raise exception 'missing acceptance recovery intent must fail closed';
end;
$$;

select (public.enqueue_email_intent(
  'auth_hook', repeat('61', 32), repeat('62', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as failed_recovery_intent_id \gset

select public.claim_email_intent_dispatch(
  :'failed_recovery_intent_id'::uuid, repeat('62', 32)
) as failed_recovery_claim \gset

select pg_catalog.set_config(
  'test.email_failed_recovery_intent_id',
  :'failed_recovery_intent_id',
  true
);

do $$
begin
  begin
    perform public.recover_email_acceptance_persistence_failure(
      pg_catalog.current_setting('test.email_failed_recovery_intent_id')::uuid,
      null
    );
  exception when check_violation then
    if sqlerrm = 'invalid_email_dispatch_recovery_claim' then return; end if;
    raise;
  end;
  raise exception 'invalid recovery must fail closed';
end;
$$;

select 1 / case when public.claim_email_intent_dispatch(
  :'failed_recovery_intent_id'::uuid, repeat('62', 32)
) = pg_catalog.jsonb_build_object('kind', 'in_progress', 'state', 'dispatching')
then 1 else 0 end as assert_failed_recovery_keeps_lease_fallback;

reset role;

select 1 / case when (
  select state = 'dispatching'
    and dispatch_claim_id = (:'failed_recovery_claim'::jsonb ->> 'claimId')::uuid
    and provider_reference_digest is null
  from private.email_intents
  where id = :'failed_recovery_intent_id'::uuid
) then 1 else 0 end as assert_failed_recovery_makes_zero_mutations;

rollback;

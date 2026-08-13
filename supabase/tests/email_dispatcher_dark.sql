\set ON_ERROR_STOP on

begin;

select 1 / case when exists (
  select 1 from private.email_dispatch_control
  where singleton and not enabled
) then 1 else 0 end as assert_email_dispatch_defaults_off;

select 1 / case when not exists (
  select 1
  from unnest(array[
    'private.email_dispatch_control'::regclass,
    'private.email_intents'::regclass,
    'private.email_intent_fences'::regclass,
    'private.email_provider_events'::regclass
  ]) as protected(table_name)
  cross join unnest(array['anon', 'authenticated', 'service_role']) as app_role(name)
  where has_table_privilege(app_role.name, protected.table_name, 'select')
     or has_table_privilege(app_role.name, protected.table_name, 'insert')
     or has_table_privilege(app_role.name, protected.table_name, 'update')
) then 1 else 0 end as assert_private_email_tables_have_no_data_api_acl;

select 1 / case when (
  not has_function_privilege('anon', 'public.enqueue_email_intent(text,text,text,text,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_email_intent(text,text,text,text,text)', 'execute')
  and has_function_privilege('service_role', 'public.enqueue_email_intent(text,text,text,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_email_intent_batch(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.enqueue_email_intent_batch(jsonb)', 'execute')
  and has_function_privilege('service_role', 'public.enqueue_email_intent_batch(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.reduce_email_provider_event(text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'public.reduce_email_provider_event(text,text,text,timestamptz)', 'execute')
  and has_function_privilege('service_role', 'public.reduce_email_provider_event(text,text,text,timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.destroy_legacy_email_delivery_plaintext(timestamptz)', 'execute')
  and not has_function_privilege('service_role', 'private.destroy_email_dispatch_evidence(timestamptz)', 'execute')
) then 1 else 0 end as assert_email_rpc_acl_is_service_only;

select 1 / case when not exists (
  select 1 from information_schema.columns
  where table_schema = 'private'
    and table_name in ('email_intents', 'email_provider_events')
    and column_name in ('recipient', 'subject', 'raw_payload', 'last_error', 'provider_reference')
) then 1 else 0 end as assert_private_ledger_has_no_plaintext_columns;

set local role service_role;

select 1 / case when public.claim_email_delivery(
  'order_confirmation:00000000-0000-4000-8000-000000001911',
  'order_confirmation',
  'plain-recipient@example.test',
  'Plain customer subject',
  interval '10 minutes'
) then 1 else 0 end as assert_legacy_claim_remains_compatible;

select (
  public.enqueue_email_intent(
    'auth_hook',
    repeat('11', 32),
    repeat('22', 32),
    'auth_signup',
    'auth_signup_v1'
  ) ->> 'intentId'
) as intent_id \gset

select 1 / case when (
  public.enqueue_email_intent(
    'auth_hook', repeat('11', 32), repeat('22', 32),
    'auth_signup', 'auth_signup_v1'
  ) = pg_catalog.jsonb_build_object(
    'kind', 'existing',
    'intentId', :'intent_id'::uuid,
    'idempotencyKey', 'email/' || :'intent_id',
    'state', 'queued'
  )
) then 1 else 0 end as assert_enqueue_is_idempotent;

do $$
begin
  begin
    perform public.enqueue_email_intent(
      'auth_hook', repeat('11', 32), repeat('33', 32),
      'auth_signup', 'auth_signup_v1'
    );
  exception when unique_violation then
    if sqlerrm = 'email_intent_idempotency_conflict' then return; end if;
    raise;
  end;
  raise exception 'different payload must conflict for the same source digest';
end;
$$;

select 1 / case when pg_catalog.jsonb_array_length(
  public.enqueue_email_intent_batch(pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'source', 'auth_hook',
      'sourceReferenceDigest', repeat('55', 32),
      'recipientDigest', repeat('22', 32),
      'messageKind', 'auth_email_change_current',
      'contentRevision', 'auth_email_change_current_v1'
    ),
    pg_catalog.jsonb_build_object(
      'source', 'auth_hook',
      'sourceReferenceDigest', repeat('66', 32),
      'recipientDigest', repeat('33', 32),
      'messageKind', 'auth_email_change_new',
      'contentRevision', 'auth_email_change_new_v1'
    )
  ))
) = 2 then 1 else 0 end as assert_batch_enqueue_persists_both_intents;

reset role;

select 1 / case when (
  select pg_catalog.count(*) = 2
  from private.email_intent_fences as fence
  where fence.source_reference_digest in (
    decode(repeat('55', 32), 'hex'),
    decode(repeat('66', 32), 'hex')
  )
) then 1 else 0 end as assert_batch_enqueue_persists_both_fences;

set local role service_role;

do $$
begin
  begin
    perform public.enqueue_email_intent_batch(pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'source', 'auth_hook',
        'sourceReferenceDigest', repeat('77', 32),
        'recipientDigest', repeat('22', 32),
        'messageKind', 'auth_email_change_current',
        'contentRevision', 'auth_email_change_current_v1'
      ),
      pg_catalog.jsonb_build_object(
        'source', 'auth_hook',
        'sourceReferenceDigest', repeat('11', 32),
        'recipientDigest', repeat('33', 32),
        'messageKind', 'auth_signup',
        'contentRevision', 'auth_signup_v1'
      )
    ));
  exception when unique_violation then
    if sqlerrm <> 'email_intent_idempotency_conflict' then raise; end if;
  end;
end;
$$;

reset role;

select 1 / case when not exists (
  select 1 from private.email_intents
  where source_reference_digest = decode(repeat('77', 32), 'hex')
) then 1 else 0 end as assert_batch_conflict_rolls_back_every_intent;

set local role service_role;

select 1 / case when public.claim_email_intent_dispatch(
  :'intent_id'::uuid, repeat('22', 32)
) = pg_catalog.jsonb_build_object('kind', 'disabled', 'state', 'queued')
then 1 else 0 end as assert_gate_off_blocks_provider_claim;

reset role;

select 1 / case when exists (
  select 1 from public.email_deliveries
  where dedupe_key = 'order_confirmation:00000000-0000-4000-8000-000000001911'
    and recipient = 'redacted@invalid.local'
    and subject = 'legacy_order_confirmation'
    and evidence_class = 'legacy_unverified'
) then 1 else 0 end as assert_new_legacy_writes_are_redacted;

do $$
begin
  begin
    perform private.destroy_email_dispatch_evidence(pg_catalog.now() - interval '30 days');
  exception when object_not_in_prerequisite_state then
    if sqlerrm = 'email_retention_policy_not_ready' then return; end if;
    raise;
  end;
  raise exception 'retention purge must remain closed before policy readiness';
end;
$$;

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
  'auth_hook', repeat('e1', 32), repeat('e2', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as purge_intent_id \gset
select public.claim_email_intent_dispatch(:'purge_intent_id'::uuid, repeat('e2', 32));
select public.record_email_intent_accepted(:'purge_intent_id'::uuid, repeat('e3', 32));
select public.reduce_email_provider_event(
  'svix-purge-evidence', repeat('e3', 32), 'delivered', pg_catalog.now()
);

reset role;

update private.email_intents set
  created_at = pg_catalog.now() - interval '27 hours',
  updated_at = pg_catalog.now() - interval '26 hours'
where id = :'purge_intent_id'::uuid;

select 1 / case when private.destroy_email_dispatch_evidence(
  pg_catalog.now() - interval '25 hours'
) = pg_catalog.jsonb_build_object(
  'eventsDestroyed', 1,
  'fencesDestroyed', 1,
  'intentsDestroyed', 1
) then 1 else 0 end as assert_approved_retention_purges_terminal_evidence;

select 1 / case when not exists (
  select 1 from private.email_intents where id = :'purge_intent_id'::uuid
) then 1 else 0 end as assert_retention_removes_terminal_intent;

set local role service_role;

select 1 / case when public.claim_email_intent_dispatch(
  :'intent_id'::uuid, repeat('22', 32)
) ->> 'kind' = 'claimed' then 1 else 0 end as assert_ready_gate_claims_once;

select 1 / case when public.claim_email_intent_dispatch(
  :'intent_id'::uuid, repeat('22', 32)
) = pg_catalog.jsonb_build_object('kind', 'in_progress', 'state', 'dispatching')
then 1 else 0 end as assert_live_claim_is_not_duplicated;

select 1 / case when public.record_email_intent_dispatch_failure(
  :'intent_id'::uuid, 'ambiguous'
) = pg_catalog.jsonb_build_object('state', 'unknown', 'retryable', true)
then 1 else 0 end as assert_timeout_remains_retryable_unknown;

select 1 / case when public.claim_email_intent_dispatch(
  :'intent_id'::uuid, repeat('22', 32)
) ->> 'kind' = 'claimed' then 1 else 0 end as assert_unknown_reuses_durable_attempt;

select (public.enqueue_email_intent(
  'auth_hook', repeat('88', 32), repeat('99', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as expiring_intent_id \gset

select 1 / case when public.claim_email_intent_dispatch(
  :'expiring_intent_id'::uuid, repeat('99', 32)
) ->> 'kind' = 'claimed' then 1 else 0 end as assert_expiring_intent_first_claim;

select public.record_email_intent_dispatch_failure(
  :'expiring_intent_id'::uuid, 'ambiguous'
);

reset role;

update private.email_intents set
  created_at = pg_catalog.now() - interval '24 hours 1 minute',
  first_dispatched_at = pg_catalog.now() - interval '24 hours',
  idempotency_expires_at = pg_catalog.now(),
  claimed_at = pg_catalog.now() - interval '11 minutes'
where id = :'expiring_intent_id'::uuid;

set local role service_role;

select 1 / case when public.claim_email_intent_dispatch(
  :'expiring_intent_id'::uuid, repeat('99', 32)
) = pg_catalog.jsonb_build_object('kind', 'needs_review', 'state', 'needs_review')
then 1 else 0 end as assert_expired_idempotency_window_stops_automatic_retry;

select (public.enqueue_email_intent(
  'auth_hook', repeat('91', 32), repeat('92', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as permanent_failure_intent_id \gset
select public.claim_email_intent_dispatch(
  :'permanent_failure_intent_id'::uuid, repeat('92', 32)
);
select 1 / case when public.record_email_intent_dispatch_failure(
  :'permanent_failure_intent_id'::uuid, 'permanent'
) = pg_catalog.jsonb_build_object('state', 'needs_review', 'retryable', false)
then 1 else 0 end as assert_permanent_send_failure_needs_review;
select 1 / case when public.claim_email_intent_dispatch(
  :'permanent_failure_intent_id'::uuid, repeat('92', 32)
) = pg_catalog.jsonb_build_object('kind', 'needs_review', 'state', 'needs_review')
then 1 else 0 end as assert_permanent_send_failure_cannot_replay_as_success;

select (public.enqueue_email_intent(
  'auth_hook', repeat('a1', 32), repeat('a2', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as changed_ref_intent_id \gset
select public.claim_email_intent_dispatch(:'changed_ref_intent_id'::uuid, repeat('a2', 32));
select public.record_email_intent_accepted(:'changed_ref_intent_id'::uuid, repeat('a3', 32));
select 1 / case when public.record_email_intent_accepted(
  :'changed_ref_intent_id'::uuid, repeat('a4', 32)
) = pg_catalog.jsonb_build_object('state', 'needs_review')
then 1 else 0 end as assert_changed_provider_reference_needs_review;

select (public.enqueue_email_intent(
  'auth_hook', repeat('b1', 32), repeat('b2', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as provider_owner_intent_id \gset
select (public.enqueue_email_intent(
  'auth_hook', repeat('c1', 32), repeat('c2', 32),
  'auth_signup', 'auth_signup_v1'
) ->> 'intentId') as provider_conflict_intent_id \gset
select public.claim_email_intent_dispatch(:'provider_owner_intent_id'::uuid, repeat('b2', 32));
select public.claim_email_intent_dispatch(:'provider_conflict_intent_id'::uuid, repeat('c2', 32));
select public.record_email_intent_accepted(:'provider_owner_intent_id'::uuid, repeat('d1', 32));
select 1 / case when public.record_email_intent_accepted(
  :'provider_conflict_intent_id'::uuid, repeat('d1', 32)
) = pg_catalog.jsonb_build_object('state', 'needs_review')
then 1 else 0 end as assert_shared_provider_reference_needs_review;

reset role;

select 1 / case when (
  select pg_catalog.count(*) = 2
  from private.email_intents
  where id in (
    :'provider_owner_intent_id'::uuid,
    :'provider_conflict_intent_id'::uuid
  ) and state = 'needs_review'
) then 1 else 0 end as assert_shared_provider_reference_stops_both_intents;

set local role service_role;

select 1 / case when public.reduce_email_provider_event(
  'svix-shared-provider-reference', repeat('d1', 32), 'delivered', pg_catalog.now()
) ->> 'state' = 'needs_review'
then 1 else 0 end as assert_webhook_cannot_clear_provider_reference_review;

select 1 / case when public.reduce_email_provider_event(
  'svix-before-accept', repeat('44', 32), 'delivered', pg_catalog.now()
) = pg_catalog.jsonb_build_object('kind', 'unmatched', 'state', 'unknown')
then 1 else 0 end as assert_webhook_before_accept_is_durable_unmatched;

select 1 / case when public.record_email_intent_accepted(
  :'intent_id'::uuid, repeat('44', 32)
) = pg_catalog.jsonb_build_object('state', 'delivered')
then 1 else 0 end as assert_acceptance_reconciles_early_delivery;

select 1 / case when public.reduce_email_provider_event(
  'svix-before-accept', repeat('44', 32), 'delivered', pg_catalog.now()
) = pg_catalog.jsonb_build_object('kind', 'duplicate', 'state', 'delivered')
then 1 else 0 end as assert_svix_id_deduplicates;

select 1 / case when public.reduce_email_provider_event(
  'svix-late-sent', repeat('44', 32), 'sent', pg_catalog.now() + interval '1 second'
) ->> 'state' = 'delivered' then 1 else 0 end as assert_out_of_order_sent_cannot_regress_delivery;

select 1 / case when public.reduce_email_provider_event(
  'svix-bounced', repeat('44', 32), 'bounced', pg_catalog.now() - interval '1 second'
) ->> 'state' = 'bounced' then 1 else 0 end as assert_terminal_bounce_surfaces_despite_event_order;

select 1 / case when public.reduce_email_provider_event(
  'svix-later-delivered', repeat('44', 32), 'delivered', pg_catalog.now() + interval '2 seconds'
) ->> 'state' = 'bounced' then 1 else 0 end as assert_delivery_cannot_erase_terminal_bounce;

do $$
begin
  begin
    perform public.reduce_email_provider_event(
      'svix-before-accept', repeat('44', 32), 'failed', pg_catalog.now()
    );
  exception when unique_violation then
    if sqlerrm = 'email_provider_event_id_conflict' then return; end if;
    raise;
  end;
  raise exception 'same svix id with changed payload must conflict';
end;
$$;

reset role;

select 1 / case when (
  select state = 'bounced'
    and attempt_count = 2
    and provider_reference_digest = decode(repeat('44', 32), 'hex')
  from private.email_intents
  where id = :'intent_id'::uuid
) then 1 else 0 end as assert_private_lifecycle_projection;

select 1 / case when not private.account_deletion_email_fence_ready(
  '00000000-0000-4000-8000-000000001912'
) then 1 else 0 end as assert_deletion_fence_fails_closed_without_notice;

rollback;

\set ON_ERROR_STOP on

begin;

-- The migration records its own pre/post count evidence. Production currently
-- expects two rows, but the additive migration remains safe for an empty local
-- DB and refuses any update/count mismatch transactionally.
select 1 / case when (
  select before_total = after_total
    and before_null = updated_count
    and after_toss = before_total
    and after_null = 0
  from private.payment_migration_evidence
  where migration_name = '20260813081620_provider_neutral_payment_ledger'
) then 1 else 0 end as assert_provider_backfill_has_pre_post_invariants;

select 1 / case when (
  has_table_privilege('service_role', 'private.payment_migration_evidence', 'select')
  and not has_table_privilege('service_role', 'private.payment_migration_evidence', 'insert')
  and not has_table_privilege('service_role', 'private.payment_migration_evidence', 'update')
  and not has_table_privilege('service_role', 'private.payment_migration_evidence', 'delete')
  and not has_any_column_privilege('anon', 'private.payment_migration_evidence', 'select')
  and not has_any_column_privilege('authenticated', 'private.payment_migration_evidence', 'select')
) then 1 else 0 end as assert_provider_backfill_evidence_is_service_read_only;

-- The ledger records the provider explicitly while preserving every legacy
-- insert path as Toss until each checkout is moved behind a provider adapter.
select 1 / case when (
  select array_agg(enum_value::text order by enum_order)
    = array['toss', 'korpay']::text[]
  from (
    select enumlabel as enum_value, enumsortorder as enum_order
    from pg_enum
    where enumtypid = 'public.payment_provider'::regtype
  ) as providers
) then 1 else 0 end as assert_payment_provider_contract;

select 1 / case when (
  select array_agg(enum_value::text order by enum_order)
    = array['order', 'ticket', 'wallet', 'prize_sale']::text[]
  from (
    select enumlabel as enum_value, enumsortorder as enum_order
    from pg_enum
    where enumtypid = 'public.payment_purpose'::regtype
  ) as purposes
) then 1 else 0 end as assert_payment_purpose_supports_physical_prize_sales;

select 1 / case when (
  select array_agg(enum_value::text order by enum_order)
    = array[
      'prepared',
      'confirming',
      'approved',
      'declined',
      'canceled',
      'unknown',
      'needs_review'
    ]::text[]
  from (
    select enumlabel as enum_value, enumsortorder as enum_order
    from pg_enum
    where enumtypid = 'public.payment_attempt_state'::regtype
  ) as states
) then 1 else 0 end as assert_payment_attempt_state_contract;

select 1 / case when (
  select is_nullable = 'NO'
    and column_default like '%toss%'
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payments'
    and column_name = 'provider'
) then 1 else 0 end as assert_legacy_payment_provider_default_is_toss;

select 1 / case when (
  select relrowsecurity
  from pg_class
  where oid = 'public.payment_attempts'::regclass
) then 1 else 0 end as assert_payment_attempts_enable_rls;

select 1 / case when (
  has_table_privilege('service_role', 'public.payment_attempts', 'select')
  and has_table_privilege('service_role', 'public.payment_attempts', 'insert')
  and has_table_privilege('service_role', 'public.payment_attempts', 'update')
  and not has_table_privilege('service_role', 'public.payment_attempts', 'delete')
  and not has_any_column_privilege('anon', 'public.payment_attempts', 'select')
  and not has_any_column_privilege('authenticated', 'public.payment_attempts', 'select')
  and not has_table_privilege('anon', 'public.payment_attempts', 'insert')
  and not has_table_privilege('authenticated', 'public.payment_attempts', 'insert')
) then 1 else 0 end as assert_payment_attempts_are_server_only;

-- Evidence is append-only, lives outside exposed schemas, and has no generic
-- raw payload column that could accidentally retain provider PII.
select 1 / case when (
  select relrowsecurity
  from pg_class
  where oid = 'private.payment_provider_evidence'::regclass
) then 1 else 0 end as assert_provider_evidence_enables_rls_defense_in_depth;

select 1 / case when (
  has_schema_privilege('service_role', 'private', 'usage')
  and has_table_privilege('service_role', 'private.payment_provider_evidence', 'select')
  and has_table_privilege('service_role', 'private.payment_provider_evidence', 'insert')
  and not has_table_privilege('service_role', 'private.payment_provider_evidence', 'update')
  and not has_table_privilege('service_role', 'private.payment_provider_evidence', 'delete')
  and not has_any_column_privilege('anon', 'private.payment_provider_evidence', 'select')
  and not has_any_column_privilege('authenticated', 'private.payment_provider_evidence', 'select')
) then 1 else 0 end as assert_provider_evidence_is_service_role_append_only;

select 1 / case when not exists (
  select 1
  from information_schema.columns
  where table_schema = 'private'
    and table_name = 'payment_provider_evidence'
    and column_name in ('raw', 'payload', 'response', 'response_payload')
) then 1 else 0 end as assert_provider_evidence_has_no_generic_raw_payload;

-- The browser-facing surface is an explicit security-invoker view. It exposes
-- only receipt fields and delegates owner/staff row filtering to payments RLS.
select 1 / case when (
  select coalesce(reloptions, array[]::text[]) @> array['security_invoker=true']::text[]
  from pg_class
  where oid = 'public.payment_summaries'::regclass
) then 1 else 0 end as assert_payment_summary_uses_security_invoker;

select 1 / case when (
  select array_agg(column_name::text order by ordinal_position)
    = array[
      'id',
      'user_id',
      'purpose',
      'ref_id',
      'provider',
      'amount',
      'status',
      'created_at'
    ]::text[]
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payment_summaries'
) then 1 else 0 end as assert_payment_summary_has_only_safe_columns;

select 1 / case when (
  has_table_privilege('authenticated', 'public.payment_summaries', 'select')
    and not has_table_privilege('anon', 'public.payment_summaries', 'select')
    and not has_table_privilege('authenticated', 'public.payment_summaries', 'insert')
    and not has_table_privilege('authenticated', 'public.payments', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'id', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'user_id', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'purpose', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'ref_id', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'provider', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'amount', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'status', 'select')
    and has_column_privilege('authenticated', 'public.payments', 'created_at', 'select')
    and not has_column_privilege('authenticated', 'public.payments', 'payment_key', 'select')
    and not has_column_privilege('authenticated', 'public.payments', 'idempotency_key', 'select')
    and not has_column_privilege('authenticated', 'public.payments', 'raw', 'select')
) then 1 else 0 end as assert_client_payment_acl_blocks_table_wide_and_secret_reads;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000901',
    'authenticated', 'authenticated', 'payment-owner@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    'authenticated', 'authenticated', 'payment-other@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000903',
    'authenticated', 'authenticated', 'payment-staff@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, role)
values
  (
    '00000000-0000-4000-8000-000000000901',
    'payment-owner@example.test', 'payment_owner', 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000902',
    'payment-other@example.test', 'payment_other', 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000903',
    'payment-staff@example.test', 'payment_staff', 'staff'
  )
on conflict (id) do update set
  email = excluded.email,
  nickname = excluded.nickname,
  role = excluded.role;

-- Omitting provider exercises the compatibility default used by every legacy
-- confirm RPC. The migration must backfill deployed rows through the same rule.
insert into public.payments (
  id,
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
  '10000000-0000-4000-8000-000000000901',
  '00000000-0000-4000-8000-000000000901',
  'order',
  '20000000-0000-4000-8000-000000000901',
  31000,
  'paid',
  'legacy-provider-secret',
  'provider-foundation-payment-901',
  '{"cardNumber":"must-not-reach-browser"}'::jsonb
);

select 1 / case when (
  select provider = 'toss'::public.payment_provider
  from public.payments
  where id = '10000000-0000-4000-8000-000000000901'
) then 1 else 0 end as assert_legacy_payment_insert_defaults_to_toss;

set local role service_role;

insert into public.payment_attempts (
  id,
  provider,
  user_id,
  purpose,
  ref_id,
  amount,
  currency,
  state,
  idempotency_key,
  provider_order_id,
  provider_product_code,
  expires_at
)
values (
  '30000000-0000-4000-8000-000000000901',
  'korpay',
  '00000000-0000-4000-8000-000000000901',
  'order',
  '20000000-0000-4000-8000-000000000901',
  31000,
  'KRW',
  'prepared',
  'provider-foundation-attempt-901',
  'O30000000000040008000000000000901',
  'P30000000000040008000000000000901',
  now() + interval '10 minutes'
);

do $$
begin
  begin
    insert into public.payment_attempts (
      provider,
      user_id,
      purpose,
      ref_id,
      amount,
      state,
      idempotency_key,
      provider_order_id,
      provider_product_code,
      expires_at
    )
    values (
      'korpay',
      '00000000-0000-4000-8000-000000000901',
      'order',
      '20000000-0000-4000-8000-000000000901',
      31000,
      'prepared',
      'provider-foundation-attempt-901',
      'O40000000000040008000000000000901',
      'P40000000000040008000000000000901',
      now() + interval '10 minutes'
    );
    raise exception 'duplicate attempt idempotency key should fail';
  exception
    when unique_violation then null;
  end;

  begin
    insert into public.payment_attempts (
      provider,
      user_id,
      purpose,
      ref_id,
      amount,
      state,
      idempotency_key,
      provider_order_id,
      provider_product_code,
      expires_at
    )
    values (
      'korpay',
      '00000000-0000-4000-8000-000000000901',
      'order',
      '20000000-0000-4000-8000-000000000901',
      31000,
      'confirming',
      'provider-foundation-attempt-no-claim',
      'O50000000000040008000000000000901',
      'P50000000000040008000000000000901',
      now() + interval '10 minutes'
    );
    raise exception 'confirming attempt without claim should fail';
  exception
    when check_violation then null;
  end;
end;
$$;

insert into private.payment_provider_evidence (
  id,
  payment_attempt_id,
  evidence_kind,
  provider_payment_key,
  provider_transaction_id,
  provider_approval_reference,
  result_code,
  payment_method,
  masked_payment_method,
  approved_at
)
values (
  '40000000-0000-4000-8000-000000000901',
  '30000000-0000-4000-8000-000000000901',
  'confirm',
  'provider-key-private',
  'provider-transaction-private',
  'provider-approval-private',
  '3001',
  'card',
  '1234-****-****-5678',
  now()
);

select 1 / case when (
  select count(*) = 1
  from private.payment_provider_evidence
  where payment_attempt_id = '30000000-0000-4000-8000-000000000901'
) then 1 else 0 end as assert_service_role_can_append_provider_evidence;

set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000901', true);

select 1 / case when (
  select count(*) = 1
    and bool_and(provider = 'toss'::public.payment_provider)
  from public.payment_summaries
) then 1 else 0 end as assert_owner_reads_only_their_safe_payment_summary;

do $$
begin
  begin
    perform payment_key from public.payments limit 1;
    raise exception 'authenticated must not read payment_key';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform raw from public.payments limit 1;
    raise exception 'authenticated must not read raw';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from public.payment_attempts limit 1;
    raise exception 'authenticated must not read payment attempts';
  exception
    when insufficient_privilege then null;
  end;

  begin
    perform 1 from private.payment_provider_evidence limit 1;
    raise exception 'authenticated must not read provider evidence';
  exception
    when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000902', true);
select 1 / case when not exists (
  select 1 from public.payment_summaries
) then 1 else 0 end as assert_other_user_cannot_read_payment_summary;

select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000903', true);
select 1 / case when (
  select count(*) = 1
  from public.payment_summaries
) then 1 else 0 end as assert_staff_can_read_safe_payment_summary;

rollback;

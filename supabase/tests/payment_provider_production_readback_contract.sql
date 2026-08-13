\set ON_ERROR_STOP on

begin;

-- Production readback is immutable-evidence based so it can run on every
-- deployment. This transaction supplies the same aggregate contract without
-- relying on Production data and rolls every fixture back.
update private.payment_migration_evidence
set
  before_total = 2,
  before_null = 2,
  updated_count = 2,
  after_total = 2,
  after_toss = 2,
  after_null = 0
where migration_name = '20260813182100_provider_neutral_payment_ledger';

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  (
    '00000000-0000-4000-8000-000000000911',
    'authenticated', 'authenticated', 'provider-readback-1@example.test', now(),
    '{}', '{}', now(), now()
  ),
  (
    '00000000-0000-4000-8000-000000000912',
    'authenticated', 'authenticated', 'provider-readback-2@example.test', now(),
    '{}', '{}', now(), now()
  )
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, role)
values
  (
    '00000000-0000-4000-8000-000000000911',
    'provider-readback-1@example.test', 'provider_readback_1', 'user'
  ),
  (
    '00000000-0000-4000-8000-000000000912',
    'provider-readback-2@example.test', 'provider_readback_2', 'user'
  )
on conflict (id) do nothing;

insert into public.payments (
  id,
  user_id,
  provider,
  purpose,
  amount,
  status,
  idempotency_key
)
values
  (
    '10000000-0000-4000-8000-000000000911',
    '00000000-0000-4000-8000-000000000911',
    'toss',
    'order',
    1000,
    'paid',
    'provider-readback-contract-1'
  ),
  (
    '10000000-0000-4000-8000-000000000912',
    '00000000-0000-4000-8000-000000000912',
    'toss',
    'ticket',
    1000,
    'paid',
    'provider-readback-contract-2'
  )
on conflict (idempotency_key) do nothing;

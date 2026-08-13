-- Production-specific readback for #204. The reusable migration remains safe
-- for empty local/preview databases, while the production workflow separately
-- requires exactly two rows before the provider column exists. These checks use
-- immutable migration evidence so future Korpay rows do not break every deploy.

select 1 / case when (
  select before_total = 2
    and before_null = 2
    and updated_count = 2
    and after_total = 2
    and after_toss = 2
    and after_null = 0
  from private.payment_migration_evidence
  where migration_name = '20260813081620_provider_neutral_payment_ledger'
) then 1 else 0 end as assert_production_provider_backfill_evidence;

select 1 / case when (
  select count(*) >= 2
    and count(*) filter (where provider = 'toss') >= 2
    and count(*) filter (where provider is null) = 0
  from public.payments
) then 1 else 0 end as assert_current_payments_have_explicit_provider;

select
  count(*) as payment_count,
  count(*) filter (where provider = 'toss') as toss_count,
  count(*) filter (where provider = 'korpay') as korpay_count
from public.payments;

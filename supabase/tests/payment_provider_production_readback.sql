-- Production-specific readback for #204. The reusable migration remains safe
-- for empty local/preview databases, while the production workflow separately
-- requires exactly two rows before the provider column exists. Every check here
-- is data-independent: immutable migration evidence plus the schema contract.
-- Current payment rows are not asserted — future Korpay rows must not break
-- every deploy, and the 2026-11-18 production test-data cleanup removed all
-- payments (including the two launch-day Toss rows) on purpose.

select 1 / case when (
  select before_total = 2
    and before_null = 2
    and updated_count = 2
    and after_total = 2
    and after_toss = 2
    and after_null = 0
  from private.payment_migration_evidence
  where migration_name = '20260813182100_provider_neutral_payment_ledger'
) then 1 else 0 end as assert_production_provider_backfill_evidence;

-- Every current and future payment carries an explicit provider: the column
-- stays NOT NULL regardless of how many rows exist.
select 1 / case when (
  select a.attnotnull
  from pg_catalog.pg_attribute a
  where a.attrelid = 'public.payments'::regclass
    and a.attname = 'provider'
    and not a.attisdropped
) then 1 else 0 end as assert_payments_require_explicit_provider;

select
  count(*) as payment_count,
  count(*) filter (where provider = 'toss') as toss_count,
  count(*) filter (where provider = 'korpay') as korpay_count
from public.payments;

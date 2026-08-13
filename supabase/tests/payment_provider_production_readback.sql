-- Production-specific readback for #204. The reusable migration does not
-- hard-code this count; this evidence query intentionally locks the verified
-- pre-deploy expectation of two legacy Toss payments.

select 1 / case when (
  select count(*) = 2
    and count(*) filter (where provider = 'toss') = 2
    and count(*) filter (where provider is null) = 0
    and count(*) filter (where provider <> 'toss') = 0
  from public.payments
) then 1 else 0 end as assert_production_legacy_payments_backfilled_only_to_toss;

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

select
  count(*) as payment_count,
  count(*) filter (where provider = 'toss') as toss_count,
  count(*) filter (where provider = 'korpay') as korpay_count
from public.payments;

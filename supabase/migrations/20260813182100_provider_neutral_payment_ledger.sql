-- ============================================================================
-- Provider-neutral payment ledger foundation
--
-- This is an expand-only migration. Existing checkout/confirm RPCs omit the
-- provider column and therefore continue to create Toss rows through the
-- compatibility default. Provider adapters and new checkout behavior land in
-- later tickets.
-- ============================================================================

create type public.payment_provider as enum ('toss', 'korpay');
alter type public.payment_purpose add value 'prize_sale';
create type public.payment_attempt_state as enum (
  'prepared',
  'confirming',
  'approved',
  'declined',
  'canceled',
  'unknown',
  'needs_review'
);

-- Types are not ambient public APIs. Only the roles that consume the safe
-- summary or server-only attempt table receive USAGE explicitly.
revoke all on type public.payment_provider
  from public, anon, authenticated, service_role;
grant usage on type public.payment_provider to authenticated, service_role;

revoke all on type public.payment_attempt_state
  from public, anon, authenticated, service_role;
grant usage on type public.payment_attempt_state to service_role;

-- Existing deployed rows have only been written by the Toss path. Backfill
-- before enforcing the compatibility default and NOT NULL contract.
alter table public.payments
  add column provider public.payment_provider;

create schema if not exists private;

create function private.assert_payment_provider_backfill_count(
  candidate_count bigint
)
returns void
language plpgsql
set search_path = ''
as $function$
begin
  if candidate_count is null or candidate_count not in (0, 2) then
    raise exception using
      errcode = '23514',
      message = 'payment provider backfill requires zero rows or exactly two rows',
      detail = format('observed_count=%s', candidate_count);
  end if;
end;
$function$;

revoke all on function private.assert_payment_provider_backfill_count(bigint)
  from public, anon, authenticated, service_role;

create table private.payment_migration_evidence (
  migration_name text primary key,
  before_total bigint not null check (before_total in (0, 2)),
  before_null bigint not null check (before_null >= 0),
  updated_count bigint not null check (updated_count >= 0),
  after_total bigint not null check (after_total >= 0),
  after_toss bigint not null check (after_toss >= 0),
  after_null bigint not null check (after_null >= 0),
  recorded_at timestamptz not null default now()
);

alter table private.payment_migration_evidence enable row level security;

do $payment_provider_backfill$
declare
  before_total bigint;
  before_null bigint;
  updated_count bigint;
  after_total bigint;
  after_toss bigint;
  after_null bigint;
begin
  -- Keep the approved-count read and the backfill in one write-excluding
  -- critical section. This closes the gap between workflow preflight and the
  -- migration itself if another legacy Toss row appears before db push.
  lock table public.payments in access exclusive mode;

  select count(*), count(*) filter (where provider is null)
  into before_total, before_null
  from public.payments;

  perform private.assert_payment_provider_backfill_count(before_total);

  update public.payments
  set provider = 'toss'
  where provider is null;
  get diagnostics updated_count = row_count;

  select
    count(*),
    count(*) filter (where provider = 'toss'),
    count(*) filter (where provider is null)
  into after_total, after_toss, after_null
  from public.payments;

  if updated_count <> before_null
    or after_total <> before_total
    or after_toss <> before_total
    or after_null <> 0
  then
    raise exception using
      errcode = '23514',
      message = 'payment provider backfill invariant failed',
      detail = format(
        'before_total=%s before_null=%s updated=%s after_total=%s after_toss=%s after_null=%s',
        before_total,
        before_null,
        updated_count,
        after_total,
        after_toss,
        after_null
      );
  end if;

  insert into private.payment_migration_evidence (
    migration_name,
    before_total,
    before_null,
    updated_count,
    after_total,
    after_toss,
    after_null
  )
  values (
    '20260813182100_provider_neutral_payment_ledger',
    before_total,
    before_null,
    updated_count,
    after_total,
    after_toss,
    after_null
  );

  raise notice 'payment provider backfill verified: before_total=%, updated=%, after_toss=%',
    before_total, updated_count, after_toss;
end;
$payment_provider_backfill$;

alter table public.payments
  alter column provider set default 'toss',
  alter column provider set not null;

create table public.payment_attempts (
  id                    uuid primary key default extensions.gen_random_uuid(),
  provider              public.payment_provider not null,
  user_id               uuid not null references public.profiles (id),
  purpose               public.payment_purpose not null,
  ref_id                uuid,
  amount                bigint not null check (amount >= 0),
  currency              text not null default 'KRW'
                        check (currency ~ '^[A-Z]{3}$'),
  state                 public.payment_attempt_state not null default 'prepared',
  idempotency_key       text not null unique
                        check (
                          idempotency_key = btrim(idempotency_key)
                          and length(idempotency_key) between 1 and 200
                        ),
  provider_order_id     text not null,
  provider_product_code text not null,
  payment_id            uuid unique references public.payments (id),
  claim_token           uuid,
  claim_expires_at      timestamptz,
  expires_at            timestamptz not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint payment_attempts_provider_order_id_valid check (
    provider_order_id = btrim(provider_order_id)
    and length(provider_order_id) between 1 and 200
  ),
  constraint payment_attempts_provider_product_code_valid check (
    provider_product_code = btrim(provider_product_code)
    and length(provider_product_code) between 1 and 200
  ),
  constraint payment_attempts_claim_lease_complete check (
    (claim_token is null) = (claim_expires_at is null)
  ),
  constraint payment_attempts_confirming_has_claim check (
    state <> 'confirming' or claim_token is not null
  ),
  unique (provider, provider_order_id),
  unique (provider, provider_product_code)
);

create trigger trg_payment_attempts_updated
before update on public.payment_attempts
for each row execute function public.set_updated_at();

create index payment_attempts_reference_idx
  on public.payment_attempts (purpose, ref_id);
create index payment_attempts_user_created_idx
  on public.payment_attempts (user_id, created_at desc);
create index payment_attempts_open_expiry_idx
  on public.payment_attempts (state, expires_at)
  where state in ('prepared', 'confirming', 'unknown', 'needs_review');
create index payment_attempts_claim_expiry_idx
  on public.payment_attempts (claim_expires_at)
  where claim_expires_at is not null;

alter table public.payment_attempts enable row level security;

-- No client policy is intentional. Provider attempts are manipulated only by
-- trusted server code; RLS remains a second barrier if grants drift.
revoke all on table public.payment_attempts
  from public, anon, authenticated, service_role;
grant select, insert, update on table public.payment_attempts to service_role;

create table private.payment_provider_evidence (
  id                          uuid primary key default extensions.gen_random_uuid(),
  payment_attempt_id          uuid not null
                              references public.payment_attempts (id),
  evidence_kind               text not null
                              check (evidence_kind ~ '^[a-z][a-z0-9_]{0,49}$'),
  provider_payment_key        text,
  provider_transaction_id     text,
  provider_approval_reference text,
  result_code                 text,
  payment_method              text,
  masked_payment_method       text,
  approved_at                 timestamptz,
  recorded_at                 timestamptz not null default now(),
  constraint payment_provider_evidence_payment_key_valid check (
    provider_payment_key is null
    or (
      provider_payment_key = btrim(provider_payment_key)
      and length(provider_payment_key) between 1 and 200
    )
  ),
  constraint payment_provider_evidence_transaction_id_valid check (
    provider_transaction_id is null
    or (
      provider_transaction_id = btrim(provider_transaction_id)
      and length(provider_transaction_id) between 1 and 200
    )
  ),
  constraint payment_provider_evidence_approval_reference_valid check (
    provider_approval_reference is null
    or (
      provider_approval_reference = btrim(provider_approval_reference)
      and length(provider_approval_reference) between 1 and 200
    )
  ),
  constraint payment_provider_evidence_result_code_valid check (
    result_code is null
    or (
      result_code = btrim(result_code)
      and length(result_code) between 1 and 50
    )
  ),
  constraint payment_provider_evidence_payment_method_valid check (
    payment_method is null
    or (
      payment_method = btrim(payment_method)
      and length(payment_method) between 1 and 50
    )
  ),
  constraint payment_provider_evidence_masked_method_valid check (
    masked_payment_method is null
    or (
      masked_payment_method = btrim(masked_payment_method)
      and length(masked_payment_method) between 1 and 100
    )
  )
);

create index payment_provider_evidence_attempt_idx
  on private.payment_provider_evidence (payment_attempt_id, recorded_at, id);

alter table private.payment_provider_evidence enable row level security;

-- private is not an exposed Data API schema. A direct service_role connection
-- can append/read allowlisted evidence; updates and deletes remain forbidden so
-- reconciliations add evidence instead of rewriting history.
grant usage on schema private to service_role;
revoke all on table private.payment_migration_evidence
  from public, anon, authenticated, service_role;
grant select on table private.payment_migration_evidence to service_role;
revoke all on table private.payment_provider_evidence
  from public, anon, authenticated, service_role;
grant select, insert on table private.payment_provider_evidence to service_role;

-- Browser and staff readers move to one named safe surface. security_invoker
-- makes the existing owner/staff payments RLS policy apply to the caller.
create view public.payment_summaries
with (security_invoker = true)
as
select
  payment.id,
  payment.user_id,
  payment.purpose,
  payment.ref_id,
  payment.provider,
  payment.amount,
  payment.status,
  payment.created_at
from public.payments as payment;

revoke all on table public.payment_summaries
  from public, anon, authenticated, service_role;
grant select on table public.payment_summaries to authenticated, service_role;

-- A security-invoker view still requires underlying column privileges. That
-- means authenticated callers can technically SELECT these same safe columns
-- from the base table under owner/staff RLS; the security contract is no
-- table-wide SELECT and no provider keys, idempotency data, raw evidence, or
-- write privileges. payment_summaries remains the canonical application API.
revoke all on table public.payments
  from public, anon, authenticated;
grant select (
  id,
  user_id,
  purpose,
  ref_id,
  provider,
  amount,
  status,
  created_at
) on table public.payments to authenticated;

grant select, insert, update, delete on table public.payments to service_role;

-- The only migration helper lives in private and has EXECUTE revoked from every
-- application role. Future attempt/evidence RPCs must likewise revoke PUBLIC,
-- anon, authenticated, and service_role before granting their intended caller.

#!/usr/bin/env bash

set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
run_psql() {
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
}
# 음성 계약: 다른 이유(문법·권한 오류)가 아니라 readback 단언(1/0)으로 실패해야 한다.
expect_assertion_failure() {
  local label="$1" output
  if output="$(run_psql 2>&1)"; then
    echo "payment provider readback accepted ${label}" >&2
    exit 1
  fi
  if ! grep -q 'division by zero' <<<"$output"; then
    printf 'payment provider readback failed for another reason (%s):\n%s\n' "$label" "$output" >&2
    exit 1
  fi
}

# 1. 이관 직후 운영 모양(토스 이력 2건)에서 통과한다.
{
  cat supabase/tests/payment_provider_production_readback_contract.sql
  cat supabase/tests/payment_provider_production_readback.sql
  printf '%s\n' 'rollback;'
} | run_psql

# 2. 결제 행이 하나도 없어도 통과한다 — 2026-11-18 운영 테스트 데이터 정리가 결제를 전부 지웠고,
#    readback 은 지워질 수 있는 현재 행이 아니라 불변 이관 증거와 스키마 계약만 본다.
#    같은 정의의 빈 테이블로 바꿔 끼운 뒤 rollback 한다(트리거·FK 를 건드리지 않는다).
{
  cat supabase/tests/payment_provider_production_readback_contract.sql
  printf '%s\n' \
    'alter table public.payments rename to payments_readback_contract_hidden;' \
    'create table public.payments (like public.payments_readback_contract_hidden including all);' \
    'select 1 / case when (select count(*) = 0 from public.payments) then 1 else 0 end as assert_empty_ledger_fixture;'
  cat supabase/tests/payment_provider_production_readback.sql
  printf '%s\n' 'rollback;'
} | run_psql

# 3. provider 가 NULL 을 받게 되면 실패한다(스키마 계약이 실제로 검사된다는 증거).
{
  cat supabase/tests/payment_provider_production_readback_contract.sql
  printf '%s\n' 'alter table public.payments alter column provider drop not null;'
  cat supabase/tests/payment_provider_production_readback.sql
  printf '%s\n' 'rollback;'
} | expect_assertion_failure 'a nullable provider column'

# 4. 이관 증거가 기대와 다르면 실패한다.
{
  cat supabase/tests/payment_provider_production_readback_contract.sql
  printf '%s\n' "update private.payment_migration_evidence set updated_count = 1 where migration_name = '20260813182100_provider_neutral_payment_ledger';"
  cat supabase/tests/payment_provider_production_readback.sql
  printf '%s\n' 'rollback;'
} | expect_assertion_failure 'mismatched migration evidence'

echo 'payment provider production readback contract: ok'

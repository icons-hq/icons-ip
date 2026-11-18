#!/usr/bin/env bash

set -euo pipefail

container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
run_psql() {
  docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1
}

# 1. 공개 카탈로그를 anon 으로 읽을 수 있으면 통과한다(내용은 보지 않는다).
run_psql < supabase/tests/catalog_public_read_canary.sql

# 2. 카탈로그 행이 하나도 없어도 통과한다 — 운영은 2026-11-18 시연 카탈로그를 지우고 실상품을 새로 등록한다.
#    같은 정의의 빈 테이블로 바꿔 끼우고 원래 권한을 그대로 옮긴 뒤 rollback 한다.
{
  printf '%s\n' \
    'begin;' \
    'alter table public.goods rename to goods_canary_contract_hidden;' \
    'create table public.goods (like public.goods_canary_contract_hidden including all);' \
    'grant select on public.goods to anon, authenticated;' \
    'select 1 / case when (select count(*) = 0 from public.goods) then 1 else 0 end as assert_empty_catalog_fixture;'
  cat supabase/tests/catalog_public_read_canary.sql
  printf '%s\n' 'rollback;'
} | run_psql

# 3. anon 의 읽기 권한이 사라지면 실패한다 — 다른 이유가 아니라 권한 거부여야 한다.
output="$({
  printf '%s\n' 'begin;' 'revoke select on public.goods from anon, public;'
  cat supabase/tests/catalog_public_read_canary.sql
  printf '%s\n' 'rollback;'
} | run_psql 2>&1)" && {
  echo 'catalog public read canary accepted a revoked anon grant' >&2
  exit 1
}
if ! grep -q 'permission denied' <<<"$output"; then
  printf 'catalog public read canary failed for another reason:\n%s\n' "$output" >&2
  exit 1
fi

echo 'catalog public read canary contract: ok'

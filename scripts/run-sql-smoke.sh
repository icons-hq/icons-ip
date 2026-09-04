#!/bin/bash
# 로컬 SQL 스모크 — CI 파이프라인이 돌리는 것과 **같은 목록**을 같은 순서로 돌린다.
#
# 목록을 따로 두지 않고 `.github/workflows/pipeline.yml` 에서 뽑는 이유: 두 곳에 두면
# 새 테스트를 CI 에만 넣거나 여기에만 넣는 일이 생기고, 그때부터 로컬 초록은 뜻이 없다.
#
# 쓰는 법: supabase 로컬이 떠 있는 상태에서 `bash scripts/run-sql-smoke.sh`
#          `bash scripts/run-sql-smoke.sh export_jobs` 처럼 이름 조각을 주면 그것만 돌린다.
#
# `payment_provider_production_readback.sql` 하나는 빠진다 — 그건 로컬이 아니라 연결된
# 클라우드 프로젝트(`supabase db query --linked`)를 보는 별도 잡이라 여기서 돌 수 없다.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

filter="${1:-}"
pass=0
fail=0
failed=()

# 목록은 fd 3 으로 읽는다 — `docker exec -i` 와 동시성 스크립트가 stdin 을 먹어서
# 기본 stdin 으로 돌리면 목록이 중간에 삼켜지고 몇 개만 돈다(실제로 그랬다).
while IFS= read -r -u 3 cmd; do
  name=$(sed -E 's|.*(supabase/tests/[^ ]+).*|\1|' <<<"$cmd")
  [[ -n "$filter" && "$name" != *"$filter"* ]] && continue
  if bash -c "$cmd" >/tmp/sql-smoke.log 2>&1; then
    pass=$((pass + 1))
  else
    fail=$((fail + 1))
    failed+=("$name")
    echo "FAIL $name"
    grep -m3 -i "error" /tmp/sql-smoke.log
  fi
done 3< <(
  grep -oE '(docker exec -i supabase_db_icons-ip psql[^\n]*< supabase/tests/[A-Za-z0-9_.-]+\.sql|bash supabase/tests/[A-Za-z0-9_.-]+\.sh)' \
    .github/workflows/pipeline.yml
)

echo "PASS=$pass FAIL=$fail"
[[ ${#failed[@]} -gt 0 ]] && printf '%s\n' "${failed[@]}"
exit $((fail > 0))

#!/usr/bin/env bash
set -euo pipefail
# QNA-028 택배 추적 자동 배송완료와 운영자 일괄 배송완료의 2세션 경합(교착 없음). 고른 테스트 컨테이너의 postgres DB는 바꾸지 않고
# 일회용 복제 DB에서만 돈다.
test_container="${SUPABASE_DB_CONTAINER:?Select a CI or disposable local test container}"
test_scope="${DELIVERY_TRACKING_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
case "$test_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected local Supabase DB container' >&2; exit 1;; esac
test_database="icons_delivery_tracking_concurrency_$(date +%s)_$$"
test_dir="$(mktemp -d)"
test_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_created=false
cleanup() {
  local result=$?
  if "$test_created"; then
    if ! docker exec "$test_container" dropdb -U postgres --force "$test_database"; then
      echo "Failed to clean disposable database: $test_database" >&2
      result=1
    fi
  fi
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
docker exec "$test_container" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
# pg_cron can be installed only in its configured postgres database. The race calls the run directly.
python3 - "$test_dir/restore.list" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text('\n'.join(line for line in path.read_text().splitlines() if not any(word in line.split() for word in ('cron', 'pg_cron'))) + '\n')
PY
docker exec "$test_container" createdb -U postgres "$test_database"
test_created=true
docker cp "$test_dir/restore.list" "$test_container:/tmp/$test_database.list" >/dev/null
docker exec -i "$test_container" pg_restore -U supabase_admin -d "$test_database" --exit-on-error -L "/tmp/$test_database.list" < "$test_dir/base.dump"
docker exec "$test_container" rm "/tmp/$test_database.list"
SUPABASE_DB_CONTAINER="$test_container" PGDATABASE="$test_database" python3 "$test_script_dir/delivery_tracking_concurrency.py"

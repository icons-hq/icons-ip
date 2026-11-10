#!/usr/bin/env bash
set -euo pipefail
# Only a private clone is writable; the selected source postgres DB is read-only.
test_container="${SUPABASE_DB_CONTAINER:?Select a CI or isolated local Supabase DB container}"
test_scope="${CATEGORY_DISPLAY_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported category display test scope' >&2; exit 1;; esac
case "$test_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected Supabase DB container' >&2; exit 1;; esac
test_database="icons_category_display_concurrency_$(date +%s)_$$"
test_dir="$(mktemp -d)"
test_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_created=false
cleanup() {
  local result=$?
  trap - EXIT
  if "$test_created"; then
    if ! docker exec "$test_container" dropdb -U postgres --force "$test_database"; then
      echo "Failed to remove category display test clone: $test_database" >&2
      result=1
    fi
  fi
  docker exec "$test_container" rm -f "/tmp/$test_database.list" >/dev/null 2>&1 || result=1
  rm -rf -- "$test_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 - "$test_container" <<'PY'
import json,re,subprocess,sys
container=sys.argv[1]
assert re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+',container)
identity=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .}}',container],text=True))
assert identity['State']['Running'] and identity['Config']['Labels']['com.supabase.cli.project']==container.removeprefix('supabase_db_')
PY
docker exec "$test_container" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
# pg_cron is bound to postgres and must not run in a disposable test copy.
python3 - "$test_dir/restore.list" <<'PY'
from pathlib import Path
import sys
path=Path(sys.argv[1])
path.write_text('\n'.join(line for line in path.read_text().splitlines() if not any(word in line.split() for word in ('cron','pg_cron'))) + '\n')
PY
docker exec "$test_container" createdb -U postgres "$test_database"
test_created=true
docker cp "$test_dir/restore.list" "$test_container:/tmp/$test_database.list" >/dev/null
docker exec -i "$test_container" pg_restore -U supabase_admin -d "$test_database" --exit-on-error -L "/tmp/$test_database.list" < "$test_dir/base.dump"
# The five races do not inspect OID-bound contract receipts. Preserve all owners,
# ACLs and registry rows exactly as restored; no receipt rebind is necessary.
CATEGORY_DISPLAY_TEST_SCOPE="$test_scope" python3 "$test_script_dir/category_display_concurrency.py" "$test_container" "$test_database" "$test_dir/results"
test_container_id="$(docker inspect --format '{{.Id}}' "$test_container")"
CATEGORY_DISPLAY_TEST_SCOPE="$test_scope" python3 "$test_script_dir/category_display_tree_concurrency.py" "$test_container_id" "$test_database" "$test_dir/tree-results"

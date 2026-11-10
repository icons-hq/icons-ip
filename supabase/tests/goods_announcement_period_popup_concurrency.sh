#!/usr/bin/env bash
set -euo pipefail
# Clone the explicitly selected local test container; never mutate its postgres DB.
test_container="${SUPABASE_DB_CONTAINER:?Select a CI or disposable local test container}"
test_scope="${GOODS_ANNOUNCEMENT_POPUP_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
case "$test_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected local Supabase DB container' >&2; exit 1;; esac
test_database="icons_notice_popup_race_$(date +%s)_$$"
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
python3 "$test_script_dir/goods_announcement_period_popup_clone_fingerprint.py" "$test_container" postgres "$test_dir/source-canonical.json"
docker exec "$test_container" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
# pg_cron can be installed only in its configured postgres database. Tests use
# no cron jobs, so leave scheduled background work out of this disposable copy.
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
python3 "$test_script_dir/goods_announcement_period_popup_clone_fingerprint.py" "$test_container" "$test_database" "$test_dir/clone-canonical.json"
cmp "$test_dir/source-canonical.json" "$test_dir/clone-canonical.json"
echo "PASS source/clone canonical definitions, owners, ACLs and RLS predicates match before OID metadata rebinding"
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q <<'SQL'
do $$declare contract record;begin
 for contract in select signature from private.operator_internal_contracts loop
  perform private.register_operator_internal_contract(contract.signature::regprocedure);
 end loop;
 for contract in select * from private.operator_policy_contracts loop
  perform private.register_operator_policy_contract(format('%I.%I',contract.schema_name,contract.table_name)::regclass,contract.policy_name,contract.capability);
 end loop;
end $$;
SQL
if [[ -n "${GOODS_ANNOUNCEMENT_POPUP_DRAFT_MIGRATION:-}" ]]; then
  SUPABASE_DB_CONTAINER="$test_container" PGDATABASE="$test_database" python3 "$test_script_dir/goods_announcement_period_popup_migration_compat.py" "$GOODS_ANNOUNCEMENT_POPUP_DRAFT_MIGRATION" "${GOODS_ANNOUNCEMENT_POPUP_DRAFT_SHA:?Reviewed SHA required}"
fi
cat "$test_script_dir/helpers/goods_kc_fixture.sql" "$test_script_dir/goods_announcement_period_popup.sql" "$test_script_dir/operator_capability_coverage.sql" | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
if [[ "${GOODS_ANNOUNCEMENT_POPUP_FUNCTIONAL_ONLY:-false}" != "true" ]]; then
  SUPABASE_DB_CONTAINER="$test_container" PGDATABASE="$test_database" python3 "$test_script_dir/goods_announcement_period_popup_concurrency.py"
fi

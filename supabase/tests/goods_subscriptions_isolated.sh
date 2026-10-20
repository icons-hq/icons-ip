#!/usr/bin/env bash
set -euo pipefail
# Clone the explicitly selected local test container; never mutate its postgres DB.
test_container="${SUPABASE_DB_CONTAINER:?Select a CI or disposable local test container}"
test_scope="${SUBSCRIPTION_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
case "$test_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected local Supabase DB container' >&2; exit 1;; esac
test_container_id="$(python3 - "$test_container" <<'PY'
import json,re,subprocess,sys
container=sys.argv[1]
assert re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+',container)
identity=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .}}',container],text=True))
assert identity['State']['Running'] and identity['Config']['Labels']['com.supabase.cli.project']==container.removeprefix('supabase_db_')
assert identity['Name']=='/'+container and re.fullmatch(r'[a-f0-9]{64}',identity['Id'])
print(identity['Id'])
PY
)"
test_database="icons_subscriptions_$(date +%s)_$$"
test_dir="$(mktemp -d)"
test_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
test_created=false
test_original_ledger=""
ledger_hash() {
  docker exec "$test_container_id" psql -X -qAt -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c     "COPY (SELECT to_jsonb(m)::text FROM supabase_migrations.schema_migrations m ORDER BY version) TO STDOUT" |
    python3 -c 'import hashlib,sys; print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
}
cleanup() {
  local result=$?
  trap - EXIT
  if "$test_created"; then
    if ! docker exec "$test_container_id" dropdb -U postgres --force "$test_database"; then
      echo "Failed to clean disposable database: $test_database" >&2
      result=1
    fi
  fi
  docker exec "$test_container_id" rm -f "/tmp/$test_database.list" >/dev/null || result=1
  if [ -n "$test_original_ledger" ]; then
    local final_ledger
    if ! final_ledger="$(ledger_hash)" || [ "$final_ledger" != "$test_original_ledger" ]; then
      echo "Source migration ledger changed or could not be verified" >&2
      result=1
    else
      echo "PASS source migration ledger unchanged: $final_ledger"
    fi
  fi
  rm -rf "$test_dir"
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
test_original_ledger="$(ledger_hash)"
echo "Source container: $test_container ($test_container_id)"
echo "Source migration ledger SHA-256: $test_original_ledger"
# Normal execution requires a fully migrated source. This runner deliberately
# never applies draft migrations; CI and local migration validation own that step.
docker exec -i "$test_container_id" psql -X -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<'SQL'
do $$
begin
  if (select count(*) from supabase_migrations.schema_migrations where version in
    ('20261014004950','20261014010252','20261014011902','20261014024634','20261014034238')) <> 5 then
    raise exception 'Apply all goods transaction and subscription migrations before running isolated tests';
  end if;
  if to_regclass('private.goods_transaction_runtime') is null
    or to_regclass('private.order_goods_transactions') is null
    or to_regclass('private.goods_subscription_plans') is null
    or to_regprocedure('public.admin_list_goods_subscriptions(uuid,text,text,integer,integer)') is null
    or to_regprocedure('private.subscription_retention_display(jsonb,timestamp with time zone)') is null then
    raise exception 'Required goods transaction and subscription schema is missing';
  end if;
end $$;
SQL
docker exec "$test_container_id" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container_id" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
# pg_cron can be installed only in its configured postgres database. Tests use
# no cron jobs, so leave scheduled background work out of this disposable copy.
python3 - "$test_dir/restore.list" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text('\n'.join(line for line in path.read_text().splitlines() if not any(word in line.split() for word in ('cron', 'pg_cron'))) + '\n')
PY
docker exec "$test_container_id" createdb -U postgres "$test_database"
test_created=true
docker cp "$test_dir/restore.list" "$test_container_id:/tmp/$test_database.list" >/dev/null
docker exec -i "$test_container_id" pg_restore -U supabase_admin -d "$test_database" --exit-on-error -L "/tmp/$test_database.list" < "$test_dir/base.dump"
docker exec "$test_container_id" rm "/tmp/$test_database.list"
docker exec -i "$test_container_id" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 < "$test_script_dir/goods_subscriptions.sql"

cat "$test_script_dir/helpers/goods_kc_fixture.sql" "$test_script_dir/goods_subscriptions_transactions.sql" | docker exec -i "$test_container_id" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1

cat "$test_script_dir/helpers/goods_kc_fixture.sql" "$test_script_dir/goods_subscriptions_console.sql" | docker exec -i "$test_container_id" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1

SUBSCRIPTION_TEST_CONTAINER_ID="$test_container_id" PGDATABASE="$test_database" python3 "$test_script_dir/goods_subscriptions_concurrency.py"

#!/usr/bin/env bash
set -euo pipefail
# Explicitly clone a local validation database, excluding cron. The source
# postgres database is read only throughout this script; cleanup owns only the
# freshly created icons_goods_transaction_* database and its temporary files.
test_container_name="${SUPABASE_DB_CONTAINER:?Select a local validation container}"
test_scope="${GOODS_TRANSACTION_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
if [[ "$test_scope" == ci && ( "${CI:-}" != true || "${GITHUB_ACTIONS:-}" != true || "$test_container_name" != supabase_db_icons-ip ) ]]; then
 echo 'CI scope requires GitHub Actions and the exact icons-ip project' >&2; exit 1
fi
# Validate every explicit draft and the exact identity before dump/createdb.
# All database operations after this point use the immutable full container ID.
test_container="$(python3 - "$test_container_name" "$@" <<'PYIDENTITY'
import json,re,subprocess,sys
from pathlib import Path
name=sys.argv[1]
if not re.fullmatch(r'supabase_db_icons-ip(?:-[a-z0-9]+)*',name):raise SystemExit('Expected an exact local ICONS IP Supabase container name')
seen=set();migration_dir=(Path.cwd()/'supabase/migrations').resolve()
for value in sys.argv[2:]:
 path=Path(value)
 if (not re.fullmatch(r'supabase/migrations/[0-9]{14}_(?:goods_transaction[a-z0-9_]*|recurring_billing_and_goods_subscriptions|gift_delivery_owner_boundary|goods_subscription_contract_retention|goods_subscription_operations_console|bank_transfer_refund_lifecycle|goods_aggregation_families|goods_groups_and_variant_conversion|group_claim_stock_successions|goods_group_common_information|order_claim_contact_corrections)\.sql',value)
  or not path.is_file() or path.resolve().parent!=migration_dir or value in seen):raise SystemExit('Expected an explicit unique goods transaction migration file')
 seen.add(value)
identity=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .}}',name],text=True))
if (not re.fullmatch(r'[0-9a-f]{64}',str(identity.get('Id',''))) or identity.get('Name')!='/'+name
 or identity.get('State',{}).get('Running') is not True
 or identity.get('Config',{}).get('Labels',{}).get('com.supabase.cli.project')!=name.removeprefix('supabase_db_')):raise SystemExit('Docker Supabase project identity mismatch')
print(identity['Id'])
PYIDENTITY
)"
test_container_id="$test_container"
test_project="${test_container_name#supabase_db_}"
test_clone_lease="$(python3 -c 'import uuid;print(uuid.uuid4())')"
test_database="icons_goods_transaction_${test_clone_lease//-/}"
test_dir="$(mktemp -d)"
test_created=false
source_history=''
source_ledger_sha() {
 docker exec "$test_container" psql -X -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 \
  -c "select coalesce(jsonb_agg(to_jsonb(ledger) order by version),'[]'::jsonb) from supabase_migrations.schema_migrations ledger" \
  | python3 -c 'import hashlib,sys;print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest())'
}
cleanup() {
 local result=$?
 trap - EXIT INT TERM
 if "$test_created"; then
  if ! docker exec "$test_container" dropdb -U postgres --force "$test_database"; then
   echo "Failed to clean disposable database: $test_database" >&2; result=1
  fi
 fi
 docker exec "$test_container" rm -f "/tmp/$test_database.list" >/dev/null 2>&1 || result=1
 rm -rf "$test_dir"
 if [[ -n "$source_history" ]]; then
  local final_history
  if ! final_history="$(source_ledger_sha)" || [[ "$final_history" != "$source_history" ]]; then
   echo 'Source complete migration ledger changed or could not be verified during clone cleanup' >&2; result=1
  fi
 fi
 exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
source_history="$(source_ledger_sha)"
if [[ $# -eq 0 ]]; then
 docker exec "$test_container" psql -X -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 \
  -c "begin read only; select 1 / case when not exists(select 1 from unnest(array['20261014041322','20261014042553','20261014045529','20261014054956','20261014061741','20261014061931','20261014062545','20261014071135','20261014092811']) required(version) where not exists(select 1 from supabase_migrations.schema_migrations applied where applied.version=required.version)) then 1 else 0 end as assert_current_financial_chain_applied; rollback;"
fi
docker exec "$test_container" pg_dump -U postgres -d postgres -Fc > "$test_dir/base.dump"
docker exec -i "$test_container" pg_restore -l < "$test_dir/base.dump" > "$test_dir/restore.list"
python3 - "$test_dir/restore.list" <<'PY'
from pathlib import Path
import sys
path = Path(sys.argv[1])
path.write_text('\n'.join(line for line in path.read_text().splitlines() if not any(word in line.split() for word in ('cron', 'pg_cron'))) + '\n')
PY
docker exec "$test_container" createdb -U postgres "$test_database"
test_created=true
echo "Owned goods transaction clone: $test_database; lease $test_clone_lease; container $test_container_id"
docker cp "$test_dir/restore.list" "$test_container:/tmp/$test_database.list" >/dev/null
docker exec -i "$test_container" pg_restore -U supabase_admin -d "$test_database" --exit-on-error -L "/tmp/$test_database.list" < "$test_dir/base.dump"
docker exec -i "$test_container_id" psql -X -U postgres -d "$test_database" -v ON_ERROR_STOP=1 -q \
 -v "clone_lease=$test_clone_lease" -v "clone_container_id=$test_container_id" <<'SQL'
create table private.operator_fixture_clone_identity(singleton boolean primary key check(singleton),lease uuid not null,container_id text not null,source_database text not null,created_at timestamptz not null);
alter table private.operator_fixture_clone_identity enable row level security;
revoke all on private.operator_fixture_clone_identity from public,anon,authenticated,service_role;
insert into private.operator_fixture_clone_identity values(true,:'clone_lease'::uuid,:'clone_container_id','postgres',clock_timestamp());
SQL
for draft in "$@"; do
 docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < "$draft"
done
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q <<'SQL'
select 1/case when to_regprocedure('public.get_my_order_claim_refund_account_context(uuid,uuid,uuid,uuid)') is not null
 and to_regprocedure('public.set_my_order_claim_refund_account(uuid,uuid,uuid,integer,text,text,text,uuid,uuid)') is not null
 and to_regprocedure('public.read_my_order_claim_refund_account_operation(uuid,uuid,uuid,integer,uuid,uuid,boolean)') is not null
 and to_regprocedure('public.admin_bank_transfer_refund_context(uuid,uuid,uuid,uuid)') is not null
 and to_regprocedure('public.admin_confirm_goods_group_conversion(uuid,uuid,uuid,uuid)') is not null
 and to_regprocedure('private.resolve_goods_stock_successor(text,uuid)') is not null
 and to_regprocedure('public.admin_save_goods_group_common(uuid,bigint,jsonb,uuid,uuid,uuid)') is not null
 and to_regprocedure('public.service_change_order_claim_contact(uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,jsonb,text,text,boolean)') is not null
 and to_regprocedure('private.record_order_claim_reshipment_physical(uuid,text,text,jsonb)') is not null
 then 1 else 0 end as assert_payer_refund_account_contract_is_required;
SQL
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/goods_transaction_terms.sql
if [[ -f supabase/tests/goods_transaction_math_oracle.py ]]; then
 SUPABASE_DB_CONTAINER="$test_container" PGDATABASE="$test_database" python3 supabase/tests/goods_transaction_math_oracle.py
fi
if docker exec "$test_container" psql -X -U postgres -d "$test_database" -At -c "select to_regprocedure('public.quote_cart_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,bigint)') is not null" | rg -q '^t$'; then
 cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/goods_transaction_checkout.sql | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
 cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/goods_transaction_large_cart.sql | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
 cat supabase/tests/helpers/goods_kc_fixture.sql supabase/tests/goods_sale_period.sql | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
 OPERATOR_LEGACY_FIXTURE_TEST_SCOPE=1 node scripts/with-legacy-operator-fixtures.mjs --project "$test_project" --container "$test_container_name" --database "$test_database" --clone-lease "$test_clone_lease" -- bash supabase/tests/goods_transaction_legacy.sh
fi
if docker exec "$test_container" psql -X -U postgres -d "$test_database" -At -c "select to_regprocedure('public.admin_get_order_shipping_collect(uuid)') is not null" | rg -q '^t$'; then
 python3 - <<'PYFIXTURE' | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
from pathlib import Path
checkout=Path('supabase/tests/goods_transaction_checkout.sql').read_text()
print(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text())
print(checkout.split("select public.request_order_cancellation(:'order_id'")[0])
print(Path('supabase/tests/goods_transaction_operations.sql').read_text())
PYFIXTURE
fi
if docker exec "$test_container" psql -X -U postgres -d "$test_database" -At -c "select to_regprocedure('public.service_cleanup_fenced_goods_transactions(uuid)') is not null" | rg -q '^t$'; then
 python3 - <<'PYACCOUNT' | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
from pathlib import Path
print(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text())
print(Path('supabase/tests/goods_transaction_checkout.sql').read_text().split("select public.request_order_cancellation(:'order_id'")[0])
print(Path('supabase/tests/goods_transaction_account_retention.sql').read_text())
PYACCOUNT
 GOODS_PROFILE_TEST=$(docker exec "$test_container" psql -X -U postgres -d "$test_database" -At -c "select to_regprocedure('public.admin_list_pg_settlement_accounts()') is not null") python3 - <<'PYSUBRETENTION' | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
from pathlib import Path
import os
source=Path('supabase/tests/goods_subscriptions_transactions.sql').read_text()
anchor="select private.purge_goods_subscription_account_data('b1714000-0000-4000-8000-000000000002');"
assert source.count(anchor)==1
replacement="""
set local role service_role;
select public.service_cleanup_fenced_goods_transactions('b1714000-0000-4000-8000-000000000002');
reset role;
select 1/case when (select count(*)=jsonb_array_length(:'full_retained_contract'::jsonb->'subscriptions') from private.account_deletion_legal_snapshots
 where deletion_event_id='b1714000-0000-4000-8000-000000000060' and record_type='subscription_contract')
 and not exists(select 1 from jsonb_array_elements(:'full_retained_contract'::jsonb->'subscriptions') expected where not exists(
  select 1 from private.account_deletion_legal_snapshots saved where saved.deletion_event_id='b1714000-0000-4000-8000-000000000060'
   and saved.record_type='subscription_contract' and saved.record_ref=expected->>'id' and saved.snapshot_data=expected))
 and not exists(select 1 from private.account_deletion_legal_snapshots where deletion_event_id='b1714000-0000-4000-8000-000000000060'
  and record_type='subscription_contract' and snapshot_data::text~'(PRIVATE-|01099887766|inputValues|billingKey|authKey|masked_number|address1|recipientName|envelope|customerKey)')
 and not exists(select 1 from private.goods_subscription_terms where plan_id in(:'plan_id'::uuid,'b1714810-0000-4000-8000-000000000001'::uuid))
 and not exists(select 1 from private.goods_subscription_operations where plan_id=:'plan_id'::uuid)
 then 1 else 0 end as assert_two_actual_legal_snapshots_equal_accepted_terms_after_source_purge;
set local role service_role;
select public.service_cleanup_fenced_goods_transactions('b1714000-0000-4000-8000-000000000002');
reset role;
select 1/case when not exists(select 1 from jsonb_array_elements(:'full_retained_contract'::jsonb->'subscriptions') expected where not exists(
 select 1 from private.account_deletion_legal_snapshots saved where saved.deletion_event_id='b1714000-0000-4000-8000-000000000060'
  and saved.record_type='subscription_contract' and saved.record_ref=expected->>'id' and saved.snapshot_data=expected))
 then 1 else 0 end as assert_cleanup_replay_preserves_legal_contract_snapshot;
"""
print(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text())
source=source.replace(anchor,replacement)
if os.environ.get('GOODS_PROFILE_TEST')=='t':
 source=source.rsplit('rollback;',1)[0]+Path('supabase/tests/goods_transaction_settlement_profiles.sql').read_text()+'\nrollback;\n'
print(source)
PYSUBRETENTION
 python3 - <<'PYGIFTSETTLED' | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
from pathlib import Path
anchor="select pg_temp.gift_assert(private.order_delivery_snapshot(:'order_id')->>'addressRevision'='1','private address revision advanced');"
source=Path('supabase/tests/gift_order_transactions.sql').read_text()
assert source.count(anchor)==1
print(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text())
print(Path('supabase/tests/gift_order_domain.sql').read_text().split('-- These two pending rows')[0])
print(source.split(anchor)[0]+anchor)
print(Path('supabase/tests/gift_order_operations.sql').read_text())
print(Path('supabase/tests/goods_transaction_gift_settled.sql').read_text())
PYGIFTSETTLED
fi
if docker exec "$test_container" psql -X -U postgres -d "$test_database" -At -c "select to_regprocedure('public.quote_cart_goods_transaction(uuid,jsonb,jsonb,jsonb,uuid,bigint)') is not null" | rg -q '^t$'; then
 SUPABASE_DB_CONTAINER="$test_container" PGDATABASE="$test_database" python3 supabase/tests/goods_transaction_concurrency.py
 docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/goods_order_readers_readonly.sql
fi
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/order_claim_refund_account.sql
python3 supabase/tests/order_claim_refund_account_concurrency.py "$test_container_id" "$test_database" "$test_dir/refund-account-races"
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/bank_transfer_refund_lifecycle.sql
python3 supabase/tests/bank_transfer_refund_http.py "$test_container_id" "$test_database" "$test_dir/bank-refund-http"
python3 supabase/tests/bank_transfer_refund_concurrency.py "$test_container_id" "$test_database" "$test_dir/bank-refund-races"
for group_test in goods_aggregation_families goods_group_conversion group_claim_stock_successions goods_group_common_information; do
 cat supabase/tests/helpers/goods_kc_fixture.sql "supabase/tests/$group_test.sql" | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
done
SUPABASE_DB_CONTAINER="$test_container_id" PGDATABASE="$test_database" GOODS_AGGREGATION_LEASE="$test_clone_lease" python3 supabase/tests/goods_aggregation_concurrency.py
python3 - <<'PYGROUPFIXTURE' | docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q
from pathlib import Path
print('create schema goods_group_edge_test;grant usage on schema goods_group_edge_test to authenticated,service_role;')
print(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.', 'goods_group_edge_test.'))
print(Path('supabase/tests/helpers/goods_group_edge_fixture.sql').read_text())
PYGROUPFIXTURE
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/goods_group_conversion_edges.sql
python3 supabase/tests/goods_group_conversion_http.py "$test_container_id" "$test_database" "$test_dir/group-conversion-http"
python3 supabase/tests/goods_group_conversion_concurrency.py "$test_container_id" "$test_database" "$test_dir/group-conversion-races"
SUPABASE_DB_CONTAINER="$test_container_id" PGDATABASE="$test_database" GROUP_CLAIM_STOCK_LEASE="$test_clone_lease" python3 supabase/tests/group_claim_stock_concurrency.py
SUPABASE_DB_CONTAINER="$test_container_id" PGDATABASE="$test_database" GOODS_GROUP_COMMON_LEASE="$test_clone_lease" python3 supabase/tests/goods_group_common_concurrency.py
docker exec -i "$test_container" psql -X -U supabase_admin -d "$test_database" -v ON_ERROR_STOP=1 -q < supabase/tests/order_claim_contact.sql
python3 supabase/tests/order_claim_contact_concurrency.py "$test_container_id" "$test_database" "$test_dir/contact-races"
python3 supabase/tests/order_claim_contact_http.py "$test_container_id" "$test_database" "$test_dir/contact-http"
ORDER_CLAIM_CONTACT_CLONE_LEASE="$test_clone_lease" SUPABASE_DB_CONTAINER="$test_container_id" PGDATABASE="$test_database" python3 supabase/tests/order_claim_reason_changes_concurrency.py
ORDER_CLAIM_CONTACT_CLONE_LEASE="$test_clone_lease" SUPABASE_DB_CONTAINER="$test_container_id" PGDATABASE="$test_database" python3 supabase/tests/order_claim_type_conversion_concurrency.py
source_after="$(source_ledger_sha)"
[[ "$source_history" == "$source_after" ]] || { echo 'Source migration history changed during clone validation' >&2; exit 1; }
echo "PASS disposable clone: $test_database; source complete ledger SHA-256 unchanged: $source_after"

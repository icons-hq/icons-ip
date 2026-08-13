#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="account-deletion-concurrency-$$"
subject_id="00000000-0000-4000-8000-000000001381"
session_id="00000000-0000-4000-8000-000000001383"
first_key="00000000-0000-4000-8000-000000001391"
second_key="00000000-0000-4000-8000-000000001392"
work_dir="$(mktemp -d)"

psql_exec() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -c "$1"
}

terminate_test_backends() {
  psql_exec -q <<SQL >/dev/null 2>&1 || true
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name like '${test_prefix}-%'
  and pid <> pg_catalog.pg_backend_pid();
SQL
}

cleanup_fixtures() {
  psql_exec -q <<SQL >/dev/null 2>&1 || true
delete from public.orders where user_id = '${subject_id}'::uuid;
delete from private.account_action_fences where subject_user_id = '${subject_id}'::uuid;
delete from private.account_deletion_legal_snapshots
where deletion_event_id in (
  select deletion_event_id from private.account_deletion_requests
  where subject_user_id = '${subject_id}'::uuid
);
delete from private.account_deletion_requests where subject_user_id = '${subject_id}'::uuid;
delete from public.profiles where id = '${subject_id}'::uuid;
delete from auth.users where id = '${subject_id}'::uuid;
update private.account_deletion_control
set
  phase_one_enabled = false,
  transaction_lookup_hmac_ready = false,
  legacy_transaction_evidence_ready = false,
  immutable_ticket_contract_ready = false,
  community_legal_records_ready = false
where singleton;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -rf "$work_dir"
}
trap cleanup EXIT

wait_for_backend_wait() {
  local application_name="$1"
  local expected_wait_type="$2"
  local client_pid="$3"
  local log_file="$4"
  local observed=""

  for _ in $(seq 1 200); do
    observed="$(psql_scalar "
      select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '')
      from pg_catalog.pg_stat_activity
      where application_name = '${application_name}'
    ")"

    if [[ "$observed" == "${expected_wait_type}:"* ]]; then
      return 0
    fi
    if ! kill -0 "$client_pid" 2>/dev/null; then
      echo "backend exited before ${expected_wait_type} wait: ${application_name}" >&2
      sed -n '1,180p' "$log_file" >&2
      return 1
    fi
    sleep 0.05
  done

  echo "timed out waiting for ${expected_wait_type}: ${application_name} (last=${observed})" >&2
  sed -n '1,180p' "$log_file" >&2
  return 1
}

reset_request() {
  psql_exec -q <<SQL >/dev/null
delete from public.orders where user_id = '${subject_id}'::uuid;
delete from private.account_action_fences where subject_user_id = '${subject_id}'::uuid;
delete from private.account_deletion_legal_snapshots
where deletion_event_id in (
  select deletion_event_id from private.account_deletion_requests
  where subject_user_id = '${subject_id}'::uuid
);
delete from private.account_deletion_requests where subject_user_id = '${subject_id}'::uuid;
SQL
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at, last_sign_in_at
)
values (
  '${subject_id}', 'authenticated', 'authenticated',
  'account-deletion-concurrency@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'account-deletion-concurrency@example.test',
  nickname = 'account_deletion_concurrency',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${subject_id}'::uuid;

insert into auth.sessions (id, user_id, created_at, updated_at)
values (
  '${session_id}'::uuid,
  '${subject_id}'::uuid,
  pg_catalog.now(),
  pg_catalog.now()
);

update private.account_deletion_control
set
  transaction_lookup_hmac_ready = true,
  legacy_transaction_evidence_ready = true,
  immutable_ticket_contract_ready = true,
  community_legal_records_ready = true,
  phase_one_enabled = true
where singleton;
SQL

# Request wins: the write must wait for the uncommitted fence, then fail.
request_application="${test_prefix}-request-wins-request"
write_application="${test_prefix}-request-wins-write"
request_log="${work_dir}/request-wins-request.log"
write_log="${work_dir}/request-wins-write.log"

docker exec -e PGAPPNAME="$request_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$request_log" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '${subject_id}', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"${subject_id}","role":"authenticated","session_id":"${session_id}"}',
  true
);
select public.request_my_account_deletion(
  '회원 탈퇴를 신청합니다',
  '${first_key}'::uuid
);
select pg_catalog.pg_sleep(3);
commit;
SQL
request_pid=$!
wait_for_backend_wait "$request_application" "Timeout" "$request_pid" "$request_log"

docker exec -e PGAPPNAME="$write_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$write_log" 2>&1 <<SQL &
begin;
insert into public.orders (user_id, status, total)
values ('${subject_id}'::uuid, 'pending', 1000);
commit;
SQL
write_pid=$!
wait_for_backend_wait "$write_application" "Lock" "$write_pid" "$write_log"

wait "$request_pid"
if wait "$write_pid"; then
  echo "guarded write unexpectedly succeeded after an uncommitted deletion request" >&2
  exit 1
fi
grep -q "account_deletion_write_fenced" "$write_log"
echo "PASS=request-serializes-before-guarded-write"

reset_request

# Write wins: blocker evaluation must wait, then observe the committed order.
write_application="${test_prefix}-write-wins-write"
request_application="${test_prefix}-write-wins-request"
write_log="${work_dir}/write-wins-write.log"
request_log="${work_dir}/write-wins-request.log"

docker exec -e PGAPPNAME="$write_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$write_log" 2>&1 <<SQL &
begin;
insert into public.orders (user_id, status, total)
values ('${subject_id}'::uuid, 'pending', 1000);
select pg_catalog.pg_sleep(3);
commit;
SQL
write_pid=$!
wait_for_backend_wait "$write_application" "Timeout" "$write_pid" "$write_log"

docker exec -e PGAPPNAME="$request_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$request_log" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '${subject_id}', true);
select set_config(
  'request.jwt.claims',
  '{"sub":"${subject_id}","role":"authenticated","session_id":"${session_id}"}',
  true
);
select public.request_my_account_deletion(
  '회원 탈퇴를 신청합니다',
  '${second_key}'::uuid
);
commit;
SQL
request_pid=$!
wait_for_backend_wait "$request_application" "Lock" "$request_pid" "$request_log"

wait "$write_pid"
wait "$request_pid"
grep -q '"status": "blocked"' "$request_log"
grep -q '"code": "active_order"' "$request_log"
echo "PASS=guarded-write-serializes-before-blocker-evaluation"

#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="email-dispatcher-concurrency-$$"
work_dir="$(mktemp -d)"

psql_exec() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  docker exec -i "$db_container" psql \
    -X -U postgres -d postgres -v ON_ERROR_STOP=1 -q -A -t -c "$1"
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
delete from private.email_provider_events
where svix_id like '${test_prefix}-%';
delete from private.email_intent_fences
where intent_id in (
  select id from private.email_intents
  where source = 'auth_hook'
    and source_reference_digest in (
      decode(repeat('10', 32), 'hex'),
      decode(repeat('20', 32), 'hex'),
      decode(repeat('30', 32), 'hex')
    )
);
delete from private.email_intents
where source = 'auth_hook'
  and source_reference_digest in (
    decode(repeat('10', 32), 'hex'),
    decode(repeat('20', 32), 'hex'),
    decode(repeat('30', 32), 'hex')
  );
update private.email_dispatch_control set
  enabled = false,
  hook_contract_ready = false,
  provider_credentials_ready = false,
  webhook_contract_ready = false,
  privacy_retention_ready = false,
  account_deletion_notice_ready = false
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

enqueue_claimed_intent() {
  local source_digest="$1"
  local recipient_digest="$2"
  psql_scalar "
    set role service_role;
    select public.enqueue_email_intent(
      'auth_hook', repeat('${source_digest}', 32), repeat('${recipient_digest}', 32),
      'auth_signup', 'auth_signup_v1'
    ) ->> 'intentId';
    reset role;
  "
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
update private.email_dispatch_control set
  hook_contract_ready = true,
  provider_credentials_ready = true,
  webhook_contract_ready = true,
  privacy_retention_ready = true,
  account_deletion_notice_ready = true,
  enabled = true
where singleton;
SQL

# Acceptance wins the provider digest lock. A concurrent webhook must wait and
# attach directly after commit; it must never persist an orphan NULL intent_id.
accept_first_intent="$(enqueue_claimed_intent '10' '11')"
psql_exec -q <<SQL >/dev/null
set role service_role;
select public.claim_email_intent_dispatch(
  '${accept_first_intent}'::uuid, repeat('11', 32)
);
reset role;
SQL
accept_holder_app="${test_prefix}-accept-first-holder"
accept_webhook_app="${test_prefix}-accept-first-webhook"
accept_holder_log="${work_dir}/accept-first-holder.log"
accept_webhook_log="${work_dir}/accept-first-webhook.log"

docker exec -e PGAPPNAME="$accept_holder_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$accept_holder_log" 2>&1 <<SQL &
begin;
set local role service_role;
select public.record_email_intent_accepted(
  '${accept_first_intent}'::uuid, repeat('a1', 32)
);
select pg_catalog.pg_sleep(2);
commit;
SQL
accept_holder_pid=$!
wait_for_backend_wait "$accept_holder_app" "Timeout" "$accept_holder_pid" "$accept_holder_log"

docker exec -e PGAPPNAME="$accept_webhook_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$accept_webhook_log" 2>&1 <<SQL &
set role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-accept-first', repeat('a1', 32),
  'delivered', '2026-08-13T13:00:00Z'::timestamptz
);
SQL
accept_webhook_pid=$!
wait_for_backend_wait "$accept_webhook_app" "Lock" "$accept_webhook_pid" "$accept_webhook_log"
wait "$accept_holder_pid"
wait "$accept_webhook_pid"

if [[ "$(psql_scalar "
  select count(*)
  from private.email_provider_events
  where svix_id = '${test_prefix}-accept-first'
    and intent_id = '${accept_first_intent}'::uuid
")" != "1" ]]; then
  echo "acceptance-first race left unmatched provider evidence" >&2
  exit 1
fi
echo "PASS=acceptance-first-attaches-event"

# Webhook wins the same provider digest lock. Acceptance must wait, then attach
# the committed early event before returning the reduced lifecycle state.
webhook_first_intent="$(enqueue_claimed_intent '20' '21')"
psql_exec -q <<SQL >/dev/null
set role service_role;
select public.claim_email_intent_dispatch(
  '${webhook_first_intent}'::uuid, repeat('21', 32)
);
reset role;
SQL
webhook_holder_app="${test_prefix}-webhook-first-holder"
webhook_accept_app="${test_prefix}-webhook-first-accept"
webhook_holder_log="${work_dir}/webhook-first-holder.log"
webhook_accept_log="${work_dir}/webhook-first-accept.log"

docker exec -e PGAPPNAME="$webhook_holder_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$webhook_holder_log" 2>&1 <<SQL &
begin;
set local role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-webhook-first', repeat('b1', 32),
  'delivered', '2026-08-13T13:01:00Z'::timestamptz
);
select pg_catalog.pg_sleep(2);
commit;
SQL
webhook_holder_pid=$!
wait_for_backend_wait "$webhook_holder_app" "Timeout" "$webhook_holder_pid" "$webhook_holder_log"

docker exec -e PGAPPNAME="$webhook_accept_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$webhook_accept_log" 2>&1 <<SQL &
set role service_role;
select public.record_email_intent_accepted(
  '${webhook_first_intent}'::uuid, repeat('b1', 32)
);
SQL
webhook_accept_pid=$!
wait_for_backend_wait "$webhook_accept_app" "Lock" "$webhook_accept_pid" "$webhook_accept_log"
wait "$webhook_holder_pid"
wait "$webhook_accept_pid"

grep -q '"state": "delivered"' "$webhook_accept_log"
if [[ "$(psql_scalar "
  select count(*)
  from private.email_provider_events
  where svix_id = '${test_prefix}-webhook-first'
    and intent_id = '${webhook_first_intent}'::uuid
")" != "1" ]]; then
  echo "webhook-first race was not reconciled onto the accepted intent" >&2
  exit 1
fi
echo "PASS=webhook-first-reconciles-event"

# Two identical deliveries with the same svix id converge to one row and a
# duplicate acknowledgement instead of leaking a unique_violation to Resend.
same_svix_intent="$(enqueue_claimed_intent '30' '31')"
psql_exec -q <<SQL >/dev/null
set role service_role;
select public.claim_email_intent_dispatch(
  '${same_svix_intent}'::uuid, repeat('31', 32)
);
select public.record_email_intent_accepted(
  '${same_svix_intent}'::uuid, repeat('c1', 32)
);
reset role;
SQL
same_holder_app="${test_prefix}-same-svix-holder"
same_duplicate_app="${test_prefix}-same-svix-duplicate"
same_holder_log="${work_dir}/same-svix-holder.log"
same_duplicate_log="${work_dir}/same-svix-duplicate.log"

docker exec -e PGAPPNAME="$same_holder_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$same_holder_log" 2>&1 <<SQL &
begin;
set local role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-same-svix', repeat('c1', 32),
  'sent', '2026-08-13T13:02:00Z'::timestamptz
);
select pg_catalog.pg_sleep(2);
commit;
SQL
same_holder_pid=$!
wait_for_backend_wait "$same_holder_app" "Timeout" "$same_holder_pid" "$same_holder_log"

docker exec -e PGAPPNAME="$same_duplicate_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$same_duplicate_log" 2>&1 <<SQL &
set role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-same-svix', repeat('c1', 32),
  'sent', '2026-08-13T13:02:00Z'::timestamptz
);
SQL
same_duplicate_pid=$!
wait_for_backend_wait "$same_duplicate_app" "Lock" "$same_duplicate_pid" "$same_duplicate_log"
wait "$same_holder_pid"
wait "$same_duplicate_pid"
grep -q '"kind": "duplicate"' "$same_duplicate_log"
if [[ "$(psql_scalar "
  select count(*) from private.email_provider_events
  where svix_id = '${test_prefix}-same-svix'
")" != "1" ]]; then
  echo "identical concurrent svix deliveries did not converge to one row" >&2
  exit 1
fi
echo "PASS=same-svix-identical-is-idempotent"

# A conflicting payload with the same svix id waits for the winner, then fails
# with the durable domain conflict. Lock order must not deadlock when provider
# digests differ: provider digest first, svix id second.
conflict_holder_app="${test_prefix}-conflict-holder"
conflict_loser_app="${test_prefix}-conflict-loser"
conflict_holder_log="${work_dir}/conflict-holder.log"
conflict_loser_log="${work_dir}/conflict-loser.log"

docker exec -e PGAPPNAME="$conflict_holder_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$conflict_holder_log" 2>&1 <<SQL &
begin;
set local role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-conflict-svix', repeat('d1', 32),
  'sent', '2026-08-13T13:03:00Z'::timestamptz
);
select pg_catalog.pg_sleep(2);
commit;
SQL
conflict_holder_pid=$!
wait_for_backend_wait "$conflict_holder_app" "Timeout" "$conflict_holder_pid" "$conflict_holder_log"

docker exec -e PGAPPNAME="$conflict_loser_app" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$conflict_loser_log" 2>&1 <<SQL &
set role service_role;
select public.reduce_email_provider_event(
  '${test_prefix}-conflict-svix', repeat('e1', 32),
  'delivered', '2026-08-13T13:04:00Z'::timestamptz
);
SQL
conflict_loser_pid=$!
wait_for_backend_wait "$conflict_loser_app" "Lock" "$conflict_loser_pid" "$conflict_loser_log"
wait "$conflict_holder_pid"
if wait "$conflict_loser_pid"; then
  echo "conflicting concurrent svix delivery unexpectedly succeeded" >&2
  exit 1
fi
grep -q 'email_provider_event_id_conflict' "$conflict_loser_log"
if grep -q 'deadlock detected' "$conflict_holder_log" "$conflict_loser_log"; then
  echo "email provider lock order deadlocked" >&2
  exit 1
fi
if [[ "$(psql_scalar "
  select count(*) from private.email_provider_events
  where svix_id = '${test_prefix}-conflict-svix'
    and provider_reference_digest = decode(repeat('d1', 32), 'hex')
    and event_type = 'sent'
    and occurred_at = '2026-08-13T13:03:00Z'::timestamptz
")" != "1" ]]; then
  echo "conflicting svix delivery changed the winner evidence" >&2
  exit 1
fi
echo "PASS=same-svix-conflict-is-durable-and-deadlock-free"

# The post-race replay remains a stable duplicate acknowledgement.
replay="$(psql_scalar "
  set role service_role;
  select public.reduce_email_provider_event(
    '${test_prefix}-same-svix', repeat('c1', 32),
    'sent', '2026-08-13T13:02:00Z'::timestamptz
  ) ->> 'kind';
  reset role;
")"
if [[ "$replay" != "duplicate" ]]; then
  echo "post-race svix replay did not remain idempotent" >&2
  exit 1
fi
echo "PASS=post-race-replay-is-idempotent"

#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-payment-expiry-claim-$$"
user_id="00000000-0000-4000-8000-000000002082"
order_id="20000000-0000-4000-8000-000000002082"
attempt_id="30000000-0000-4000-8000-000000002082"
claim_token="40000000-0000-4000-8000-000000002082"
nonce_digest="$(printf 'c%.0s' {1..64})"
provider_order_id="O$(printf '%s' "$attempt_id" | tr -d '-')"
commit_gate_key=9208201
gate_application="${test_prefix}-gate"
cron_fence_application="${test_prefix}-cron-fence"
expiry_log="$(mktemp)"
claim_log="$(mktemp)"
gate_log="$(mktemp)"
cron_fence_log="$(mktemp)"
lock_session_pid=""
gate_client_pid=""
cron_fence_client_pid=""

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
delete from public.order_cancellation_requests where order_id = '${order_id}'::uuid;
delete from public.payment_attempts where ref_id = '${order_id}'::uuid;
delete from public.order_items where order_id = '${order_id}'::uuid;
delete from public.orders where id = '${order_id}'::uuid;
delete from public.goods where id = 'goods-payment-expiry-claim-good';
delete from public.ips where id = 'goods-payment-expiry-claim-ip';
delete from public.verticals where key = 'goods-payment-expiry-claim';
delete from public.profiles where id = '${user_id}'::uuid;
delete from auth.users where id = '${user_id}'::uuid;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$expiry_log" "$claim_log" "$gate_log" "$cron_fence_log"
}
trap cleanup EXIT

# expected_wait is a wait_event_type ("Lock") or type:event ("Lock:advisory").
wait_for_backend_wait() {
  local application_name="$1"
  local expected_wait="$2"
  local client_pid="$3"
  local log_file="$4"
  local observed=""

  for _ in $(seq 1 200); do
    observed="$(psql_scalar "
      select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '')
      from pg_catalog.pg_stat_activity
      where application_name = '${application_name}'
    ")"
    if [[ "$observed" == "$expected_wait" || "$observed" == "${expected_wait}:"* ]]; then
      return 0
    fi
    if ! kill -0 "$client_pid" 2>/dev/null; then
      echo "backend exited before ${expected_wait} wait: ${application_name}" >&2
      sed -n '1,160p' "$log_file" >&2
      return 1
    fi
    sleep 0.05
  done

  echo "timed out waiting for ${expected_wait}: ${application_name} (last=${observed})" >&2
  sed -n '1,160p' "$log_file" >&2
  return 1
}

# Opens a transaction that takes one lock and parks until release_lock_session
# terminates it. The sleep only bounds a leaked session.
start_lock_session() {
  local application_name="$1"
  local log_file="$2"
  local lock_statement="$3"

  docker exec -e PGAPPNAME="$application_name" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$log_file" 2>&1 <<SQL &
begin;
${lock_statement};
select pg_catalog.pg_sleep(300);
SQL
  lock_session_pid=$!
  wait_for_backend_wait "$application_name" "Timeout" "$lock_session_pid" "$log_file"
}

release_lock_session() {
  local application_name="$1"
  local client_pid="$2"
  local terminated=""

  terminated="$(psql_scalar "
    select pg_catalog.pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity
    where application_name = '${application_name}'
  ")"
  wait "$client_pid" >/dev/null 2>&1 || true
  if [[ "$terminated" != *t* ]]; then
    echo "lock session ended before its release: ${application_name}" >&2
    return 1
  fi
}

# A holder ends its transaction with pg_advisory_xact_lock(commit_gate_key), so
# it stays open, visibly waiting on Lock:advisory, until the gate is released.
# Contenders and sweeps then run inside the holder's lock window by
# construction instead of inside a sleep.
open_commit_gate() {
  start_lock_session "$gate_application" "$gate_log" \
    "select pg_catalog.pg_advisory_xact_lock(${commit_gate_key})"
  gate_client_pid="$lock_session_pid"
}

release_commit_gate() {
  release_lock_session "$gate_application" "$gate_client_pid"
}

# pg_cron runs this same global sweep every minute (expire-stale-checkouts).
# Once a fixture turns the order into a sweep candidate, a scheduled pass can
# take it first and this script's own pass then counts 0. Goods holders lock
# the order row and read every table the sweep locks, so no goods table lock
# can park cron without parking them too. The fence parks the scheduler
# instead: with cron.log_run on, pg_cron commits a job_run_details row
# (starting, connecting, sending) before it sends any job, and a SHARE lock on
# that table blocks those writes. It counts only once the latest
# expire-stale-checkouts run is terminal, since pg_cron starts a job's next run
# only after the previous one ends.
hold_cron_fence() {
  local settled=""

  if [[ "$(psql_scalar 'show cron.log_run')" != "on" ]]; then
    echo "cron fence requires cron.log_run = on" >&2
    return 1
  fi

  for _ in $(seq 1 150); do
    start_lock_session "$cron_fence_application" "$cron_fence_log" \
      "lock table cron.job_run_details in share mode"
    cron_fence_client_pid="$lock_session_pid"

    settled="$(psql_scalar "
      select coalesce((
        select run.status in ('succeeded', 'failed')
        from cron.job_run_details as run
        join cron.job as job on job.jobid = run.jobid
        where job.jobname = 'expire-stale-checkouts'
        order by run.runid desc
        limit 1
      ), true)
    ")"
    if [[ "$settled" == "t" ]]; then
      return 0
    fi

    release_lock_session "$cron_fence_application" "$cron_fence_client_pid"
    sleep 0.1
  done

  echo "expire-stale-checkouts stayed in flight; cron fence not established" >&2
  dump_cron_runs
  return 1
}

release_cron_fence() {
  release_lock_session "$cron_fence_application" "$cron_fence_client_pid"
}

dump_cron_runs() {
  echo "--- recent expire-stale-checkouts runs" >&2
  psql_exec -A -t <<SQL >&2 || true
select run.runid || ' ' || run.status
  || ' ' || coalesce(run.start_time::text, '-')
  || ' .. ' || coalesce(run.end_time::text, '-')
from cron.job_run_details as run
join cron.job as job on job.jobid = run.jobid
where job.jobname = 'expire-stale-checkouts'
order by run.runid desc
limit 3;
SQL
}

terminate_test_backends
cleanup_fixtures

# One transaction: the order is inserted already stale, so committing it before
# its attempt would hand the scheduled sweep an order it may cancel.
psql_exec -q <<SQL >/dev/null
begin;

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '${user_id}', 'authenticated', 'authenticated',
  'goods-payment-expiry-claim@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'goods-payment-expiry-claim@example.test',
  nickname = 'goods_payment_expiry_claim',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${user_id}'::uuid;

insert into public.verticals (key, label, color)
values ('goods-payment-expiry-claim', '결제 만료 claim 경합', '#000000');

insert into public.ips (id, title, vertical_key)
values (
  'goods-payment-expiry-claim-ip',
  '결제 만료 claim 경합 IP',
  'goods-payment-expiry-claim'
);

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-payment-expiry-claim-good',
  'goods-payment-expiry-claim-ip',
  '결제 만료 claim 경합 상품',
  '문구', 28000, 'ok', 10
);

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values (
  '${order_id}', '${user_id}', 'pending', 31000, 3000,
  pg_catalog.now() - interval '10 minutes',
  '10000000-0000-4000-8000-000000002082'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot, variant_id
)
values (
  '${order_id}', 'goods-payment-expiry-claim-good', 1, 28000,
  '결제 만료 claim 경합 상품', '문구',
  'goods-payment-expiry-claim-ip',
  (select id from public.goods_variants where good_id='goods-payment-expiry-claim-good' and is_default));

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code,
  callback_nonce_digest, expires_at
)
values (
  '${attempt_id}', 'korpay', '${user_id}', 'order', '${order_id}',
  31000, 'KRW', 'prepared', 'goods:${order_id}',
  '${provider_order_id}', 'P$(printf '%s' "$attempt_id" | tr -d '-')',
  '${nonce_digest}', pg_catalog.now() + interval '2 minutes'
);

commit;
SQL

# Expiry owns the order row first. A callback that observed a still-valid
# action TTL waits on that same row and must fail closed once it sees the stale
# order; the sweep cannot close the attempt until its own expires_at elapses.
expiry_application="${test_prefix}-expiry"
claim_application="${test_prefix}-claim"

open_commit_gate

docker exec -e PGAPPNAME="$expiry_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_log" 2>&1 <<SQL &
begin;
select id from public.orders where id = '${order_id}'::uuid for update;
select pg_catalog.pg_advisory_xact_lock(${commit_gate_key});
select public.expire_stale_checkouts();
commit;
SQL
expiry_client_pid=$!

wait_for_backend_wait "$expiry_application" "Lock:advisory" "$expiry_client_pid" "$expiry_log"

docker exec -e PGAPPNAME="$claim_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
SQL
claim_client_pid=$!

wait_for_backend_wait "$claim_application" "Lock" "$claim_client_pid" "$claim_log"
release_commit_gate
wait "$expiry_client_pid"
if wait "$claim_client_pid"; then
  echo "callback unexpectedly claimed an expired order" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

if ! grep -q 'goods_order_not_payable' "$claim_log"; then
  echo "callback did not fail closed after the expiry lock" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

fresh_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'prepared'
    and attempt.callback_nonce_digest = '${nonce_digest}'
    and attempt.expires_at > pg_catalog.clock_timestamp()
    and good.stock_qty = 10
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-expiry-claim-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$fresh_state" != "ok" ]]; then
  echo "fresh prepared action was swept or inventory was released" >&2
  exit 1
fi

echo "PASS=expiry-locks-order-fresh-action-remains-prepared"

# Give the same action and order a fresh deadline, then let the callback claim
# first. It moves both deadlines into the past while retaining its locks so the
# post-commit sweep must preserve confirming even after the authoritative TTL.
psql_exec -q <<SQL >/dev/null
update public.orders
set expires_at = pg_catalog.now() + interval '10 minutes'
where id = '${order_id}'::uuid;
update public.payment_attempts
set expires_at = pg_catalog.now() + interval '2 minutes'
where id = '${attempt_id}'::uuid;
SQL

: >"$claim_log"
claim_first_application="${test_prefix}-claim-first"
open_commit_gate
docker exec -e PGAPPNAME="$claim_first_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
begin;
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
update public.orders
set expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${order_id}'::uuid;
update public.payment_attempts
set expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${attempt_id}'::uuid;
select pg_catalog.pg_advisory_xact_lock(${commit_gate_key});
commit;
SQL
claim_first_client_pid=$!

wait_for_backend_wait \
  "$claim_first_application" "Lock:advisory" "$claim_first_client_pid" "$claim_log"

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "sweep changed a callback-owned attempt" >&2
  exit 1
fi

release_commit_gate
wait "$claim_first_client_pid"

if ! grep -q '"claim_status": "claimed"' "$claim_log"; then
  echo "callback did not claim before the sweep" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "post-commit sweep changed a confirming attempt" >&2
  exit 1
fi

confirming_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and attempt.claim_token = '${claim_token}'::uuid
    and attempt.expires_at <= pg_catalog.clock_timestamp()
    and good.stock_qty = 10
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-expiry-claim-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$confirming_state" != "ok" ]]; then
  echo "confirming attempt or inventory was not preserved" >&2
  exit 1
fi

echo "PASS=callback-claim-wins-expiry-sweep-preserves-confirming"

# Return the fixture to prepared only to exercise the opposite terminal path
# below. Production transitions never move confirming back to prepared.
# The order is already stale, so this update makes it a sweep candidate; the
# cron fence keeps the scheduled pass off it until this script has swept.
hold_cron_fence
psql_exec -q <<SQL >/dev/null
update public.payment_attempts
set
  state = 'prepared',
  claim_token = null,
  claim_expires_at = null,
  expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${attempt_id}'::uuid;
SQL

swept="$(psql_scalar 'select public.expire_stale_checkouts()')"
if [[ "$swept" != "1" ]]; then
  echo "expired prepared action was not swept (returned ${swept})" >&2
  dump_cron_runs
  exit 1
fi
release_cron_fence

expired_state="$(psql_scalar "
  select case when
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.callback_nonce_digest = '${nonce_digest}'
    and good.stock_qty = 11
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-expiry-claim-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$expired_state" != "ok" ]]; then
  echo "expired prepared action did not close before one inventory release" >&2
  exit 1
fi

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "expiry sweep was not idempotent" >&2
  exit 1
fi

terminal_claim="$(psql_scalar "
  select public.claim_goods_payment_attempt(
    'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
  )
")"

if [[ "$terminal_claim" != *'"claim_status": "terminal"'* \
  || "$terminal_claim" != *'"outcome": "canceled"'* ]]; then
  echo "expired callback did not replay the canceled terminal outcome" >&2
  printf '%s\n' "$terminal_claim" >&2
  exit 1
fi

echo "PASS=attempt-ttl-closes-action-before-inventory-release"

# A cancellation request can win while the action is already expired. The
# sweep uses SKIP LOCKED while that transaction owns the order, then the next
# pass atomically closes attempt + request + order and restores stock once.
# The cron fence spans from the stale reset to that next pass: a scheduled pass
# before the request would cancel the order, and one after the request commits
# would complete it before this script's pass.
hold_cron_fence
psql_exec -q <<SQL >/dev/null
begin;
delete from public.order_cancellation_requests where order_id = '${order_id}'::uuid;
update public.orders
set
  status = 'pending',
  expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${order_id}'::uuid;
update public.payment_attempts
set
  state = 'prepared',
  claim_token = null,
  claim_expires_at = null,
  expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${attempt_id}'::uuid;
update public.goods_variants set stock_qty = 10 where good_id = 'goods-payment-expiry-claim-good' and is_default;
commit;
SQL

: >"$expiry_log"
request_application="${test_prefix}-request-first"
open_commit_gate
docker exec -e PGAPPNAME="$request_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_log" 2>&1 <<SQL &
begin;
select public.request_order_cancellation(
  '${order_id}', '${user_id}', '만료 결제 취소 경합', 'change_of_mind'
);
select pg_catalog.pg_advisory_xact_lock(${commit_gate_key});
commit;
SQL
request_client_pid=$!

wait_for_backend_wait "$request_application" "Lock:advisory" "$request_client_pid" "$expiry_log"

swept="$(psql_scalar 'select public.expire_stale_checkouts()')"
if [[ "$swept" != "0" ]]; then
  echo "expiry sweep did not skip a request-owned order lock (returned ${swept})" >&2
  exit 1
fi

release_commit_gate
wait "$request_client_pid"
if ! grep -qx 'requested' "$expiry_log"; then
  echo "racing cancellation did not persist its durable request" >&2
  sed -n '1,160p' "$expiry_log" >&2
  exit 1
fi

swept="$(psql_scalar 'select public.expire_stale_checkouts()')"
if [[ "$swept" != "1" ]]; then
  echo "post-request expiry did not close the expired prepared attempt (returned ${swept})" >&2
  dump_cron_runs
  exit 1
fi
release_cron_fence

requested_expiry_state="$(psql_scalar "
  select case when
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and request.status = 'completed'
    and request.completed_at is not null
    and good.stock_qty = 11
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-expiry-claim-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$requested_expiry_state" != "ok" ]]; then
  echo "request/expiry race lost terminal state or restored stock incorrectly" >&2
  exit 1
fi

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "request/expiry retry restored inventory more than once" >&2
  exit 1
fi

echo "PASS=request-wins-lock-next-expiry-completes-once"

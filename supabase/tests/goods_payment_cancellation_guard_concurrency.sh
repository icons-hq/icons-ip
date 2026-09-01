#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-payment-cancel-race-$$"
user_id="00000000-0000-4000-8000-000000002081"
admin_id="00000000-0000-4000-8000-000000002082"
order_id="20000000-0000-4000-8000-000000002081"
claim_token="40000000-0000-4000-8000-000000002081"
nonce_digest="$(printf 'f%.0s' {1..64})"
claim_log="$(mktemp)"
cancel_log="$(mktemp)"
expiry_log="$(mktemp)"

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
delete from public.audit_log
where actor_id = '${admin_id}'::uuid
  and action = 'admin.order.prepared_goods_cancellation_completed';
delete from public.order_cancellation_claims where order_id = '${order_id}'::uuid;
delete from public.order_cancellation_requests where order_id = '${order_id}'::uuid;
delete from public.payment_attempts where ref_id = '${order_id}'::uuid;
delete from public.order_items where order_id = '${order_id}'::uuid;
delete from public.orders where id = '${order_id}'::uuid;
delete from public.goods where id = 'goods-payment-cancel-race-good';
delete from public.ips where id = 'goods-payment-cancel-race-ip';
delete from public.verticals where key = 'goods-payment-cancel-race';
delete from public.profiles where id = '${user_id}'::uuid;
delete from public.profiles where id = '${admin_id}'::uuid;
delete from auth.users where id = '${user_id}'::uuid;
delete from auth.users where id = '${admin_id}'::uuid;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$claim_log" "$cancel_log" "$expiry_log"
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
      sed -n '1,160p' "$log_file" >&2
      return 1
    fi
    sleep 0.05
  done

  echo "timed out waiting for ${expected_wait_type}: ${application_name} (last=${observed})" >&2
  sed -n '1,160p' "$log_file" >&2
  return 1
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '${user_id}', 'authenticated', 'authenticated',
  'goods-payment-cancel-race@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '${admin_id}', 'authenticated', 'authenticated',
  'goods-payment-cancel-race-admin@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'goods-payment-cancel-race@example.test',
  nickname = 'goods_payment_cancel_race',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${user_id}'::uuid;

update public.profiles
set
  email = 'goods-payment-cancel-race-admin@example.test',
  nickname = 'goods_payment_cancel_race_admin',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now(),
  role = 'admin'
where id = '${admin_id}'::uuid;

insert into public.verticals (key, label, color)
values ('goods-payment-cancel-race', '결제 claim 취소 경합', '#000000');

insert into public.ips (id, title, vertical_key)
values (
  'goods-payment-cancel-race-ip',
  '결제 claim 취소 경합 IP',
  'goods-payment-cancel-race'
);

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-payment-cancel-race-good',
  'goods-payment-cancel-race-ip',
  '결제 claim 취소 경합 상품',
  '문구', 28000, 'ok', 10
);

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values (
  '${order_id}', '${user_id}', 'pending', 31000, 3000,
  pg_catalog.now() + interval '15 minutes',
  '10000000-0000-4000-8000-000000002081'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '${order_id}', 'goods-payment-cancel-race-good', 1, 28000,
  '결제 claim 취소 경합 상품', '문구',
  'goods-payment-cancel-race-ip'
);

select public.prepare_goods_payment_attempt(
  '${user_id}', '${order_id}', 'korpay'
);

select public.bind_goods_payment_callback_nonce(
  (select id from public.payment_attempts where ref_id = '${order_id}'::uuid),
  '${nonce_digest}'
);
SQL

provider_order_id="$(psql_scalar "
  select provider_order_id
  from public.payment_attempts
  where ref_id = '${order_id}'::uuid
")"

claim_application="${test_prefix}-claim"
cancel_application="${test_prefix}-cancel"

docker exec -e PGAPPNAME="$claim_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
begin;
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
claim_client_pid=$!

wait_for_backend_wait "$claim_application" "Timeout" "$claim_client_pid" "$claim_log"

docker exec -e PGAPPNAME="$cancel_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$cancel_log" 2>&1 <<SQL &
select public.request_order_cancellation(
  '${order_id}', '${user_id}', '결제 claim 경합 취소', 'change_of_mind'
);
SQL
cancel_client_pid=$!

wait_for_backend_wait "$cancel_application" "Lock" "$cancel_client_pid" "$cancel_log"
wait "$claim_client_pid"
wait "$cancel_client_pid"

if ! grep -q '"claim_status": "claimed"' "$claim_log"; then
  echo "provider callback did not own the attempt" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

if ! grep -qx 'requested' "$cancel_log"; then
  echo "racing cancellation did not become a durable request" >&2
  sed -n '1,160p' "$cancel_log" >&2
  exit 1
fi

final_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and attempt.claim_token = '${claim_token}'::uuid
    and request.status = 'requested'
    and good.stock_qty = 10
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-cancel-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$final_state" != "ok" ]]; then
  echo "claim/cancellation race released inventory or lost reconciliation state" >&2
  exit 1
fi

echo "PASS=claim-wins-cancellation-becomes-requested"

# The callback that owned the order first remains authoritative after staff
# advances the durable request. The new expiry-aware seam must converge to
# in_progress instead of attempting an empty Toss completion.
psql_exec -q <<SQL >/dev/null
update public.order_cancellation_requests
set
  status = 'processing',
  decided_by = '${admin_id}'::uuid,
  decided_at = pg_catalog.now(),
  provider_started_at = pg_catalog.now(),
  updated_at = pg_catalog.now()
where order_id = '${order_id}'::uuid;

insert into public.order_cancellation_claims (
  order_id, requested_by, previous_status
)
values ('${order_id}', '${user_id}', 'pending');
SQL

if [[ "$(psql_scalar "
  select public.reconcile_expired_prepared_goods_cancellation(
    (select id from public.order_cancellation_requests
      where order_id = '${order_id}'::uuid),
    '${admin_id}'
  )
")" != "in_progress" ]]; then
  echo "callback-owned attempt did not keep prepared expiry recovery in progress" >&2
  exit 1
fi

callback_owned_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and request.status = 'processing'
    and good.stock_qty = 10
    and not exists (
      select 1 from public.audit_log as audit
      where audit.actor_id = '${admin_id}'::uuid
        and audit.action = 'admin.order.prepared_goods_cancellation_completed'
    )
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-cancel-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$callback_owned_state" != "ok" ]]; then
  echo "callback winner was overwritten by prepared expiry recovery" >&2
  exit 1
fi

echo "PASS=callback-winner-keeps-prepared-expiry-in-progress"

# Reverse the winner on the same fixture. A durable cancellation request holds
# the order-first lock; the callback waits, then must fail closed without
# claiming or releasing inventory after the cancellation transaction commits.
psql_exec -q <<SQL >/dev/null
delete from public.order_cancellation_claims where order_id = '${order_id}'::uuid;
delete from public.order_cancellation_requests where order_id = '${order_id}'::uuid;
update public.payment_attempts
set state = 'prepared', claim_token = null, claim_expires_at = null
where ref_id = '${order_id}'::uuid;
SQL

: >"$claim_log"
: >"$cancel_log"
cancel_first_application="${test_prefix}-cancel-first"
claim_second_application="${test_prefix}-claim-second"

docker exec -e PGAPPNAME="$cancel_first_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$cancel_log" 2>&1 <<SQL &
begin;
select public.request_order_cancellation(
  '${order_id}', '${user_id}', '취소 요청 선점 경합', 'change_of_mind'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
cancel_first_client_pid=$!

wait_for_backend_wait \
  "$cancel_first_application" "Timeout" "$cancel_first_client_pid" "$cancel_log"

docker exec -e PGAPPNAME="$claim_second_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
SQL
claim_second_client_pid=$!

wait_for_backend_wait \
  "$claim_second_application" "Lock" "$claim_second_client_pid" "$claim_log"
wait "$cancel_first_client_pid"
if wait "$claim_second_client_pid"; then
  echo "callback unexpectedly claimed after cancellation request won" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

if ! grep -qx 'requested' "$cancel_log"; then
  echo "cancellation did not leave the durable requested state" >&2
  sed -n '1,160p' "$cancel_log" >&2
  exit 1
fi

if ! grep -q 'goods_order_not_payable' "$claim_log"; then
  echo "callback did not fail closed against the durable cancellation request" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

reverse_final_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'prepared'
    and attempt.claim_token is null
    and request.status = 'requested'
    and good.stock_qty = 10
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-cancel-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$reverse_final_state" != "ok" ]]; then
  echo "cancellation/claim race lost request, attempt, or inventory state" >&2
  exit 1
fi

echo "PASS=cancellation-wins-callback-fails-closed"

# The losing callback leaves a prepared attempt and a durable request. Once
# that action's authoritative TTL elapses, the expiry worker must close the
# attempt and request in one transaction before restoring inventory once.
psql_exec -q <<SQL >/dev/null
update public.orders
set expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${order_id}'::uuid;
update public.payment_attempts
set expires_at = pg_catalog.now() - interval '10 minutes'
where ref_id = '${order_id}'::uuid;
SQL

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "1" ]]; then
  echo "expired prepared attempt with a durable request was not swept" >&2
  exit 1
fi

expiry_final_state="$(psql_scalar "
  select case when
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.claim_token is null
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
    on good.id = 'goods-payment-cancel-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$expiry_final_state" != "ok" ]]; then
  echo "expiry did not atomically complete attempt, request, order, and stock" >&2
  exit 1
fi

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "requested-attempt expiry restored inventory more than once" >&2
  exit 1
fi

echo "PASS=cancellation-race-eventually-expires-and-restores-once"

# A processing request is excluded from the global sweep. When its prepared
# attempt is already expired, the dedicated RPC owns the order lock first and
# closes the no-capture path. A concurrent callback must fail closed from the
# already-expired durable TTL snapshot without claiming the attempt.
psql_exec -q <<SQL >/dev/null
delete from public.audit_log
where actor_id = '${admin_id}'::uuid
  and action = 'admin.order.prepared_goods_cancellation_completed';
delete from public.order_cancellation_claims where order_id = '${order_id}'::uuid;
update public.orders
set status = 'pending', expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${order_id}'::uuid;
update public.goods set stock_qty = 10
where id = 'goods-payment-cancel-race-good';
update public.payment_attempts
set
  state = 'prepared',
  expires_at = pg_catalog.now() - interval '1 minute',
  claim_token = null,
  claim_expires_at = null
where ref_id = '${order_id}'::uuid;
update public.order_cancellation_requests
set
  status = 'processing',
  decided_by = '${admin_id}'::uuid,
  decided_at = pg_catalog.now(),
  provider_started_at = pg_catalog.now(),
  completed_at = null,
  last_error_code = null,
  updated_at = pg_catalog.now()
where order_id = '${order_id}'::uuid;
insert into public.order_cancellation_claims (
  order_id, requested_by, previous_status
)
values ('${order_id}', '${user_id}', 'pending');
SQL

expiry_application="${test_prefix}-prepared-expiry"
callback_after_expiry_application="${test_prefix}-callback-after-expiry"

docker exec -e PGAPPNAME="$expiry_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_log" 2>&1 <<SQL &
begin;
select public.reconcile_expired_prepared_goods_cancellation(
  (select id from public.order_cancellation_requests
    where order_id = '${order_id}'::uuid),
  '${admin_id}'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
expiry_client_pid=$!

wait_for_backend_wait \
  "$expiry_application" "Timeout" "$expiry_client_pid" "$expiry_log"

: >"$claim_log"
docker exec -e PGAPPNAME="$callback_after_expiry_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
SQL
callback_after_expiry_pid=$!

if wait "$callback_after_expiry_pid"; then
  echo "callback unexpectedly claimed after expired prepared recovery won" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

# claim_goods_payment_attempt intentionally checks the immutable attempt TTL
# before taking the order lock. While the winning expiry transaction is still
# open, this callback may reject from its old-but-already-expired snapshot
# without waiting. Assert overlap instead of falsely requiring a Lock wait.
if ! kill -0 "$expiry_client_pid" 2>/dev/null; then
  echo "callback rejection did not overlap the winning expiry transaction" >&2
  sed -n '1,160p' "$expiry_log" >&2
  exit 1
fi

wait "$expiry_client_pid"

if ! grep -qx 'completed' "$expiry_log"; then
  echo "expired prepared recovery did not complete" >&2
  sed -n '1,160p' "$expiry_log" >&2
  exit 1
fi
if ! grep -q 'goods_payment_attempt_expired' "$claim_log"; then
  echo "losing callback did not fail closed" >&2
  sed -n '1,160p' "$claim_log" >&2
  exit 1
fi

expiry_race_state="$(psql_scalar "
  select case when
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and request.status = 'completed'
    and good.stock_qty = 11
    and (select pg_catalog.count(*) from public.payments as payment
      where payment.purpose = 'order' and payment.ref_id = order_record.id) = 0
    and (select pg_catalog.count(*) from public.audit_log as audit
      where audit.actor_id = '${admin_id}'::uuid
        and audit.action = 'admin.order.prepared_goods_cancellation_completed'
        and audit.target = 'order:' || order_record.id::text) = 1
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt
    on attempt.purpose = 'order' and attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request
    on request.order_id = order_record.id
  join public.goods as good
    on good.id = 'goods-payment-cancel-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$expiry_race_state" != "ok" ]]; then
  echo "prepared expiry/callback race did not finalize atomically once" >&2
  exit 1
fi

if [[ "$(psql_scalar "
  select public.reconcile_expired_prepared_goods_cancellation(
    (select id from public.order_cancellation_requests
      where order_id = '${order_id}'::uuid),
    '${admin_id}'
  )
")" != "completed" ]]; then
  echo "prepared expiry terminal replay did not converge" >&2
  exit 1
fi

terminal_replay_state="$(psql_scalar "
  select case when
    good.stock_qty = 11
    and (select pg_catalog.count(*) from public.audit_log as audit
      where audit.actor_id = '${admin_id}'::uuid
        and audit.action = 'admin.order.prepared_goods_cancellation_completed') = 1
  then 'ok' else 'invalid' end
  from public.goods as good
  where good.id = 'goods-payment-cancel-race-good'
")"

if [[ "$terminal_replay_state" != "ok" ]]; then
  echo "prepared expiry replay duplicated stock or audit" >&2
  exit 1
fi

echo "PASS=prepared-expiry-wins-callback-and-replays-once"

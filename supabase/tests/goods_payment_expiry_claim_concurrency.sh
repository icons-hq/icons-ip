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
expiry_log="$(mktemp)"
claim_log="$(mktemp)"

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
  rm -f "$expiry_log" "$claim_log"
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
  '테스트', 28000, 'ok', 10
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
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '${order_id}', 'goods-payment-expiry-claim-good', 1, 28000,
  '결제 만료 claim 경합 상품', '테스트',
  'goods-payment-expiry-claim-ip'
);

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
SQL

# Expiry owns the order row first. A callback that observed a still-valid
# action TTL waits on that same row and must fail closed once it sees the stale
# order; the sweep cannot close the attempt until its own expires_at elapses.
expiry_application="${test_prefix}-expiry"
claim_application="${test_prefix}-claim"

docker exec -e PGAPPNAME="$expiry_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_log" 2>&1 <<SQL &
begin;
select id from public.orders where id = '${order_id}'::uuid for update;
select pg_catalog.pg_sleep(2);
select public.expire_stale_checkouts();
commit;
SQL
expiry_client_pid=$!

wait_for_backend_wait "$expiry_application" "Timeout" "$expiry_client_pid" "$expiry_log"

docker exec -e PGAPPNAME="$claim_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$claim_log" 2>&1 <<SQL &
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${claim_token}'
);
SQL
claim_client_pid=$!

wait_for_backend_wait "$claim_application" "Lock" "$claim_client_pid" "$claim_log"
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
select pg_catalog.pg_sleep(2);
commit;
SQL
claim_first_client_pid=$!

wait_for_backend_wait \
  "$claim_first_application" "Timeout" "$claim_first_client_pid" "$claim_log"

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "sweep changed a callback-owned attempt" >&2
  exit 1
fi

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
psql_exec -q <<SQL >/dev/null
update public.payment_attempts
set
  state = 'prepared',
  claim_token = null,
  claim_expires_at = null,
  expires_at = pg_catalog.now() - interval '10 minutes'
where id = '${attempt_id}'::uuid;
SQL

if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "1" ]]; then
  echo "expired prepared action was not swept" >&2
  exit 1
fi

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

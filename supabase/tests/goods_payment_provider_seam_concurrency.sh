#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-payment-claim-$$"
user_id="00000000-0000-4000-8000-000000002061"
order_id="20000000-0000-4000-8000-000000002061"
holder_claim="40000000-0000-4000-8000-000000002061"
contender_claim="40000000-0000-4000-8000-000000002062"
nonce_digest="$(printf 'e%.0s' {1..64})"
holder_log="$(mktemp)"
contender_log="$(mktemp)"

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
delete from public.payment_attempts where ref_id = '${order_id}'::uuid;
delete from public.order_items where order_id = '${order_id}'::uuid;
delete from public.orders where id = '${order_id}'::uuid;
delete from public.goods where id = 'goods-payment-claim-good';
delete from public.ips where id = 'goods-payment-claim-ip';
delete from public.verticals where key = 'goods-payment-claim';
delete from public.profiles where id = '${user_id}'::uuid;
delete from auth.users where id = '${user_id}'::uuid;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$holder_log" "$contender_log"
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
  'goods-payment-claim@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'goods-payment-claim@example.test',
  nickname = 'goods_payment_claim',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${user_id}'::uuid;

insert into public.verticals (key, label, color)
values ('goods-payment-claim', '굿즈 결제 claim 동시성', '#000000');

insert into public.ips (id, title, vertical_key)
values ('goods-payment-claim-ip', '굿즈 결제 claim IP', 'goods-payment-claim');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-payment-claim-good', 'goods-payment-claim-ip',
  '굿즈 결제 claim 상품', '테스트', 28000, 'ok', 10
);

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values (
  '${order_id}', '${user_id}', 'pending', 31000, 3000,
  pg_catalog.now() + interval '15 minutes',
  '10000000-0000-4000-8000-000000002061'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '${order_id}', 'goods-payment-claim-good', 1, 28000,
  '굿즈 결제 claim 상품', '테스트', 'goods-payment-claim-ip'
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

holder_application="${test_prefix}-holder"
contender_application="${test_prefix}-contender"

docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$holder_log" 2>&1 <<SQL &
begin;
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${holder_claim}'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
holder_client_pid=$!

wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

docker exec -e PGAPPNAME="$contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$contender_log" 2>&1 <<SQL &
select public.claim_goods_payment_attempt(
  'korpay', '${provider_order_id}', '${nonce_digest}', '${contender_claim}'
);
SQL
contender_client_pid=$!

wait_for_backend_wait "$contender_application" "Lock" "$contender_client_pid" "$contender_log"
wait "$holder_client_pid"
wait "$contender_client_pid"

if ! grep -q '"claim_status": "claimed"' "$holder_log"; then
  echo "first callback did not claim the attempt" >&2
  sed -n '1,160p' "$holder_log" >&2
  exit 1
fi
if ! grep -q '"claim_status": "in_progress"' "$contender_log"; then
  echo "duplicate callback did not converge to in_progress" >&2
  sed -n '1,160p' "$contender_log" >&2
  exit 1
fi

final_state="$(psql_scalar "
  select case when
    state = 'confirming'
    and claim_token = '${holder_claim}'::uuid
    and claim_expires_at is not null
  then 'ok' else 'invalid' end
  from public.payment_attempts
  where ref_id = '${order_id}'::uuid
")"

if [[ "$final_state" != "ok" ]]; then
  echo "concurrent callback claims did not leave one durable owner" >&2
  exit 1
fi

echo "PASS=single-durable-callback-claim"

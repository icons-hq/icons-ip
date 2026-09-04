#!/usr/bin/env bash
set -euo pipefail

# D-1b — 가용이 1인 품목을 두 세션이 동시에 주문하면 한쪽만 성공한다.
#
# 예약은 (품목, 출고지) 행을 `for update` 로 잡고 가용을 다시 읽은 뒤 결정한다. READ COMMITTED 에서
# 뒤늦은 트랜잭션은 앞선 잠금이 풀린 뒤 갱신된 행을 다시 읽으므로, 마지막 1개를 둘이 나눠 갖지 못한다.

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="order-reserve-race-$$"
buyer_one="00000000-0000-4000-8000-0000000020d1"
buyer_two="00000000-0000-4000-8000-0000000020d2"
good_id="order-reserve-race-good"
ip_id="order-reserve-race-ip"
vertical_key="order-reserve-race"
one_log="$(mktemp)"
two_log="$(mktemp)"

psql_exec() {
  docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

psql_scalar() {
  docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -c "$1"
}

cleanup_fixtures() {
  # `set local` 은 트랜잭션 안에서만 듣는다 — 원장 파기 의사표시를 켜려면 명시적으로 연다.
  psql_exec -q <<SQL >/dev/null 2>&1 || true
begin;
set local icons.stock_ledger_purge = '1';
delete from public.order_items where good_id = '${good_id}';
delete from public.orders where user_id in ('${buyer_one}'::uuid, '${buyer_two}'::uuid);
delete from public.cart_items where user_id in ('${buyer_one}'::uuid, '${buyer_two}'::uuid);
delete from public.stock_movements where variant_id in (
  select id from public.good_variants where good_id = '${good_id}'
);
delete from public.variant_stocks where variant_id in (
  select id from public.good_variants where good_id = '${good_id}'
);
delete from public.good_variants where good_id = '${good_id}';
delete from public.goods where id = '${good_id}';
delete from public.ips where id = '${ip_id}';
delete from public.verticals where key = '${vertical_key}';
delete from public.profiles where id in ('${buyer_one}'::uuid, '${buyer_two}'::uuid);
delete from auth.users where id in ('${buyer_one}'::uuid, '${buyer_two}'::uuid);
commit;
SQL
}

cleanup() {
  set +e
  cleanup_fixtures
  rm -f "$one_log" "$two_log"
}
trap cleanup EXIT

cleanup_fixtures

psql_exec -q <<SQL
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('${buyer_one}', 'authenticated', 'authenticated', 'reserve-race-one@example.test', now(), '{}', '{}', now(), now()),
  ('${buyer_two}', 'authenticated', 'authenticated', 'reserve-race-two@example.test', now(), '{}', '{}', now(), now())
on conflict (id) do nothing;

insert into public.profiles (id, email, nickname, birth_date, consents, onboarded_at)
values
  ('${buyer_one}', 'reserve-race-one@example.test', 'reserve_race_one', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now()),
  ('${buyer_two}', 'reserve-race-two@example.test', 'reserve_race_two', '2000-01-01', '{"terms":true,"privacy":true}'::jsonb, now())
on conflict (id) do update set
  email = excluded.email, nickname = excluded.nickname, birth_date = excluded.birth_date,
  consents = excluded.consents, onboarded_at = excluded.onboarded_at;

insert into public.verticals (key, label, color) values ('${vertical_key}', '동시 예약 테스트', '#000000')
on conflict (key) do nothing;
insert into public.ips (id, title, vertical_key) values ('${ip_id}', '동시 예약 테스트 IP', '${vertical_key}')
on conflict (id) do nothing;
insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('${good_id}', '${ip_id}', '동시 예약 테스트 굿즈', '문구', 1000, 'ok', 1)
on conflict (id) do nothing;

insert into public.cart_items (user_id, good_id, qty)
values ('${buyer_one}', '${good_id}', 1), ('${buyer_two}', '${good_id}', 1);
SQL

place_order_sql() {
  local user_id="$1"
  cat <<SQL
select public.place_order(
  '${user_id}'::uuid,
  '{"recipientName":"동시","phone":"01012345678","postalCode":"06236","address1":"서울시 강남구 테헤란로 1"}'::jsonb,
  pg_catalog.gen_random_uuid()
);
SQL
}

place_order_sql "$buyer_one" | docker exec -i "$db_container" psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "set application_name = '${test_prefix}-one'" -f - >"$one_log" 2>&1 &
one_pid=$!
place_order_sql "$buyer_two" | docker exec -i "$db_container" psql -X -U postgres -d postgres \
  -v ON_ERROR_STOP=1 -c "set application_name = '${test_prefix}-two'" -f - >"$two_log" 2>&1 &
two_pid=$!

set +e
wait "$one_pid"; one_status=$?
wait "$two_pid"; two_status=$?
set -e

successes=0
[ "$one_status" -eq 0 ] && successes=$((successes + 1))
[ "$two_status" -eq 0 ] && successes=$((successes + 1))

if [ "$successes" -ne 1 ]; then
  echo "expected exactly one order to succeed, got ${successes}" >&2
  echo "--- session one ---" >&2; cat "$one_log" >&2
  echo "--- session two ---" >&2; cat "$two_log" >&2
  exit 1
fi

if ! grep -q "out of stock" "$one_log" "$two_log"; then
  echo "the losing session must fail with 'out of stock'" >&2
  cat "$one_log" "$two_log" >&2
  exit 1
fi

orders="$(psql_scalar "select count(*) from public.orders where user_id in ('${buyer_one}'::uuid, '${buyer_two}'::uuid)")"
reserved="$(psql_scalar "select stock.reserved_qty from public.variant_stocks as stock join public.good_variants as variant on variant.id = stock.variant_id where variant.good_id = '${good_id}' and stock.location_id = 'gimpo'")"
available="$(psql_scalar "select stock_qty from public.goods where id = '${good_id}'")"

if [ "$orders" != "1" ] || [ "$reserved" != "1" ] || [ "$available" != "0" ]; then
  echo "expected 1 order / reserved 1 / available 0, got ${orders} / ${reserved} / ${available}" >&2
  exit 1
fi

echo "order_variant_reservation_concurrency: one order, reserved=1, available=0"

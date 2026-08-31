#!/usr/bin/env bash
set -euo pipefail

# 발급 한도 마지막 1장을 두 사용자가 동시에 요구하는 경합.
# apply_cart_coupon_code는 coupons 행을 for update로 잠근 뒤 issued_count를
# 검사·증가시킨다 — 두 번째 세션은 잠금 뒤에 줄을 서고, 먼저 커밋한 쪽만
# 발급받아야 한다. 행 잠금이 사라지면 둘 다 발급돼 한도가 초과된다.

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="coupon-issue-concurrency-$$"
first_user_id="00000000-0000-4000-8000-000000000741"
second_user_id="00000000-0000-4000-8000-000000000742"
coupon_code="CPNRACE1"
work_dir="$(mktemp -d)"
holder_log="${work_dir}/holder.log"
racer_log="${work_dir}/racer.log"

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
delete from public.cart_coupon_selections
where user_id in ('${first_user_id}'::uuid, '${second_user_id}'::uuid);
delete from public.user_coupons where coupon_code = '${coupon_code}';
delete from public.coupons where code = '${coupon_code}';
delete from public.cart_items
where user_id in ('${first_user_id}'::uuid, '${second_user_id}'::uuid);
delete from public.goods where id = 'coupon-race-good';
delete from public.ips where id = 'coupon-race-ip';
delete from public.profiles
where id in ('${first_user_id}'::uuid, '${second_user_id}'::uuid);
delete from auth.users
where id in ('${first_user_id}'::uuid, '${second_user_id}'::uuid);
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -rf "$work_dir"
}
trap cleanup exit

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
values
  (
    '${first_user_id}', 'authenticated', 'authenticated',
    'coupon-race-one@example.test', pg_catalog.now(),
    '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '${second_user_id}', 'authenticated', 'authenticated',
    'coupon-race-two@example.test', pg_catalog.now(),
    '{}', '{}', pg_catalog.now(), pg_catalog.now()
  );

update public.profiles
set
  email = 'coupon-race-one@example.test',
  nickname = 'coupon_race_one',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${first_user_id}'::uuid;

update public.profiles
set
  email = 'coupon-race-two@example.test',
  nickname = 'coupon_race_two',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${second_user_id}'::uuid;

insert into public.ips (id, title, vertical_key)
values ('coupon-race-ip', '쿠폰 경합 IP', 'character');

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values ('coupon-race-good', 'coupon-race-ip', '쿠폰 경합 굿즈', '피규어', 30000, 'ok', 10);

insert into public.cart_items (user_id, good_id, qty)
values
  ('${first_user_id}'::uuid, 'coupon-race-good', 1),
  ('${second_user_id}'::uuid, 'coupon-race-good', 1);

insert into public.coupons (
  code, name, discount_type, discount_value, min_subtotal, issue_limit, status
)
values ('${coupon_code}', '경합 한도 1장', 'fixed', 1000, 0, 1, 'active');
SQL

holder_application="${test_prefix}-holder"
racer_application="${test_prefix}-racer"

# 첫 세션: 발급 트랜잭션을 열어 둔 채 잠깐 커밋을 지연한다(coupons 행 잠금
# 보유). 취소(pg_cancel_backend)는 트랜잭션을 abort시켜 발급이 롤백되므로,
# 짧은 sleep 뒤 자연 커밋으로 확정한다.
docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$holder_log" 2>&1 <<SQL &
begin;
select pg_catalog.set_config('request.jwt.claim.sub', '${first_user_id}', true);
set local role authenticated;
select public.apply_cart_coupon_code('${coupon_code}');
select pg_catalog.pg_sleep(3);
commit;
SQL
holder_client_pid=$!
wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

# 두 번째 세션: 같은 코드 발급 시도 — coupons 행 잠금 뒤에 줄을 서야 한다.
docker exec -e PGAPPNAME="$racer_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$racer_log" 2>&1 <<SQL &
begin;
select pg_catalog.set_config('request.jwt.claim.sub', '${second_user_id}', true);
set local role authenticated;
select public.apply_cart_coupon_code('${coupon_code}');
commit;
SQL
racer_client_pid=$!
wait_for_backend_wait "$racer_application" "Lock" "$racer_client_pid" "$racer_log"

# 첫 세션이 sleep을 마치고 커밋할 때까지 기다린다.
if ! wait "$holder_client_pid"; then
  echo "first issuance should have committed" >&2
  sed -n '1,160p' "$holder_log" >&2
  exit 1
fi

# 두 번째 세션은 한도 소진으로 실패해야 한다.
if wait "$racer_client_pid"; then
  echo "second issuance should have failed after the limit was consumed" >&2
  sed -n '1,160p' "$racer_log" >&2
  exit 1
fi

if ! grep -q 'coupon_exhausted' "$racer_log"; then
  echo "second issuance failed for an unexpected reason" >&2
  sed -n '1,160p' "$racer_log" >&2
  exit 1
fi

final_state="$(psql_scalar "
  select case when
    (select issued_count from public.coupons where code = '${coupon_code}') = 1
    and (select count(*) from public.user_coupons where coupon_code = '${coupon_code}') = 1
    and exists (
      select 1 from public.user_coupons
      where coupon_code = '${coupon_code}' and user_id = '${first_user_id}'::uuid
    )
  then 'ok' else 'invalid' end
")"

if [[ "$final_state" != "ok" ]]; then
  echo "issue limit was not serialized by the coupon row lock" >&2
  psql_scalar "select issued_count from public.coupons where code = '${coupon_code}'" >&2
  exit 1
fi

echo "PASS=coupon-issue-limit-race"

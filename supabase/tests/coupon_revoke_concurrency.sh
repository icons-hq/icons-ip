#!/usr/bin/env bash
set -euo pipefail

# 쿠폰 회수(PAY-034)와 결제의 쿠폰 사용이 같은 쿠폰을 두고 겹치는 경합.
# 회수·결제는 같은 회원 잠금(lock_goods_transaction_actor) → user_coupons 행 순서라 한쪽이 먼저 끝나고 다른 쪽이 그 결과를 본다.
#  1) 결제가 먼저: 회수는 줄을 서고, 결제가 커밋한 뒤 in_use 로 거절한다(쿠폰은 사용 상태 그대로).
#  2) 회수가 먼저: 결제는 줄을 서고, 회수가 커밋한 뒤에는 쿠폰이 만료로 평가되며 사용 처리(status=used)가 DB 제약으로 거절된다.

db_container="${SUPABASE_DB_CONTAINER:?Select a CI or disposable local test container}"
test_scope="${COUPON_REVOKE_TEST_SCOPE:?Set ci or isolated-local}"
case "$test_scope" in ci|isolated-local) ;; *) echo 'Unsupported test scope' >&2; exit 1;; esac
case "$db_container" in supabase_db_*) ;; *) echo 'Expected an explicitly selected local Supabase DB container' >&2; exit 1;; esac

test_prefix="coupon-revoke-concurrency-$$"
operator_id="bfc02900-0000-4000-8000-000000000001"
holder_id="bfc02900-0000-4000-8000-000000000002"
session_id="bfc02900-0000-4000-8000-000000000009"
op_one="bfc02900-0000-4000-8000-0000000000a1"
op_two="bfc02900-0000-4000-8000-0000000000a2"
coupon_code="CPNREVRACE"
work_dir="$(mktemp -d)"

psql_exec() { docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_scalar() { docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t -c "$1"; }

terminate_test_backends() {
  psql_exec -q <<SQL >/dev/null 2>&1 || true
select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
where application_name like '${test_prefix}-%' and pid <> pg_catalog.pg_backend_pid();
SQL
}

cleanup_fixtures() {
  psql_exec -q <<SQL >/dev/null 2>&1 || true
delete from public.audit_log where actor_id = '${operator_id}'::uuid;
delete from public.user_coupons where coupon_code = '${coupon_code}';
delete from public.coupons where code = '${coupon_code}';
delete from auth.sessions where id = '${session_id}'::uuid;
delete from private.operator_memberships where profile_id = '${operator_id}'::uuid;
delete from public.profiles where id in ('${operator_id}'::uuid, '${holder_id}'::uuid);
delete from auth.users where id in ('${operator_id}'::uuid, '${holder_id}'::uuid);
SQL
}

cleanup() { set +e; terminate_test_backends; cleanup_fixtures; rm -rf "$work_dir"; }
trap cleanup exit

wait_for_backend_wait() {
  local application_name="$1" expected="$2" client_pid="$3" log_file="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_scalar "select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') from pg_catalog.pg_stat_activity where application_name = '${application_name}'")"
    if [[ "$observed" == "${expected}:"* ]]; then return 0; fi
    if ! kill -0 "$client_pid" 2>/dev/null; then echo "backend exited before ${expected} wait: ${application_name}" >&2; sed -n '1,160p' "$log_file" >&2; return 1; fi
    sleep 0.05
  done
  echo "timed out waiting for ${expected}: ${application_name} (last=${observed})" >&2; sed -n '1,160p' "$log_file" >&2; return 1
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
insert into auth.users (id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('${operator_id}', 'authenticated', 'authenticated', 'coupon-revoke-op@example.test', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now()),
  ('${holder_id}', 'authenticated', 'authenticated', 'coupon-revoke-holder@example.test', pg_catalog.now(), '{}', '{}', pg_catalog.now(), pg_catalog.now());
update public.profiles set nickname = 'coupon_revoke_' || right(id::text, 2), birth_date = '2000-01-01', consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now(), role = case when id = '${operator_id}'::uuid then 'staff'::public.user_role else 'user'::public.user_role end
where id in ('${operator_id}'::uuid, '${holder_id}'::uuid);
insert into private.operator_memberships(profile_id, manager_role) values ('${operator_id}', 'primary');
insert into auth.sessions(id, user_id, created_at, updated_at, not_after) values ('${session_id}', '${operator_id}', now(), now(), now() + interval '1 hour');
insert into public.coupons(code, name, discount_type, discount_value, min_subtotal, starts_at, status, issuance_mode)
values ('${coupon_code}', '회수 경합', 'fixed', 1000, 0, now() - interval '1 day', 'active', 'targeted');
SQL

issue_coupon() {
  psql_scalar "select private.issue_coupon_code('${coupon_code}', '${holder_id}'::uuid, 'admin_grant')"
}
revoke_sql="select public.admin_revoke_user_coupons(array['%s']::uuid[], '경합 검사 회수', '%s')"
operator_session() {
  cat <<SQL
begin;
select pg_catalog.set_config('request.jwt.claim.sub', '${operator_id}', true);
select pg_catalog.set_config('request.jwt.claims', '{"sub":"${operator_id}","session_id":"${session_id}","role":"authenticated"}', true);
set local role authenticated;
SQL
}

# ── 1) 결제가 먼저 ────────────────────────────────────────────────────────────
held_one="$(issue_coupon)"
holder_log="${work_dir}/pay-first-holder.log"; racer_log="${work_dir}/pay-first-racer.log"
docker exec -e PGAPPNAME="${test_prefix}-payer" -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$holder_log" 2>&1 <<SQL &
begin;
select private.lock_goods_transaction_actor('${holder_id}'::uuid);
select 1 from public.user_coupons where id = '${held_one}'::uuid for update;
select pg_catalog.pg_sleep(2);
update public.user_coupons set status = 'used', used_at = pg_catalog.now() where id = '${held_one}'::uuid and status <> 'used';
commit;
SQL
payer_pid=$!
wait_for_backend_wait "${test_prefix}-payer" "Timeout" "$payer_pid" "$holder_log"
{ operator_session; printf "$revoke_sql;\ncommit;\n" "$held_one" "$op_one"; } | docker exec -e PGAPPNAME="${test_prefix}-revoker" -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$racer_log" 2>&1 &
revoker_pid=$!
wait_for_backend_wait "${test_prefix}-revoker" "Lock" "$revoker_pid" "$racer_log"
wait "$payer_pid"
wait "$revoker_pid"
state_one="$(psql_scalar "select status || ':' || (revoked_at is not null)::text from public.user_coupons where id = '${held_one}'::uuid")"
if [[ "$state_one" != "used:false" ]] || ! grep -q '"status": "in_use"' "$racer_log"; then
  echo "payment-first race: expected in_use rejection, got state=${state_one}" >&2; sed -n '1,80p' "$racer_log" >&2; exit 1
fi
psql_exec -q -c "delete from public.user_coupons where id = '${held_one}'::uuid" >/dev/null
psql_exec -q -c "update public.coupons set issued_count = 0 where code = '${coupon_code}'" >/dev/null

# ── 2) 회수가 먼저 ────────────────────────────────────────────────────────────
held_two="$(issue_coupon)"
holder_log="${work_dir}/revoke-first-holder.log"; racer_log="${work_dir}/revoke-first-racer.log"
{ operator_session; printf "$revoke_sql;\nselect pg_catalog.pg_sleep(2);\ncommit;\n" "$held_two" "$op_two"; } | docker exec -e PGAPPNAME="${test_prefix}-revoke-holder" -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$holder_log" 2>&1 &
revoke_holder_pid=$!
wait_for_backend_wait "${test_prefix}-revoke-holder" "Timeout" "$revoke_holder_pid" "$holder_log"
docker exec -e PGAPPNAME="${test_prefix}-late-payer" -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$racer_log" 2>&1 <<SQL &
begin;
select private.lock_goods_transaction_actor('${holder_id}'::uuid);
update public.user_coupons set status = 'used', used_at = pg_catalog.now() where id = '${held_two}'::uuid and status <> 'used';
commit;
SQL
late_pid=$!
wait_for_backend_wait "${test_prefix}-late-payer" "Lock" "$late_pid" "$racer_log"
wait "$revoke_holder_pid"
if wait "$late_pid"; then echo "revoke-first race: the late payment must not mark a revoked coupon used" >&2; sed -n '1,80p' "$racer_log" >&2; exit 1; fi
if ! grep -q 'user_coupons_revoke_shape' "$racer_log"; then echo "revoke-first race: unexpected failure" >&2; sed -n '1,80p' "$racer_log" >&2; exit 1; fi
state_two="$(psql_scalar "select status || ':' || (revoked_at is not null)::text || ':' || ((select o_reason from private.evaluate_user_coupon(id, user_id, 20000)))
  from public.user_coupons where id = '${held_two}'::uuid")"
if [[ "$state_two" != "active:true:coupon_expired" ]]; then echo "revoke-first race: unexpected final state ${state_two}" >&2; exit 1; fi

echo "coupon revoke vs checkout race: ok (payment-first=${state_one}, revoke-first=${state_two})"

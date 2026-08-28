#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-manual-recovery-race-$$"
owner_id="00000000-0000-4000-8000-000000002091"
admin_id="00000000-0000-4000-8000-000000002092"
order_id="20000000-0000-4000-8000-000000002091"
attempt_id="30000000-0000-4000-8000-000000002091"
request_id="60000000-0000-4000-8000-000000002091"
first_manual_token="70000000-0000-4000-8000-000000002091"
second_manual_token="70000000-0000-4000-8000-000000002092"
callback_token="40000000-0000-4000-8000-000000002091"
callback_race_manual_token="70000000-0000-4000-8000-000000002093"
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
delete from private.goods_payment_manual_recovery_claims
where order_id = '${order_id}'::uuid;
delete from private.goods_payment_manual_recovery_audits
where order_id = '${order_id}'::uuid;
delete from public.order_cancellation_claims
where order_id = '${order_id}'::uuid;
delete from public.order_cancellation_requests
where order_id = '${order_id}'::uuid;
delete from public.audit_log
where actor_id = '${admin_id}'::uuid
  and action like 'admin.payment.goods_manual_%';
delete from public.payment_attempts
where ref_id = '${order_id}'::uuid;
delete from public.order_items
where order_id = '${order_id}'::uuid;
delete from public.orders
where id = '${order_id}'::uuid;
delete from public.goods
where id = 'goods-manual-recovery-race-good';
delete from public.ips
where id = 'goods-manual-recovery-race-ip';
delete from public.verticals
where key = 'goods-manual-recovery-race';
delete from public.profiles
where id in ('${owner_id}'::uuid, '${admin_id}'::uuid);
delete from auth.users
where id in ('${owner_id}'::uuid, '${admin_id}'::uuid);
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
values
  (
    '${owner_id}', 'authenticated', 'authenticated',
    'goods-manual-race-owner@example.test', pg_catalog.now(),
    '{}', '{}', pg_catalog.now(), pg_catalog.now()
  ),
  (
    '${admin_id}', 'authenticated', 'authenticated',
    'goods-manual-race-admin@example.test', pg_catalog.now(),
    '{}', '{}', pg_catalog.now(), pg_catalog.now()
  );

insert into public.profiles (
  id, email, nickname, birth_date, consents, onboarded_at, role
)
values
  (
    '${owner_id}', 'goods-manual-race-owner@example.test',
    'goods_manual_race_owner', '2000-01-01',
    '{"terms":true,"privacy":true}', pg_catalog.now(), 'user'
  ),
  (
    '${admin_id}', 'goods-manual-race-admin@example.test',
    'goods_manual_race_admin', '2000-01-01',
    '{"terms":true,"privacy":true}', pg_catalog.now(), 'admin'
  )
on conflict (id) do update set
  role = excluded.role,
  suspended_at = null,
  suspension_reason = null;

insert into public.verticals (key, label, color)
values ('goods-manual-recovery-race', '굿즈 수동 복구 경합', '#000000');

insert into public.ips (id, title, vertical_key)
values (
  'goods-manual-recovery-race-ip',
  '굿즈 수동 복구 경합 IP',
  'goods-manual-recovery-race'
);

insert into public.goods (id, ip_id, name, type, price, stock, stock_qty)
values (
  'goods-manual-recovery-race-good',
  'goods-manual-recovery-race-ip',
  '굿즈 수동 복구 경합 상품',
  '문구', 28000, 'ok', 10
);

insert into public.orders (
  id, user_id, status, total, shipping_fee, expires_at, checkout_key
)
values (
  '${order_id}', '${owner_id}', 'pending', 31000, 3000,
  pg_catalog.now() + interval '15 minutes',
  '10000000-0000-4000-8000-000000002091'
);

insert into public.order_items (
  order_id, good_id, qty, unit_price,
  good_name_snapshot, good_type_snapshot, good_ip_id_snapshot
)
values (
  '${order_id}', 'goods-manual-recovery-race-good', 1, 28000,
  '굿즈 수동 복구 경합 상품', '문구',
  'goods-manual-recovery-race-ip'
);

insert into public.payment_attempts (
  id, provider, user_id, purpose, ref_id, amount, currency, state,
  idempotency_key, provider_order_id, provider_product_code, expires_at
)
values (
  '${attempt_id}', 'korpay', '${owner_id}', 'order', '${order_id}',
  31000, 'KRW', 'unknown', 'goods-manual-race:${order_id}',
  'O30000000000040008000000000002091',
  'P30000000000040008000000000002091',
  pg_catalog.now() + interval '15 minutes'
);

insert into public.order_cancellation_requests (
  id, order_id, requested_by, reason, reason_type, status,
  decided_by, decided_at, provider_started_at, last_error_code
)
values (
  '${request_id}', '${order_id}', '${owner_id}',
  '결제사 전액 취소 확인 후 정합화', 'change_of_mind', 'needs_review',
  '${admin_id}', pg_catalog.now(), pg_catalog.now(),
  'manual_provider_confirmation_required'
);

insert into public.order_cancellation_claims (
  order_id, requested_by, previous_status
)
values ('${order_id}', '${owner_id}', 'pending');
SQL

# The first admin owns the order lock and durable manual claim. A second claim
# waits on the same order, then converges to in_progress without replacing it.
holder_application="${test_prefix}-manual-holder"
contender_application="${test_prefix}-manual-contender"

docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$holder_log" 2>&1 <<SQL &
begin;
select public.claim_goods_manual_payment_recovery(
  '${attempt_id}', '${admin_id}', '${request_id}',
  'case_v1_11111111111111111111111111111111',
  'provider_cancel_confirmed', '${first_manual_token}'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
holder_client_pid=$!

wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

docker exec -e PGAPPNAME="$contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$contender_log" 2>&1 <<SQL &
select public.claim_goods_manual_payment_recovery(
  '${attempt_id}', '${admin_id}', '${request_id}',
  'case_v1_22222222222222222222222222222222',
  'provider_cancel_confirmed', '${second_manual_token}'
);
SQL
contender_client_pid=$!

wait_for_backend_wait "$contender_application" "Lock" "$contender_client_pid" "$contender_log"
wait "$holder_client_pid"
wait "$contender_client_pid"

if ! grep -q '"claim_status": "claimed"' "$holder_log"; then
  echo "first manual recovery did not claim the attempt" >&2
  sed -n '1,160p' "$holder_log" >&2
  exit 1
fi
if ! grep -q '"claim_status": "in_progress"' "$contender_log"; then
  echo "second manual recovery did not converge to in_progress" >&2
  sed -n '1,160p' "$contender_log" >&2
  exit 1
fi

manual_race_state="$(psql_scalar "
  select case when
    attempt.state = 'confirming'
    and attempt.claim_token = '${first_manual_token}'::uuid
    and manual_claim.claim_token = '${first_manual_token}'::uuid
    and manual_claim.prior_attempt_state = 'unknown'
  then 'ok' else 'invalid' end
  from public.payment_attempts as attempt
  join private.goods_payment_manual_recovery_claims as manual_claim
    on manual_claim.attempt_id = attempt.id
  where attempt.id = '${attempt_id}'::uuid
")"

if [[ "$manual_race_state" != "ok" ]]; then
  echo "manual/manual race did not preserve one durable owner" >&2
  exit 1
fi

echo "PASS=manual-claim-race-has-one-owner"

# Reset only the unfinalized test claim. A stale provider callback token now
# races a manual takeover. The callback waits for the order lock and must fail
# after seeing that its token was superseded by the admin claim.
psql_exec -q <<SQL >/dev/null
delete from private.goods_payment_manual_recovery_claims
where attempt_id = '${attempt_id}'::uuid;
update public.payment_attempts
set
  state = 'confirming',
  claim_token = '${callback_token}',
  claim_expires_at = pg_catalog.now() - interval '1 minute'
where id = '${attempt_id}'::uuid;
SQL

: >"$holder_log"
: >"$contender_log"
holder_application="${test_prefix}-callback-race-manual"
contender_application="${test_prefix}-callback-race-provider"

docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$holder_log" 2>&1 <<SQL &
begin;
select public.claim_goods_manual_payment_recovery(
  '${attempt_id}', '${admin_id}', '${request_id}',
  'case_v1_33333333333333333333333333333333',
  'provider_cancel_confirmed', '${callback_race_manual_token}'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
holder_client_pid=$!

wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

docker exec -e PGAPPNAME="$contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$contender_log" 2>&1 <<SQL &
select public.finalize_goods_payment_attempt(
  '${attempt_id}', '${callback_token}', 'canceled'
);
SQL
contender_client_pid=$!

wait_for_backend_wait "$contender_application" "Lock" "$contender_client_pid" "$contender_log"
wait "$holder_client_pid"
if wait "$contender_client_pid"; then
  echo "superseded provider callback unexpectedly finalized" >&2
  sed -n '1,160p' "$contender_log" >&2
  exit 1
fi

if ! grep -q 'goods_payment_claim_invalid' "$contender_log"; then
  echo "provider callback did not fail on the superseded claim" >&2
  sed -n '1,160p' "$contender_log" >&2
  exit 1
fi

callback_race_state="$(psql_scalar "
  select case when
    order_record.status = 'pending'
    and attempt.state = 'confirming'
    and attempt.claim_token = '${callback_race_manual_token}'::uuid
    and manual_claim.claim_token = '${callback_race_manual_token}'::uuid
    and good.stock_qty = 10
    and not exists (
      select 1 from public.payments as payment
      where payment.purpose = 'order' and payment.ref_id = order_record.id
    )
    and not exists (
      select 1 from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order' and payment.ref_id = order_record.id
    )
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt on attempt.ref_id = order_record.id
  join private.goods_payment_manual_recovery_claims as manual_claim
    on manual_claim.attempt_id = attempt.id
  join public.goods as good on good.id = 'goods-manual-recovery-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$callback_race_state" != "ok" ]]; then
  echo "callback/manual race mutated order, stock, or payment history" >&2
  exit 1
fi

echo "PASS=manual-takeover-supersedes-stale-callback"

terminal_outcome="$(psql_scalar "
  select public.finalize_goods_manual_payment_recovery(
    '${attempt_id}', '${admin_id}', '${request_id}',
    'case_v1_33333333333333333333333333333333',
    'provider_cancel_confirmed', '${callback_race_manual_token}', true
  )
")"

if [[ "$terminal_outcome" != "provider_cancel_confirmed" ]]; then
  echo "winning manual claim did not finalize" >&2
  exit 1
fi

terminal_state="$(psql_scalar "
  select case when
    order_record.status = 'canceled'
    and attempt.state = 'canceled'
    and attempt.payment_id is null
    and request.status = 'completed'
    and good.stock_qty = 11
    and not exists (
      select 1 from public.payments as payment
      where payment.purpose = 'order' and payment.ref_id = order_record.id
    )
    and not exists (
      select 1 from public.refunds as refund
      join public.payments as payment on payment.id = refund.payment_id
      where payment.purpose = 'order' and payment.ref_id = order_record.id
    )
    and not exists (
      select 1 from private.goods_payment_manual_recovery_claims as claim
      where claim.attempt_id = attempt.id
    )
    and not exists (
      select 1 from public.order_cancellation_claims as claim
      where claim.order_id = order_record.id
    )
    and (
      select count(*) = 1
      from private.goods_payment_manual_recovery_audits as audit
      where audit.attempt_id = attempt.id
        and audit.prior_attempt_state = 'confirming'
        and audit.outcome = 'provider_cancel_confirmed'
    )
    and (
      select count(*) = 1
      from public.audit_log as audit
      where audit.actor_id = '${admin_id}'::uuid
        and audit.action = 'admin.payment.goods_manual_provider_cancel_confirmed'
        and audit.target = 'order:' || order_record.id::text
    )
  then 'ok' else 'invalid' end
  from public.orders as order_record
  join public.payment_attempts as attempt on attempt.ref_id = order_record.id
  join public.order_cancellation_requests as request on request.order_id = order_record.id
  join public.goods as good on good.id = 'goods-manual-recovery-race-good'
  where order_record.id = '${order_id}'::uuid
")"

if [[ "$terminal_state" != "ok" ]]; then
  echo "winning manual finalization did not converge once" >&2
  exit 1
fi

echo "PASS=winning-manual-finalizes-stock-once"

terminal_replay="$(psql_scalar "
  select public.claim_goods_manual_payment_recovery(
    '${attempt_id}', '${admin_id}', '${request_id}',
    'case_v1_44444444444444444444444444444444',
    'provider_cancel_confirmed', '70000000-0000-4000-8000-000000002094'
  )
")"

if [[ "$terminal_replay" != *'"claim_status": "terminal"'* \
  || "$terminal_replay" != *'"outcome": "provider_cancel_confirmed"'* ]]; then
  echo "terminal manual replay did not return the stored outcome" >&2
  printf '%s\n' "$terminal_replay" >&2
  exit 1
fi

replay_state="$(psql_scalar "
  select case when
    good.stock_qty = 11
    and (
      select count(*) = 1
      from private.goods_payment_manual_recovery_audits as audit
      where audit.order_id = '${order_id}'::uuid
    )
    and (
      select count(*) = 1
      from public.audit_log as audit
      where audit.actor_id = '${admin_id}'::uuid
        and audit.action = 'admin.payment.goods_manual_provider_cancel_confirmed'
    )
  then 'ok' else 'invalid' end
  from public.goods as good
  where good.id = 'goods-manual-recovery-race-good'
")"

if [[ "$replay_state" != "ok" ]]; then
  echo "terminal replay duplicated stock or audit history" >&2
  exit 1
fi

echo "PASS=terminal-replay-keeps-stock-and-audit-once"

cleanup_fixtures
cleanup_state="$(psql_scalar "
  select case when
    (select count(*) from auth.users where id in ('${owner_id}'::uuid, '${admin_id}'::uuid)) = 0
    and (select count(*) from public.profiles where id in ('${owner_id}'::uuid, '${admin_id}'::uuid)) = 0
    and (select count(*) from public.orders where id = '${order_id}'::uuid) = 0
    and (select count(*) from public.payment_attempts where id = '${attempt_id}'::uuid) = 0
    and (select count(*) from private.goods_payment_manual_recovery_claims where order_id = '${order_id}'::uuid) = 0
    and (select count(*) from private.goods_payment_manual_recovery_audits where order_id = '${order_id}'::uuid) = 0
    and (
      select count(*) from public.audit_log
      where actor_id = '${admin_id}'::uuid
        and action like 'admin.payment.goods_manual_%'
    ) = 0
  then 'ok' else 'invalid' end
")"

if [[ "$cleanup_state" != "ok" ]]; then
  echo "manual recovery race fixtures were not fully cleaned" >&2
  exit 1
fi

echo "PASS=manual-recovery-race-cleanup"

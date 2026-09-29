#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="ticket-capacity-race-$$"
owner_one="00000000-0000-4000-8000-000000002071"
owner_two="00000000-0000-4000-8000-000000002072"
ticket_type="10000000-0000-4000-8000-000000002071"
catalog_ticket_type="10000000-0000-4000-8000-000000002073"
callback_ticket_type="10000000-0000-4000-8000-000000002074"
expiry_ticket_type="10000000-0000-4000-8000-000000002075"
staff_user="00000000-0000-4000-8000-000000002073"
holder_log="$(mktemp)"
contender_log="$(mktemp)"
catalog_holder_log="$(mktemp)"
catalog_contender_log="$(mktemp)"
cancel_holder_log="$(mktemp)"
callback_contender_log="$(mktemp)"
expiry_gate_log="$(mktemp)"
expiry_sweeper_log="$(mktemp)"
expiry_cancel_holder_log="$(mktemp)"

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
delete from private.payment_provider_evidence as evidence
using public.payment_attempts as attempt, public.ticket_orders as ticket_order
where evidence.payment_attempt_id = attempt.id
  and attempt.purpose = 'ticket'
  and attempt.ref_id = ticket_order.id
  and ticket_order.reservation_key in (
    '20000000-0000-4000-8000-000000002071'::uuid,
    '20000000-0000-4000-8000-000000002072'::uuid,
    '20000000-0000-4000-8000-000000002073'::uuid,
    '20000000-0000-4000-8000-000000002074'::uuid,
    '20000000-0000-4000-8000-000000002075'::uuid
  );
delete from public.payment_attempts as attempt
using public.ticket_orders as ticket_order
where attempt.purpose = 'ticket'
  and attempt.ref_id = ticket_order.id
  and ticket_order.reservation_key in (
    '20000000-0000-4000-8000-000000002071'::uuid,
    '20000000-0000-4000-8000-000000002072'::uuid,
    '20000000-0000-4000-8000-000000002073'::uuid,
    '20000000-0000-4000-8000-000000002074'::uuid,
    '20000000-0000-4000-8000-000000002075'::uuid
  );
delete from public.payments as payment
using public.ticket_orders as ticket_order
where payment.purpose = 'ticket'
  and payment.ref_id = ticket_order.id
  and ticket_order.reservation_key in (
    '20000000-0000-4000-8000-000000002071'::uuid,
    '20000000-0000-4000-8000-000000002072'::uuid,
    '20000000-0000-4000-8000-000000002073'::uuid,
    '20000000-0000-4000-8000-000000002074'::uuid,
    '20000000-0000-4000-8000-000000002075'::uuid
  );
delete from public.ticket_orders
where reservation_key in (
  '20000000-0000-4000-8000-000000002071'::uuid,
  '20000000-0000-4000-8000-000000002072'::uuid,
  '20000000-0000-4000-8000-000000002073'::uuid,
  '20000000-0000-4000-8000-000000002074'::uuid,
  '20000000-0000-4000-8000-000000002075'::uuid
);
delete from public.audit_log
where id = '30000000-0000-4000-8000-000000002073'::uuid
  or actor_id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);
delete from public.ticket_types where id in (
  '${ticket_type}'::uuid,
  '${catalog_ticket_type}'::uuid,
  '${callback_ticket_type}'::uuid,
  '${expiry_ticket_type}'::uuid
);
delete from public.events where id in ('ticket-payment-capacity-race', 'ticket-payment-catalog-race');
delete from public.profiles where id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);
delete from auth.users where id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f \
    "$holder_log" \
    "$contender_log" \
    "$catalog_holder_log" \
    "$catalog_contender_log" \
    "$cancel_holder_log" \
    "$callback_contender_log" \
    "$expiry_gate_log" \
    "$expiry_sweeper_log" \
    "$expiry_cancel_holder_log"
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

wait_for_lock() {
  wait_for_backend_wait "$1" "Lock" "$2" "$3"
}

release_gate() {
  local gate_application="$1"
  local gate_client_pid="$2"

  psql_exec -q <<SQL >/dev/null
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name = '${gate_application}';
SQL
  wait "$gate_client_pid" >/dev/null 2>&1 || true
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values
  ('${owner_one}', 'authenticated', 'authenticated', 'ticket-race-one@example.test', now(), '{}', '{}', now(), now()),
  ('${owner_two}', 'authenticated', 'authenticated', 'ticket-race-two@example.test', now(), '{}', '{}', now(), now()),
  ('${staff_user}', 'authenticated', 'authenticated', 'ticket-race-staff@example.test', now(), '{}', '{}', now(), now());

update public.profiles
set email = case id
      when '${owner_one}'::uuid then 'ticket-race-one@example.test'
      when '${owner_two}'::uuid then 'ticket-race-two@example.test'
      else 'ticket-race-staff@example.test'
    end,
    nickname = case id
      when '${owner_one}'::uuid then 'ticket_race_one'
      when '${owner_two}'::uuid then 'ticket_race_two'
      else 'ticket_race_staff'
    end,
    birth_date = '2000-01-01',
    consents = '{"terms":true,"privacy":true}',
    onboarded_at = now(),
    role = (
      case when id = '${staff_user}'::uuid then 'staff' else 'user' end
    )::public.user_role
where id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);

insert into public.events (id, title, mode, status, starts_at)
values
  (
    'ticket-payment-capacity-race', '티켓 정원 경합', '오프라인', '예매중',
    now() + interval '30 days'
  ),
  (
    'ticket-payment-catalog-race', '티켓 catalog 경합', '오프라인', '예매중',
    now() + interval '31 days'
  );

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit
)
values
  (
    '${ticket_type}', 'ticket-payment-capacity-race', '마지막 1석',
    10000, 1, 0, 1
  ),
  (
    '${catalog_ticket_type}', 'ticket-payment-capacity-race', 'catalog lock 회차',
    11000, 2, 0, 2
  ),
  (
    '${callback_ticket_type}', 'ticket-payment-capacity-race', 'callback 취소 경합',
    12000, 1, 0, 1
  ),
  (
    '${expiry_ticket_type}', 'ticket-payment-capacity-race', 'expiry 취소 경합',
    13000, 1, 0, 1
  );
SQL

holder_application="${test_prefix}-holder"
contender_application="${test_prefix}-contender"

docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$holder_log" 2>&1 <<SQL &
begin;
select public.reserve_tickets(
  '${owner_one}', '${ticket_type}', 1,
  '20000000-0000-4000-8000-000000002071'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
holder_pid=$!

# The holder sleeps only after reserve_tickets has taken the type row lock.
for _ in $(seq 1 200); do
  if grep -Eq '^[0-9a-f-]{36}$' "$holder_log"; then break; fi
  if ! kill -0 "$holder_pid" 2>/dev/null; then
    echo "holder exited before reserving capacity" >&2
    sed -n '1,160p' "$holder_log" >&2
    exit 1
  fi
  sleep 0.05
done

docker exec -e PGAPPNAME="$contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$contender_log" 2>&1 <<SQL &
select public.reserve_tickets(
  '${owner_two}', '${ticket_type}', 1,
  '20000000-0000-4000-8000-000000002072'
);
SQL
contender_pid=$!

wait_for_lock "$contender_application" "$contender_pid" "$contender_log"
wait "$holder_pid"
set +e
wait "$contender_pid"
contender_status=$?
set -e

if [[ "$contender_status" -eq 0 ]] || ! grep -q 'sold out' "$contender_log"; then
  echo "last ticket capacity was not serialized to one winner" >&2
  sed -n '1,160p' "$contender_log" >&2
  exit 1
fi

final_state="$(psql_scalar "
  select case when
    ticket_type.sold = 1
    and (select count(*) from public.ticket_orders
         where reservation_key in (
           '20000000-0000-4000-8000-000000002071'::uuid,
           '20000000-0000-4000-8000-000000002072'::uuid
         )) = 1
    and (select count(*) from public.tickets as ticket
         join public.ticket_orders as ticket_order on ticket_order.id = ticket.ticket_order_id
         where ticket_order.reservation_key in (
           '20000000-0000-4000-8000-000000002071'::uuid,
           '20000000-0000-4000-8000-000000002072'::uuid
         )) = 0
  then 'ok' else 'invalid' end
  from public.ticket_types as ticket_type
  where ticket_type.id = '${ticket_type}'::uuid
")"

if [[ "$final_state" != "ok" ]]; then
  echo "capacity race left inconsistent sold/order/ticket state" >&2
  exit 1
fi

echo "PASS=single-capacity-winner-without-preapproval-ticket"

catalog_holder_application="${test_prefix}-catalog-holder"
catalog_contender_application="${test_prefix}-catalog-contender"

docker exec -e PGAPPNAME="$catalog_holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$catalog_holder_log" 2>&1 <<SQL &
begin;
select public.reserve_tickets(
  '${owner_one}', '${catalog_ticket_type}', 1,
  '20000000-0000-4000-8000-000000002073'
);
select pg_catalog.pg_sleep(2);
commit;
SQL
catalog_holder_pid=$!

for _ in $(seq 1 200); do
  if grep -Eq '^[0-9a-f-]{36}$' "$catalog_holder_log"; then break; fi
  if ! kill -0 "$catalog_holder_pid" 2>/dev/null; then
    echo "catalog holder exited before reserving" >&2
    sed -n '1,160p' "$catalog_holder_log" >&2
    exit 1
  fi
  sleep 0.05
done

docker exec -e PGAPPNAME="$catalog_contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$catalog_contender_log" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '${staff_user}', true);
select public.admin_upsert_ticket_type(
  '30000000-0000-4000-8000-000000002073',
  '${catalog_ticket_type}',
  'ticket-payment-catalog-race',
  'catalog lock 회차',
  12000,
  2
);
commit;
SQL
catalog_contender_pid=$!

wait_for_lock "$catalog_contender_application" "$catalog_contender_pid" "$catalog_contender_log"
wait "$catalog_holder_pid"
set +e
wait "$catalog_contender_pid"
catalog_contender_status=$?
set -e

if [[ "$catalog_contender_status" -eq 0 ]] \
  || ! grep -q 'ticket_type_catalog_locked' "$catalog_contender_log"; then
  echo "reservation did not serialize and reject catalog mutation" >&2
  sed -n '1,160p' "$catalog_contender_log" >&2
  exit 1
fi

catalog_state="$(psql_scalar "
  select case when
    ticket_type.event_id = 'ticket-payment-capacity-race'
    and ticket_type.price = 11000
    and ticket_type.sold = 1
    and (select count(*) from public.ticket_order_reservations as reservation
         where reservation.ticket_type_id = '${catalog_ticket_type}'::uuid
           and reservation.unit_price = 11000) = 1
    and not exists (
      select 1 from public.audit_log
      where id = '30000000-0000-4000-8000-000000002073'::uuid
    )
    and not exists (
      select 1 from public.tickets as ticket
      where ticket.ticket_type_id = '${catalog_ticket_type}'::uuid
    )
  then 'ok' else 'invalid' end
  from public.ticket_types as ticket_type
  where ticket_type.id = '${catalog_ticket_type}'::uuid
")"

if [[ "$catalog_state" != "ok" ]]; then
  echo "catalog race left a mutated snapshot, audit row, or preapproval ticket" >&2
  exit 1
fi

echo "PASS=reservation-serializes-catalog-payment-fields"

# A user cancellation can commit while a known provider callback is waiting on
# the same order lock. The callback must still learn provider truth, record the
# paid ledger, withhold QR fulfillment, and make the request refund-ready.
callback_order_id="$(psql_scalar "
  select public.reserve_tickets(
    '${owner_one}',
    '${callback_ticket_type}',
    1,
    '20000000-0000-4000-8000-000000002074'
  )
")"
psql_exec -q <<SQL >/dev/null
select public.prepare_ticket_payment_attempt(
  '${owner_one}', '${callback_order_id}', 'korpay'
);
select public.bind_ticket_payment_callback_nonce(
  (
    select attempt.id
    from public.payment_attempts as attempt
    where attempt.purpose = 'ticket'
      and attempt.ref_id = '${callback_order_id}'::uuid
  ),
  repeat('a', 64)
);
SQL
callback_attempt_id="$(psql_scalar "
  select attempt.id
  from public.payment_attempts as attempt
  where attempt.purpose = 'ticket'
    and attempt.ref_id = '${callback_order_id}'::uuid
")"
callback_provider_order_id="$(psql_scalar "
  select attempt.provider_order_id
  from public.payment_attempts as attempt
  where attempt.id = '${callback_attempt_id}'::uuid
")"

cancel_holder_application="${test_prefix}-cancel-holder"
callback_contender_application="${test_prefix}-callback-contender"

docker exec -e PGAPPNAME="$cancel_holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$cancel_holder_log" 2>&1 <<SQL &
begin;
select result
from public.request_ticket_cancellation('${owner_one}', '${callback_order_id}');
select pg_catalog.pg_sleep(2);
commit;
SQL
cancel_holder_pid=$!

for _ in $(seq 1 200); do
  if grep -q '^requested$' "$cancel_holder_log"; then break; fi
  if ! kill -0 "$cancel_holder_pid" 2>/dev/null; then
    echo "cancellation holder exited before fencing provider callback" >&2
    sed -n '1,160p' "$cancel_holder_log" >&2
    exit 1
  fi
  sleep 0.05
done

docker exec -e PGAPPNAME="$callback_contender_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$callback_contender_log" 2>&1 <<SQL &
begin;
select public.claim_ticket_payment_attempt(
  'korpay',
  '${callback_provider_order_id}',
  repeat('a', 64),
  '40000000-0000-4000-8000-000000002074'
);
select public.finalize_ticket_payment_attempt(
  '${callback_attempt_id}',
  '40000000-0000-4000-8000-000000002074',
  'approved',
  null,
  'ticket-callback-race-2074',
  'ticket-callback-race-reference-2074',
  '0000',
  'CARD',
  '2074-****-****-0000',
  now()
);
commit;
SQL
callback_contender_pid=$!

wait_for_lock \
  "$callback_contender_application" \
  "$callback_contender_pid" \
  "$callback_contender_log"
wait "$cancel_holder_pid"
wait "$callback_contender_pid"

callback_race_state="$(psql_scalar "
  select case when
    ticket_order.status = 'pending'
    and attempt.state = 'approved'
    and payment.status = 'paid'
    and request.status = 'needs_review'
    and request.last_error_code = 'approved_requires_refund'
    and ticket_type.sold = 1
    and not exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_order_id = ticket_order.id
    )
  then 'ok' else 'invalid' end
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt
    on attempt.purpose = 'ticket' and attempt.ref_id = ticket_order.id
  join public.payments as payment on payment.id = attempt.payment_id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = '${callback_order_id}'::uuid
")"

if [[ "$callback_race_state" != "ok" ]]; then
  echo "cancellation/callback race did not preserve paid truth without fulfillment" >&2
  sed -n '1,160p' "$cancel_holder_log" >&2
  sed -n '1,160p' "$callback_contender_log" >&2
  exit 1
fi

echo "PASS=cancellation-serializes-known-callback-without-qr"

# Expiry uses SKIP LOCKED while cancellation owns the order. It must neither
# release early nor lose the request; the next expiry pass transitions this
# exact expired prepared attempt and completes the request exactly once.
#
# pg_cron runs this same global sweep every minute (expire-stale-checkouts).
# A scheduled pass that lands after the order turns stale can take the order
# first, and the test's own pass then counts 0. The sweeper session therefore
# holds public.orders, the first table every pass locks, in EXCLUSIVE mode from
# before the order turns stale until its own post-commit pass, so scheduled
# passes park on that fence. Advisory gates, not sleeps, order both test passes
# around the cancellation commit.
expiry_order_id="$(psql_scalar "
  select public.reserve_tickets(
    '${owner_one}',
    '${expiry_ticket_type}',
    1,
    '20000000-0000-4000-8000-000000002075'
  )
")"
psql_exec -q <<SQL >/dev/null
select public.prepare_ticket_payment_attempt(
  '${owner_one}', '${expiry_order_id}', 'korpay'
);
SQL

dump_expiry_race_diagnostics() {
  echo "--- expiry cancellation holder" >&2
  sed -n '1,160p' "$expiry_cancel_holder_log" >&2
  echo "--- expiry sweeper" >&2
  sed -n '1,160p' "$expiry_sweeper_log" >&2
  echo "--- expiry order and scheduled sweeps" >&2
  psql_exec -A -t <<SQL >&2 || true
select 'order=' || ticket_order.status
  || ' attempt=' || attempt.state
  || ' request=' || coalesce(request.status::text, 'none')
  || ' completed_at=' || coalesce(request.completed_at::text, 'none')
  || ' sold=' || ticket_type.sold
from public.ticket_orders as ticket_order
join public.payment_attempts as attempt
  on attempt.purpose = 'ticket' and attempt.ref_id = ticket_order.id
join public.ticket_order_reservations as reservation
  on reservation.ticket_order_id = ticket_order.id
join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
left join public.ticket_cancellation_requests as request
  on request.ticket_order_id = ticket_order.id
where ticket_order.id = '${expiry_order_id}'::uuid;
select 'cron expire-stale-checkouts ' || run.status
  || ' ' || run.start_time || ' .. ' || coalesce(run.end_time::text, 'running')
from cron.job_run_details as run
join cron.job as job on job.jobid = run.jobid
where job.jobname = 'expire-stale-checkouts'
order by run.start_time desc
limit 3;
SQL
}

expiry_gate_application="${test_prefix}-expiry-gate"
expiry_sweeper_application="${test_prefix}-expiry-sweeper"
expiry_cancel_holder_application="${test_prefix}-expiry-cancel-holder"
expiry_sweep_gate_key=9207501
expiry_commit_gate_key=9207502

# Parks the sweeper behind its fence until the order is stale and owned by
# cancellation.
docker exec -e PGAPPNAME="$expiry_gate_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$expiry_gate_log" 2>&1 <<SQL &
select pg_catalog.pg_advisory_lock(${expiry_sweep_gate_key});
select pg_catalog.pg_sleep(60);
SQL
expiry_gate_pid=$!
wait_for_backend_wait "$expiry_gate_application" "Timeout" "$expiry_gate_pid" "$expiry_gate_log"

# The session-level commit gate keeps cancellation uncommitted until the locked
# pass has run; the row lock then returns only after cancellation commits.
docker exec -e PGAPPNAME="$expiry_sweeper_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_sweeper_log" 2>&1 <<SQL &
select pg_catalog.pg_advisory_lock(${expiry_commit_gate_key});
begin;
lock table public.orders in exclusive mode;
select pg_catalog.pg_advisory_xact_lock(${expiry_sweep_gate_key});
select 'locked_sweep=' || public.expire_stale_checkouts();
select 'locked_state=' || case when
    ticket_order.status = 'pending'
    and attempt.state = 'prepared'
    and ticket_type.sold = 1
  then 'ok' else 'invalid' end
from public.ticket_orders as ticket_order
join public.payment_attempts as attempt
  on attempt.purpose = 'ticket' and attempt.ref_id = ticket_order.id
join public.ticket_order_reservations as reservation
  on reservation.ticket_order_id = ticket_order.id
join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
where ticket_order.id = '${expiry_order_id}'::uuid;
select pg_catalog.pg_advisory_unlock(${expiry_commit_gate_key});
select 'released_order=' || ticket_order.id
from public.ticket_orders as ticket_order
where ticket_order.id = '${expiry_order_id}'::uuid
for update;
select 'committed_sweep=' || public.expire_stale_checkouts();
commit;
SQL
expiry_sweeper_pid=$!
# Waiting on the sweep gate means the orders fence is already held.
wait_for_backend_wait \
  "$expiry_sweeper_application" \
  "Lock:advisory" \
  "$expiry_sweeper_pid" \
  "$expiry_sweeper_log"

psql_exec -q <<SQL >/dev/null
update public.ticket_orders
set expires_at = now() - interval '10 minutes'
where id = '${expiry_order_id}'::uuid;
update public.payment_attempts
set expires_at = now() - interval '1 minute'
where purpose = 'ticket' and ref_id = '${expiry_order_id}'::uuid;
SQL

docker exec -e PGAPPNAME="$expiry_cancel_holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$expiry_cancel_holder_log" 2>&1 <<SQL &
begin;
select result
from public.request_ticket_cancellation('${owner_one}', '${expiry_order_id}');
select pg_catalog.pg_advisory_xact_lock(${expiry_commit_gate_key});
commit;
SQL
expiry_cancel_holder_pid=$!

for _ in $(seq 1 200); do
  if grep -q '^requested$' "$expiry_cancel_holder_log"; then break; fi
  if ! kill -0 "$expiry_cancel_holder_pid" 2>/dev/null; then break; fi
  sleep 0.05
done
if ! grep -q '^requested$' "$expiry_cancel_holder_log"; then
  echo "expiry cancellation holder did not acquire the order as requested" >&2
  dump_expiry_race_diagnostics
  exit 1
fi

release_gate "$expiry_gate_application" "$expiry_gate_pid"

if ! wait "$expiry_sweeper_pid"; then
  echo "expiry sweeper session failed" >&2
  dump_expiry_race_diagnostics
  exit 1
fi
if ! wait "$expiry_cancel_holder_pid"; then
  echo "expiry cancellation holder failed to commit" >&2
  dump_expiry_race_diagnostics
  exit 1
fi

locked_sweep="$(sed -n 's/^locked_sweep=//p' "$expiry_sweeper_log")"
locked_state="$(sed -n 's/^locked_state=//p' "$expiry_sweeper_log")"
committed_sweep="$(sed -n 's/^committed_sweep=//p' "$expiry_sweeper_log")"

if [[ "$locked_sweep" != "0" ]]; then
  echo "expiry released a ticket reservation locked by cancellation (returned ${locked_sweep:-nothing})" >&2
  dump_expiry_race_diagnostics
  exit 1
fi
if [[ "$locked_state" != "ok" ]]; then
  echo "locked expiry race mutated prepared ticket state" >&2
  dump_expiry_race_diagnostics
  exit 1
fi
if [[ "$committed_sweep" != "1" ]]; then
  echo "expiry did not transition the committed prepared cancellation (returned ${committed_sweep:-nothing})" >&2
  dump_expiry_race_diagnostics
  exit 1
fi

expiry_race_state="$(psql_scalar "
  select case when
    ticket_order.status = 'canceled'
    and attempt.state = 'canceled'
    and request.status = 'completed'
    and ticket_type.sold = 0
    and not exists (
      select 1
      from public.tickets as ticket
      where ticket.ticket_order_id = ticket_order.id
    )
  then 'ok' else 'invalid' end
  from public.ticket_orders as ticket_order
  join public.payment_attempts as attempt
    on attempt.purpose = 'ticket' and attempt.ref_id = ticket_order.id
  join public.ticket_cancellation_requests as request
    on request.ticket_order_id = ticket_order.id
  join public.ticket_order_reservations as reservation
    on reservation.ticket_order_id = ticket_order.id
  join public.ticket_types as ticket_type on ticket_type.id = reservation.ticket_type_id
  where ticket_order.id = '${expiry_order_id}'::uuid
")"

if [[ "$expiry_race_state" != "ok" ]]; then
  echo "cancellation/expiry race did not restore capacity exactly once" >&2
  dump_expiry_race_diagnostics
  exit 1
fi
if [[ "$(psql_scalar 'select public.expire_stale_checkouts()')" != "0" ]]; then
  echo "ticket expiry race was not idempotent" >&2
  exit 1
fi

echo "PASS=cancellation-serializes-expired-prepared-release-once"

#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="ticket-capacity-race-$$"
owner_one="00000000-0000-4000-8000-000000002071"
owner_two="00000000-0000-4000-8000-000000002072"
ticket_type="10000000-0000-4000-8000-000000002071"
catalog_ticket_type="10000000-0000-4000-8000-000000002073"
staff_user="00000000-0000-4000-8000-000000002073"
holder_log="$(mktemp)"
contender_log="$(mktemp)"
catalog_holder_log="$(mktemp)"
catalog_contender_log="$(mktemp)"

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
delete from public.ticket_orders
where reservation_key in (
  '20000000-0000-4000-8000-000000002071'::uuid,
  '20000000-0000-4000-8000-000000002072'::uuid,
  '20000000-0000-4000-8000-000000002073'::uuid
);
delete from public.audit_log where id = '30000000-0000-4000-8000-000000002073'::uuid;
delete from public.ticket_types where id in ('${ticket_type}'::uuid, '${catalog_ticket_type}'::uuid);
delete from public.events where id in ('ticket-payment-capacity-race', 'ticket-payment-catalog-race');
delete from public.profiles where id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);
delete from auth.users where id in ('${owner_one}'::uuid, '${owner_two}'::uuid, '${staff_user}'::uuid);
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$holder_log" "$contender_log" "$catalog_holder_log" "$catalog_contender_log"
}
trap cleanup EXIT

wait_for_lock() {
  local application_name="$1"
  local client_pid="$2"
  local log_file="$3"
  local observed=""

  for _ in $(seq 1 200); do
    observed="$(psql_scalar "
      select coalesce(wait_event_type, '')
      from pg_catalog.pg_stat_activity
      where application_name = '${application_name}'
    ")"
    if [[ "$observed" == "Lock" ]]; then
      return 0
    fi
    if ! kill -0 "$client_pid" 2>/dev/null; then
      echo "backend exited before lock wait: ${application_name}" >&2
      sed -n '1,160p' "$log_file" >&2
      return 1
    fi
    sleep 0.05
  done

  echo "timed out waiting for lock: ${application_name} (last=${observed})" >&2
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

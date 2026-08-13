#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="ticket-capacity-race-$$"
owner_one="00000000-0000-4000-8000-000000002071"
owner_two="00000000-0000-4000-8000-000000002072"
ticket_type="10000000-0000-4000-8000-000000002071"
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
delete from public.ticket_orders
where reservation_key in (
  '20000000-0000-4000-8000-000000002071'::uuid,
  '20000000-0000-4000-8000-000000002072'::uuid
);
delete from public.ticket_types where id = '${ticket_type}'::uuid;
delete from public.events where id = 'ticket-payment-capacity-race';
delete from public.profiles where id in ('${owner_one}'::uuid, '${owner_two}'::uuid);
delete from auth.users where id in ('${owner_one}'::uuid, '${owner_two}'::uuid);
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$holder_log" "$contender_log"
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
  ('${owner_two}', 'authenticated', 'authenticated', 'ticket-race-two@example.test', now(), '{}', '{}', now(), now());

update public.profiles
set email = case id
      when '${owner_one}'::uuid then 'ticket-race-one@example.test'
      else 'ticket-race-two@example.test'
    end,
    nickname = case id
      when '${owner_one}'::uuid then 'ticket_race_one'
      else 'ticket_race_two'
    end,
    birth_date = '2000-01-01',
    consents = '{"terms":true,"privacy":true}',
    onboarded_at = now()
where id in ('${owner_one}'::uuid, '${owner_two}'::uuid);

insert into public.events (id, title, mode, status, starts_at)
values (
  'ticket-payment-capacity-race', '티켓 정원 경합', '오프라인', '예매중',
  now() + interval '30 days'
);

insert into public.ticket_types (
  id, event_id, name, price, capacity, sold, per_user_limit
)
values (
  '${ticket_type}', 'ticket-payment-capacity-race', '마지막 1석',
  10000, 1, 0, 1
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

#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="card-reward-gate-concurrency-$$"
user_id="00000000-0000-4000-8000-000000001921"
pool_id="20000000-0000-4000-8000-000000001921"
ticket_id="30000000-0000-4000-8000-000000001921"
source_id="40000000-0000-4000-8000-000000001921"
post_disable_ticket_id="30000000-0000-4000-8000-000000001922"
holder_log="$(mktemp)"
disabler_log="$(mktemp)"

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
update private.card_reward_control set enabled = false where singleton;
delete from public.draw_tickets
where id in ('${ticket_id}'::uuid, '${post_disable_ticket_id}'::uuid);
delete from public.card_pools where id = '${pool_id}'::uuid;
delete from public.ips where id = 'card-reward-gate-concurrency-ip';
delete from public.verticals where key = 'card-reward-gate-concurrency';
delete from public.profiles where id = '${user_id}'::uuid;
delete from auth.users where id = '${user_id}'::uuid;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -f "$holder_log" "$disabler_log"
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
  'card-reward-gate-concurrency@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'card-reward-gate-concurrency@example.test',
  nickname = 'card_reward_gate_concurrency',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now()
where id = '${user_id}'::uuid;

insert into public.verticals (key, label, color)
values ('card-reward-gate-concurrency', '카드 보상 게이트 동시성', '#000000');

insert into public.ips (id, title, vertical_key)
values (
  'card-reward-gate-concurrency-ip',
  '카드 보상 게이트 동시성 IP',
  'card-reward-gate-concurrency'
);

insert into public.card_pools (id, ip_id, name, active_from, active_to)
values (
  '${pool_id}', 'card-reward-gate-concurrency-ip',
  '카드 보상 게이트 동시성 풀',
  pg_catalog.now() - interval '1 day', pg_catalog.now() + interval '1 day'
);

update private.card_reward_control set enabled = true where singleton;
SQL

holder_application="${test_prefix}-holder"
disabler_application="${test_prefix}-disabler"

docker exec -e PGAPPNAME="$holder_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$holder_log" 2>&1 <<SQL &
begin;
insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal
)
values (
  '${ticket_id}', '${user_id}', '${pool_id}',
  'admin_grant', '${source_id}', 1
);
select pg_catalog.pg_sleep(60);
commit;
SQL
holder_client_pid=$!
wait_for_backend_wait "$holder_application" "Timeout" "$holder_client_pid" "$holder_log"

docker exec -e PGAPPNAME="$disabler_application" -i "$db_container" \
  psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$disabler_log" 2>&1 <<SQL &
update private.card_reward_control set enabled = false where singleton;
SQL
disabler_client_pid=$!

# Disabling must linearize behind an in-flight issuance transaction. Without
# the trigger's row lock this UPDATE completes immediately and the assertion
# below fails.
wait_for_backend_wait "$disabler_application" "Lock" "$disabler_client_pid" "$disabler_log"

psql_exec -q <<SQL >/dev/null
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name = '${holder_application}';
SQL
wait "$holder_client_pid" >/dev/null 2>&1 || true

if ! wait "$disabler_client_pid"; then
  echo "gate disable failed after the issuance transaction released its lock" >&2
  sed -n '1,160p' "$disabler_log" >&2
  exit 1
fi

psql_exec -q <<SQL >/dev/null
insert into public.draw_tickets (
  id, user_id, pool_id, source, source_id, ordinal
)
values (
  '${post_disable_ticket_id}', '${user_id}', '${pool_id}',
  'admin_grant', '${source_id}', 2
);
SQL

final_state="$(psql_scalar "
  select case when
    not (select enabled from private.card_reward_control where singleton)
    and not exists (
      select 1 from public.draw_tickets
      where id in ('${ticket_id}'::uuid, '${post_disable_ticket_id}'::uuid)
    )
  then 'ok' else 'invalid' end
")"

if [[ "$final_state" != "ok" ]]; then
  echo "gate disable did not serialize and fail closed" >&2
  exit 1
fi

echo "PASS=issuance-vs-disable"

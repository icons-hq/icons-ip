#!/usr/bin/env bash
set -euo pipefail

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="home-curation-concurrency-$$"
actor_id="00000000-0000-4000-8000-000000011451"
create_ip_id="curation-concurrency-create-ip"
update_ip_id="curation-concurrency-update-ip"
direct_ip_id="curation-concurrency-direct-ip"
create_curation_id="00000000-0000-4000-8000-000000011461"
update_curation_id="00000000-0000-4000-8000-000000011462"
direct_curation_id="00000000-0000-4000-8000-000000011465"
create_operation_id="00000000-0000-4000-8000-000000011463"
update_operation_id="00000000-0000-4000-8000-000000011464"
direct_operation_id="00000000-0000-4000-8000-000000011466"
work_dir="$(mktemp -d)"

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
delete from public.audit_log
where actor_id = '${actor_id}'::uuid
   or id in ('${create_operation_id}'::uuid, '${update_operation_id}'::uuid)
   or target in ('ips:${create_ip_id}', 'ips:${update_ip_id}');
delete from public.home_curations
where id in (
  '${create_curation_id}'::uuid,
  '${update_curation_id}'::uuid,
  '${direct_curation_id}'::uuid
);
delete from public.ips
where id in ('${create_ip_id}', '${update_ip_id}', '${direct_ip_id}');
delete from public.verticals where key = 'home-curation-concurrency-test';
delete from public.profiles where id = '${actor_id}'::uuid;
delete from auth.users where id = '${actor_id}'::uuid;
SQL
}

cleanup() {
  set +e
  terminate_test_backends
  cleanup_fixtures
  rm -rf "$work_dir"
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

assert_final_state() {
  local ip_id="$1"
  local curation_id="$2"
  local expected_title="$3"

  local state
  state="$(psql_scalar "
    select case when
      (select archived_at is null from public.ips where id = '${ip_id}')
      and exists (
        select 1
        from public.home_curations
        where id = '${curation_id}'::uuid
          and ip_id = '${ip_id}'
          and title = '${expected_title}'
          and enabled
          and (active_to is null or active_to > pg_catalog.now())
      )
    then 'ok' else 'invalid' end
  ")"

  if [[ "$state" != "ok" ]]; then
    echo "serialized final state is invalid for ${ip_id}" >&2
    return 1
  fi
}

run_case() {
  local case_name="$1"
  local gate_key="$2"
  local ip_id="$3"
  local curation_id="$4"
  local operation_id="$5"
  local title="$6"
  local archive_mode="${7:-rpc}"

  local gate_application="${test_prefix}-${case_name}-gate"
  local upsert_application="${test_prefix}-${case_name}-upsert"
  local archive_application="${test_prefix}-${case_name}-archive"
  local gate_log="${work_dir}/${case_name}-gate.log"
  local upsert_log="${work_dir}/${case_name}-upsert.log"
  local archive_log="${work_dir}/${case_name}-archive.log"

  docker exec -e PGAPPNAME="$gate_application" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$gate_log" 2>&1 <<SQL &
select pg_catalog.pg_advisory_lock(${gate_key});
select pg_catalog.pg_sleep(60);
SQL
  local gate_client_pid=$!
  wait_for_backend_wait "$gate_application" "Timeout" "$gate_client_pid" "$gate_log"

  docker exec -e PGAPPNAME="$upsert_application" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$upsert_log" 2>&1 <<SQL &
begin;
set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '${actor_id}', true);
select public.admin_upsert_home_curation(
  '${operation_id}'::uuid,
  '${curation_id}'::uuid,
  'featured_ip',
  '${ip_id}',
  '${title}',
  null,
  '/ip/${ip_id}',
  0,
  pg_catalog.now(),
  null,
  true
);
select pg_catalog.pg_advisory_xact_lock(${gate_key});
commit;
SQL
  local upsert_client_pid=$!
  wait_for_backend_wait "$upsert_application" "Lock" "$upsert_client_pid" "$upsert_log"

  local archive_statement="select public.admin_archive_ip('${ip_id}');"
  local archive_role_setup="set local role authenticated;
select set_config('request.jwt.claim.role', 'authenticated', true);
select set_config('request.jwt.claim.sub', '${actor_id}', true);"
  if [[ "$archive_mode" == "direct" ]]; then
    # authenticated has no direct table UPDATE grant. service_role exercises the
    # trigger-level invariant that protects every privileged/internal writer.
    archive_statement="update public.ips set archived_at = pg_catalog.clock_timestamp() where id = '${ip_id}';"
    archive_role_setup="set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
select set_config('request.jwt.claim.sub', '${actor_id}', true);"
  fi

  docker exec -e PGAPPNAME="$archive_application" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 >"$archive_log" 2>&1 <<SQL &
begin;
${archive_role_setup}
${archive_statement}
commit;
SQL
  local archive_client_pid=$!

  # This is the regression assertion: without the shared IP-row lock the
  # archive finishes instead of waiting for the uncommitted curation upsert.
  wait_for_backend_wait "$archive_application" "Lock" "$archive_client_pid" "$archive_log"

  release_gate "$gate_application" "$gate_client_pid"

  if ! wait "$upsert_client_pid"; then
    echo "${case_name} curation upsert failed" >&2
    sed -n '1,200p' "$upsert_log" >&2
    return 1
  fi

  if wait "$archive_client_pid"; then
    echo "${case_name} archive unexpectedly succeeded" >&2
    sed -n '1,200p' "$archive_log" >&2
    return 1
  fi

  if ! grep -q "ip_has_active_home_curation" "$archive_log"; then
    echo "${case_name} archive failed for the wrong reason" >&2
    sed -n '1,200p' "$archive_log" >&2
    return 1
  fi

  assert_final_state "$ip_id" "$curation_id" "$title"
  echo "PASS=${case_name}-vs-archive"
}

terminate_test_backends
cleanup_fixtures

psql_exec -q <<SQL >/dev/null
insert into auth.users (
  id, aud, role, email, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values (
  '${actor_id}', 'authenticated', 'authenticated',
  'curation-concurrency-staff@example.test', pg_catalog.now(),
  '{}', '{}', pg_catalog.now(), pg_catalog.now()
);

update public.profiles
set
  email = 'curation-concurrency-staff@example.test',
  nickname = 'curation_concurrency_staff',
  birth_date = '2000-01-01',
  consents = '{"terms":true,"privacy":true}',
  onboarded_at = pg_catalog.now(),
  role = 'staff',
  suspended_at = null,
  suspension_reason = null
where id = '${actor_id}'::uuid;

insert into public.verticals (key, label, color)
values ('home-curation-concurrency-test', '홈 큐레이션 동시성 테스트', '#8B5CFF');

insert into public.ips (id, title, vertical_key)
values
  ('${create_ip_id}', '생성 경합 IP', 'home-curation-concurrency-test'),
  ('${update_ip_id}', '수정 경합 IP', 'home-curation-concurrency-test'),
  ('${direct_ip_id}', '직접 보관 경합 IP', 'home-curation-concurrency-test');

insert into public.home_curations (
  id, kind, ip_id, title, link_path, display_order,
  active_from, active_to, enabled
)
values (
  '${update_curation_id}', 'featured_ip', '${update_ip_id}',
  '수정 전 비활성 큐레이션', '/ip/${update_ip_id}', 0,
  pg_catalog.now() - interval '1 day', null, false
);
SQL

run_case \
  "create" 9114001 "$create_ip_id" "$create_curation_id" \
  "$create_operation_id" "생성 경합 큐레이션"

run_case \
  "update" 9114002 "$update_ip_id" "$update_curation_id" \
  "$update_operation_id" "수정 경합 큐레이션"

run_case \
  "direct-update" 9114003 "$direct_ip_id" "$direct_curation_id" \
  "$direct_operation_id" "직접 보관 경합 큐레이션" "direct"

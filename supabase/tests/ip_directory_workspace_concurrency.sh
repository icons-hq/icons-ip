#!/usr/bin/env bash
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
work_dir="$(mktemp -d)"
app_prefix="ip-directory-race-$$"
actor="00000000-0000-4000-8000-000000041231"
psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "$container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}
cleanup() {
  local test_status=$?
  local cleanup_status=0
  set +e
  psql_exec -q <<SQL > "$work_dir/cleanup.log" 2>&1
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${app_prefix}-%' and pid<>pg_backend_pid();
begin;
delete from public.audit_log where actor_id='${actor}' and action='catalog.ip.directory_updated' and target like 'ips:ip-dir-race-%';
delete from public.ips where id like 'ip-dir-race-%';
delete from public.verticals where key='ip-dir-race';
delete from auth.users where id='${actor}';
commit;
SQL
  if [[ $? -ne 0 ]]; then cleanup_status=1; fi
  if [[ -s "$work_dir/restore.sql" && "$cleanup_status" -eq 0 ]]; then
    { echo 'begin;'; cat "$work_dir/restore.sql"; echo 'commit;'; } | psql_exec -q >> "$work_dir/cleanup.log" 2>&1
    if [[ $? -ne 0 ]]; then cleanup_status=1; fi
  fi
  if [[ "$cleanup_status" -ne 0 ]]; then
    cat "$work_dir/cleanup.log" >&2
    echo "IP directory test cleanup failed; restore evidence retained at $work_dir" >&2
    exit 1
  fi
  rm -rf "$work_dir"
  exit "$test_status"
}
trap cleanup EXIT
psql_exec -qAt -c "select format('update public.ips set featured=%L,sort_order=%s where id=%L;',featured,sort_order,id) from public.ips order by sort_order" > "$work_dir/restore.sql"
psql_exec -q <<SQL >/dev/null
begin;
update public.ips set featured=false;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('${actor}','authenticated','authenticated','ip-dir-race@example.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='${actor}';
insert into public.verticals(key,label,color) values ('ip-dir-race','동시 노출 검증','#000000');
insert into public.ips(id,title,vertical_key,featured)
select 'ip-dir-race-'||n,'동시 노출 '||n,'ip-dir-race',n<=4 from generate_series(1,6)n;
commit;
SQL
wait_state() {
  local app="$1" state="$2" pid="$3" log="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$state" ]]; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.025
  done
  cat "$log" >&2; echo "expected ${state}, got ${observed}" >&2; return 1
}
psql_exec -q > "$work_dir/first.log" 2>&1 <<SQL &
set application_name='${app_prefix}-first';
begin;
set local lock_timeout='5s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select public.admin_set_ip_directory('ip-dir-race-5',true,
 (select count(*)::integer-1 from public.ips),array(select id from public.ips order by sort_order,id),false);
select pg_sleep(1.5);
commit;
SQL
first_pid=$!
wait_state "${app_prefix}-first" Timeout "$first_pid" "$work_dir/first.log"
psql_exec -q > "$work_dir/second.log" 2>&1 <<SQL &
set application_name='${app_prefix}-second';
begin;
set local lock_timeout='5s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${actor}',true);
select public.admin_set_ip_directory('ip-dir-race-6',true,
 (select count(*)::integer from public.ips),array(select id from public.ips order by sort_order,id),false);
commit;
SQL
second_pid=$!
wait_state "${app_prefix}-second" Lock "$second_pid" "$work_dir/second.log"
wait "$first_pid" || { cat "$work_dir/first.log" >&2; exit 1; }
if wait "$second_pid"; then echo 'six featured IPs were accepted' >&2; exit 1; fi
if ! grep -q 'ip_featured_limit' "$work_dir/second.log"; then cat "$work_dir/second.log" >&2; exit 1; fi
psql_exec -q -c "select 1 / case when (select count(*) from public.ips where featured)=5 then 1 else 0 end" >/dev/null
echo 'PASS competing featured writes serialize: only one fifth IP is accepted'

#!/usr/bin/env bash
set -euo pipefail
container="${SUPABASE_DB_CONTAINER:-}"
project="${container#supabase_db_}"
if [[ "${OPERATOR_CAPABILITY_TEST_SCOPE:-}" != 1 ]] || [[ "$container" != "supabase_db_$project" ]] || \
  ! { [[ "$project" =~ ^icons-ip-smartstore-fresh-[0-9]{8}$ ]] || [[ "$project" =~ ^icons-admin-release-[a-f0-9]{8}$ ]] || [[ "$project" == icons-ip && "${CI:-}" == true && "${GITHUB_ACTIONS:-}" == true ]]; }; then
  echo 'Refusing operator concurrency fixtures outside explicit local FRESH/GitHub Actions scope' >&2; exit 1
fi
[[ "$(docker inspect --format '{{ index .Config.Labels "com.supabase.cli.project" }}' "$container")" == "$project" ]] || exit 1
work="$(mktemp -d)"
installed=0
sql() { docker exec -i "$container" psql -X -q -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$installed" == 1 ]]; then
    { echo 'begin;'; cat "$work/restore.sql"; cat <<'SQL'
delete from public.audit_log where actor_id::text like 'bfc01500-0000-4000-8000-%';
delete from private.operator_memberships where profile_id::text like 'bfc01500-0000-4000-8000-%';
delete from auth.users where id::text like 'bfc01500-0000-4000-8000-%';
commit;
SQL
    } | sql > "$work/cleanup.log" 2>&1 || { cat "$work/cleanup.log" >&2; exit 1; }
  fi
  if [[ "$status" != 0 ]]; then cat "$work"/*.log >&2; fi
  rm -rf "$work"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
sql -Atc "select format('update private.operator_access_state set (configured,revision,updated_at,updated_by)=(%L,%L,%L,%L) where id;',configured,revision,updated_at,updated_by) from private.operator_access_state where id" > "$work/restore.sql"
sql > "$work/setup.log" <<'SQL'
begin;
select 1 from private.operator_access_state where id for update;
do $$ begin
 if (select configured from private.operator_access_state where id)
  or exists(select 1 from private.operator_memberships)
  or to_regclass('private.operator_legacy_fixture_control') is not null
  or exists(select 1 from auth.users where id::text like 'bfc01500-0000-4000-8000-%') then
  raise exception 'Operator concurrency tests require an empty, unconfigured isolated fixture state';end if;
end $$;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('bfc01500-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','operator-concurrency-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1,3)n;
update public.profiles set role='staff',nickname='operator_concurrency_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now() where id::text like 'bfc01500-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role)
select ('bfc01500-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,case when n=1 then 'owner' else 'primary' end from generate_series(1,3)n;
update private.operator_access_state set configured=true,revision=701 where id;
commit;
SQL
installed=1
wait_for() {
  local predicate="$1"
  for attempt in $(seq 1 100); do
    if [[ "$(sql -Atc "$predicate")" == t ]]; then return 0; fi
    sleep 0.05
  done
  echo "Expected lock state not observed: $predicate" >&2; return 1
}
# A started mutation holds the actor fence; revocation waits and then takes effect.
sql > "$work/write-first.log" 2>&1 <<'SQL' &
set application_name='operator-concurrency-write-first';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01500-0000-4000-8000-000000000002',true);
select public.admin_set_operation_alert_badge(false);
select pg_sleep(3);
commit;
SQL
write_pid=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='operator-concurrency-write-first' and wait_event='PgSleep')"
sql > "$work/revoke-second.log" 2>&1 <<'SQL' &
set application_name='operator-concurrency-revoke-second';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01500-0000-4000-8000-000000000001',true);
select public.admin_change_operator_role('bfc01500-0000-4000-8000-000000000002',null,1,701,'bfc01510-0000-4000-8000-000000000001');
commit;
SQL
revoke_pid=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='operator-concurrency-revoke-second' and cardinality(pg_blocking_pids(pid))>0)"
wait "$write_pid"
wait "$revoke_pid"
sql > "$work/stale-session.log" 2>&1 <<'SQL'
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01500-0000-4000-8000-000000000002',true);
do $$ begin
 begin perform public.admin_set_operation_alert_badge(true);raise exception 'stale session mutation succeeded';exception when insufficient_privilege then null;end;
end $$;
rollback;
SQL
# If revocation wins, an already-open session waits, rereads authority and rejects.
sql > "$work/revoke-first.log" 2>&1 <<'SQL' &
set application_name='operator-concurrency-revoke-first';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01500-0000-4000-8000-000000000001',true);
select public.admin_change_operator_role('bfc01500-0000-4000-8000-000000000003',null,1,702,'bfc01510-0000-4000-8000-000000000002');
select pg_sleep(3);
commit;
SQL
revoke_pid=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='operator-concurrency-revoke-first' and wait_event='PgSleep')"
sql > "$work/write-second.log" 2>&1 <<'SQL' &
set application_name='operator-concurrency-write-second';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','bfc01500-0000-4000-8000-000000000003',true);
do $$ begin
 begin perform public.admin_set_operation_alert_badge(false);raise exception 'revoked in-flight mutation succeeded';exception when insufficient_privilege then null;end;
end $$;
commit;
SQL
write_pid=$!
wait_for "select exists(select 1 from pg_stat_activity where application_name='operator-concurrency-write-second' and cardinality(pg_blocking_pids(pid))>0)"
wait "$revoke_pid"
wait "$write_pid"
sql > "$work/readback.log" <<'SQL'
do $$ begin
 if (select badge_enabled from private.admin_operation_alert_preferences where actor_id='bfc01500-0000-4000-8000-000000000002') is distinct from false
  or exists(select 1 from private.admin_operation_alert_preferences where actor_id='bfc01500-0000-4000-8000-000000000003')
  or exists(select 1 from private.operator_memberships where profile_id in ('bfc01500-0000-4000-8000-000000000002','bfc01500-0000-4000-8000-000000000003')) then
  raise exception 'Permission-revocation readback mismatch';end if;
end $$;
SQL
echo 'Operator concurrency passed: write-before-revoke, revoke-before-write and stale session.'

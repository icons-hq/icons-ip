#!/usr/bin/env bash
set -euo pipefail
jobs_run="shipment-email-race-$$"
jobs_logs="$(mktemp -d)"
jobs_user='00000000-0000-4000-8000-000000447091'
psql_exec() {
  if [[ -n "${PSQL_BIN:-}" ]]; then
    "$PSQL_BIN" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"
  else
    docker exec -i "${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
  fi
}
cleanup() {
  local result=$?
  trap - EXIT
  if ! psql_exec -q >"${jobs_logs}/cleanup.log" 2>&1 <<SQL
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${jobs_run}-%' and pid<>pg_backend_pid();
begin;
delete from public.audit_log where actor_id='${jobs_user}';
delete from public.orders where user_id='${jobs_user}';
delete from auth.users where id='${jobs_user}';
commit;
select 1 / case when not exists(select 1 from public.orders where user_id='${jobs_user}')
 and not exists(select 1 from auth.users where id='${jobs_user}')
 and not exists(select 1 from public.order_shipment_email_jobs where shipment_id in
 ('00000000-0000-4000-8000-000000447094','00000000-0000-4000-8000-000000447095')) then 1 else 0 end;
SQL
  then cat "${jobs_logs}/cleanup.log" >&2; result=1; fi
  if [[ "$result" == 0 ]]; then rm -r "$jobs_logs"; else echo "Logs: ${jobs_logs}" >&2; fi
  exit "$result"
}
trap cleanup EXIT
psql_exec -q >/dev/null <<SQL
begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('${jobs_user}','authenticated','authenticated','shipment-email-race@example.test','{}','{}',now(),now());
insert into public.orders(id,user_id,status,total,address) values
 ('00000000-0000-4000-8000-000000447092','${jobs_user}','shipping',10000,'{}'),
 ('00000000-0000-4000-8000-000000447093','${jobs_user}','shipping',10000,'{}');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status) values
 ('00000000-0000-4000-8000-000000447094','00000000-0000-4000-8000-000000447092','00000000-0000-4000-8000-000000042201','김포',0,'{}','shipping'),
 ('00000000-0000-4000-8000-000000447095','00000000-0000-4000-8000-000000447093','00000000-0000-4000-8000-000000042201','김포',0,'{}','shipping');
insert into public.order_shipment_email_jobs(order_id,shipment_id,available_at)
select order_id,id,now()-interval '1 year' from public.order_shipments
where id in ('00000000-0000-4000-8000-000000447094','00000000-0000-4000-8000-000000447095');
commit;
SQL
psql_exec -q >"${jobs_logs}/first.log" 2>&1 <<SQL &
set application_name='${jobs_run}-first';
begin;
set local role service_role;
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(1))=1 then 1 else 0 end;
select pg_sleep(3);
commit;
SQL
first_pid=$!
observed=''
for _ in $(seq 1 100); do
  observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${jobs_run}-first'")"
  if [[ "$observed" == 'Timeout' ]]; then break; fi
  if ! kill -0 "$first_pid" 2>/dev/null; then cat "${jobs_logs}/first.log" >&2; exit 1; fi
  sleep 0.025
done
[[ "$observed" == 'Timeout' ]] || { echo 'First claim did not hold its transaction' >&2; exit 1; }
psql_exec -q >"${jobs_logs}/second.log" 2>&1 <<SQL
set application_name='${jobs_run}-second';
begin;
set local statement_timeout='1500ms';
set local role service_role;
select 1 / case when (select count(*) from public.claim_shipment_email_jobs(1))=1 then 1 else 0 end;
commit;
SQL
psql_exec -qAt -c "select 1 / case when exists(select 1 from pg_stat_activity where application_name='${jobs_run}-first' and wait_event_type='Timeout') then 1 else 0 end" >/dev/null
wait "$first_pid" || { cat "${jobs_logs}/first.log" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
select 1 / case when count(*)=2 and count(distinct claim_token)=2 and bool_and(status='processing' and attempts=1) then 1 else 0 end
 from public.order_shipment_email_jobs where shipment_id in
 ('00000000-0000-4000-8000-000000447094','00000000-0000-4000-8000-000000447095');
SQL
echo 'PASS concurrent workers skip locked jobs, claim distinct leases, and clean up all fixtures'

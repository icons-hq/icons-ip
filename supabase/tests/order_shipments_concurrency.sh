#!/usr/bin/env bash
set -euo pipefail
shipment_run="shipment-race-$$"
shipment_logs="$(mktemp -d)"
shipment_user='00000000-0000-4000-8000-000000044690'
shipment_order='00000000-0000-4000-8000-000000044691'
shipment_first='00000000-0000-4000-8000-000000044692'
shipment_second='00000000-0000-4000-8000-000000044693'
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
  if ! psql_exec -q <<SQL >"${shipment_logs}/cleanup.log" 2>&1
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${shipment_run}-%' and pid<>pg_backend_pid();
delete from public.audit_log where actor_id='${shipment_user}';
delete from public.orders where id='${shipment_order}';
delete from auth.users where id='${shipment_user}';
SQL
  then cat "${shipment_logs}/cleanup.log" >&2;result=1;fi
  if [[ "$result" == 0 ]]; then rm -r "$shipment_logs";else echo "Logs: ${shipment_logs}" >&2;fi
  exit "$result"
}
trap cleanup EXIT
wait_event() {
  local name="$1" expected="$2" pid="$3"
  for _ in $(seq 1 150); do
    if [[ "$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${name}'")" == "$expected" ]]; then return;fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "${shipment_logs}"/*.log >&2;return 1;fi
    sleep 0.025
  done
  echo "Did not observe ${expected}: ${name}" >&2;return 1
}
psql_exec -q <<SQL >/dev/null
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('${shipment_user}','authenticated','authenticated','shipment-concurrency@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='${shipment_user}';
insert into public.orders(id,user_id,status,total,shipping_fee,address) values('${shipment_order}','${shipment_user}','confirmed',30000,7000,'{}');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
('${shipment_first}','${shipment_order}','00000000-0000-4000-8000-000000042201','김포',3000,'{}'),
('${shipment_second}','${shipment_order}','00000000-0000-4000-8000-000000042202','남양주',4000,'{}');
SQL
for next_status in shipping delivered; do
  psql_exec -q <<SQL >"${shipment_logs}/${next_status}-first.log" 2>&1 &
set application_name='${shipment_run}-first';
begin;
set local lock_timeout='5s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${shipment_user}',true);
select public.admin_update_shipment_status('${shipment_first}','${next_status}','hanjin','100000001');
select pg_sleep(1.5);
commit;
SQL
  first_pid=$!
  wait_event "${shipment_run}-first" Timeout "$first_pid"
  psql_exec -q <<SQL >"${shipment_logs}/${next_status}-second.log" 2>&1 &
set application_name='${shipment_run}-second';
begin;
set local lock_timeout='5s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${shipment_user}',true);
select public.admin_update_shipment_status('${shipment_second}','${next_status}','hanjin','100000002');
commit;
SQL
  second_pid=$!
  wait_event "${shipment_run}-second" Lock "$second_pid"
  wait "$first_pid" || { cat "${shipment_logs}/${next_status}-first.log" >&2;exit 1; }
  wait "$second_pid" || { cat "${shipment_logs}/${next_status}-second.log" >&2;exit 1; }
  psql_exec -q <<SQL >/dev/null
select 1 / case when (select status::text='${next_status}' from public.orders where id='${shipment_order}')
 and (select count(*)=2 from public.order_shipments where order_id='${shipment_order}' and status='${next_status}')
 then 1 else 0 end as assert_both_warehouses_and_aggregate;
SQL
  echo "PASS two warehouse ${next_status} transitions serialize on order and retain both shipment states"
done
psql_exec -q <<SQL >/dev/null
select 1 / case when (select delivered_at from public.orders where id='${shipment_order}')=(select max(delivered_at) from public.order_shipments where order_id='${shipment_order}')
 and (select count(*) from public.audit_log where actor_id='${shipment_user}' and action='admin.shipment.status_updated')=4 then 1 else 0 end as assert_delivery_clock_and_audit;
SQL

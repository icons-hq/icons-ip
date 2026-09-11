#!/usr/bin/env bash
set -euo pipefail
# An explicit isolated DB is required. This script never chooses a default DB.
: "${ORDER_DELAY_TEST_SCOPE:?Set ORDER_DELAY_TEST_SCOPE=1 for an approved isolated test database}"
[[ "$ORDER_DELAY_TEST_SCOPE" == 1 ]] || exit 2
if [[ -n "${PSQL_BIN:-}" ]]; then
  : "${PGHOST:?}" "${PGPORT:?}" "${PGDATABASE:?}" "${PGUSER:?}"
else
  : "${SUPABASE_DB_CONTAINER:?Explicit test container required}" "${SUPABASE_DB_DATABASE:?Explicit test database required}"
fi
delay_run="order-delay-race-$$"
delay_logs="$(mktemp -d)"
delay_staff='00000000-0000-4000-8000-000000494201'
delay_buyer='00000000-0000-4000-8000-000000494202'
delay_batch='00000000-0000-4000-8000-000000494231'
psql_exec(){
 if [[ -n "${PSQL_BIN:-}" ]];then "$PSQL_BIN" -X -v ON_ERROR_STOP=1 "$@";
 else docker exec -i "$SUPABASE_DB_CONTAINER" psql -X -U postgres -d "$SUPABASE_DB_DATABASE" -v ON_ERROR_STOP=1 "$@";fi
}
delay_original_gate="$(psql_exec -qAt -c "select enabled from private.order_delay_notice_delivery_control where singleton")"
[[ "$delay_original_gate" == t || "$delay_original_gate" == f ]] || exit 2
cleanup(){
 local result=$?;trap - EXIT
 if ! psql_exec -q >"${delay_logs}/cleanup.log" 2>&1 <<SQL
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${delay_run}-%' and pid<>pg_backend_pid();
begin;
delete from public.audit_log where actor_id='${delay_staff}' or target='delay_notice:${delay_batch}'
 or target in(select 'delay_notice_target:'||id from private.order_delay_notice_targets where notice_id='${delay_batch}');
delete from public.notifications where source_type='order_delay_notice' and source_id in(select id::text from private.order_delay_notice_targets where notice_id='${delay_batch}');
delete from private.order_delay_notice_targets where notice_id='${delay_batch}';
delete from private.order_delay_notices where id='${delay_batch}';
delete from public.orders where user_id='${delay_buyer}';
delete from auth.users where id in('${delay_staff}','${delay_buyer}');
update private.order_delay_notice_delivery_control set enabled='${delay_original_gate}'::boolean where singleton;
commit;
SQL
 then cat "${delay_logs}/cleanup.log" >&2;result=1;fi
 if [[ "$result" == 0 ]];then rm -r "$delay_logs";else echo "Logs: ${delay_logs}" >&2;fi
 exit "$result"
}
trap cleanup EXIT
psql_exec -q >"${delay_logs}/setup.log" 2>&1 <<SQL
begin;
select 1/case when not exists(select 1 from private.order_delay_notice_targets where email_status in('queued','processing','unknown') and available_at is not null) then 1 else 0 end;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('${delay_staff}','authenticated','authenticated','delay-race-staff@example.test','{}','{}',now(),now()),
 ('${delay_buyer}','authenticated','authenticated','delay-race-buyer@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='${delay_staff}';
update private.order_delay_notice_delivery_control set enabled=true where singleton;
insert into public.orders(id,user_id,status,total,address,confirmed_at) values
 ('00000000-0000-4000-8000-000000494211','${delay_buyer}','confirmed',10000,'{}',now()-interval '5 days'),
 ('00000000-0000-4000-8000-000000494212','${delay_buyer}','confirmed',10000,'{}',now()-interval '5 days');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status) values
 ('00000000-0000-4000-8000-000000494221','00000000-0000-4000-8000-000000494211','00000000-0000-4000-8000-000000042201','김포',0,'{}','ready'),
 ('00000000-0000-4000-8000-000000494222','00000000-0000-4000-8000-000000494212','00000000-0000-4000-8000-000000042201','김포',0,'{}','ready');
commit;
SQL
wait_sleep(){
 local name="$1" process="$2" observed=''
 for _ in $(seq 1 100);do
  observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${name}'")"
  [[ "$observed" == Timeout ]] && return 0
  kill -0 "$process" 2>/dev/null || return 1
  sleep 0.025
 done
 return 1
}
psql_exec -q >"${delay_logs}/request-first.log" 2>&1 <<SQL &
set application_name='${delay_run}-request-first';
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub','${delay_staff}',true);
select public.admin_prepare_order_delay_notice('${delay_batch}',array['00000000-0000-4000-8000-000000494221','00000000-0000-4000-8000-000000494222']::uuid[],'고객 안내','동시 요청 합성 자료',null);
select public.admin_request_order_delay_notice('${delay_batch}');
select pg_sleep(3);
commit;
SQL
delay_first_pid=$!
wait_sleep "${delay_run}-request-first" "$delay_first_pid"
psql_exec -q >"${delay_logs}/request-second.log" 2>&1 <<SQL
set application_name='${delay_run}-request-second';
begin;
set local statement_timeout='8s';
set local role authenticated;
select set_config('request.jwt.claim.sub','${delay_staff}',true);
select public.admin_prepare_order_delay_notice('${delay_batch}',array['00000000-0000-4000-8000-000000494222','00000000-0000-4000-8000-000000494221']::uuid[],'고객 안내','동시 요청 합성 자료',null);
select public.admin_request_order_delay_notice('${delay_batch}');
commit;
SQL
wait "$delay_first_pid"
psql_exec -q >"${delay_logs}/request-check.log" 2>&1 <<SQL
select 1/case when (select count(*) from public.notifications where source_type='order_delay_notice' and user_id='${delay_buyer}')=2
 and (select count(*) from public.audit_log where action='admin.order.delay_notice_requested' and target='delay_notice:${delay_batch}')=1 then 1 else 0 end;
SQL
psql_exec -q >"${delay_logs}/worker-first.log" 2>&1 <<SQL &
set application_name='${delay_run}-worker-first';
begin;
set local role service_role;
select 1/case when jsonb_array_length(public.claim_order_delay_email_jobs(1))=1 then 1 else 0 end;
select pg_sleep(3);
commit;
SQL
delay_worker_pid=$!
wait_sleep "${delay_run}-worker-first" "$delay_worker_pid"
psql_exec -q >"${delay_logs}/worker-second.log" 2>&1 <<SQL
set application_name='${delay_run}-worker-second';
begin;
set local statement_timeout='1500ms';
set local role service_role;
select 1/case when jsonb_array_length(public.claim_order_delay_email_jobs(1))=1 then 1 else 0 end;
commit;
SQL
wait "$delay_worker_pid"
psql_exec -q >"${delay_logs}/worker-check.log" 2>&1 <<SQL
begin;
select 1/case when count(*)=2 and count(distinct claim_token)=2 and bool_and(email_status='processing' and attempts=1) then 1 else 0 end
 from private.order_delay_notice_targets where notice_id='${delay_batch}';
select id as target_id,claim_token as old_claim from private.order_delay_notice_targets where notice_id='${delay_batch}' order by id limit 1 \gset
update private.order_delay_notice_targets set lease_until=now()-interval '1 second' where id=:'target_id';
set local role service_role;
select value->>'claimToken' as new_claim from jsonb_array_elements(public.claim_order_delay_email_jobs(1)) where value->>'id'=:'target_id' \gset
select 1/case when :'old_claim'<>:'new_claim' and not public.finish_order_delay_email_job(:'target_id',:'old_claim','failed','provider_not_configured',true)
 and public.finish_order_delay_email_job(:'target_id',:'new_claim','failed','provider_not_configured',true) then 1 else 0 end;
commit;
SQL
echo 'PASS duplicate notice requests, concurrent worker leases, and stale-worker result rejection'

#!/usr/bin/env bash
set -euo pipefail
claim_run="claim-origin-race-$$"
claim_logs="$(mktemp -d)"
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
 if ! psql_exec -q <<'SQL' >"${claim_logs}/cleanup.log" 2>&1
begin;
delete from public.audit_log where target='order:00000000-0000-4000-8000-000000045310';
delete from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310';
delete from public.order_cancellation_claims where order_id='00000000-0000-4000-8000-000000045310';
delete from public.orders where id='00000000-0000-4000-8000-000000045310';
delete from public.goods where id='claim-origin-test';
delete from public.ips where id='claim-origin-test';
delete from public.fulfillment_origins where id in('00000000-0000-4000-8000-000000045341','00000000-0000-4000-8000-000000045342');
delete from auth.users where id in('00000000-0000-4000-8000-000000045301','00000000-0000-4000-8000-000000045302','00000000-0000-4000-8000-000000045303');
commit;
SQL
 then cat "${claim_logs}/cleanup.log" >&2; result=1; fi
 if [[ "$result" == 0 ]]; then rm -r "$claim_logs";else echo "Logs: ${claim_logs}" >&2;fi
 exit "$result"
}
trap cleanup EXIT
wait_event() {
 local name="$1" expected="$2" pid="$3"
 for _ in $(seq 1 180);do
  if [[ "$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${name}'")" == "$expected" ]];then return;fi
  if ! kill -0 "$pid" 2>/dev/null;then cat "${claim_logs}"/*.log >&2;return 1;fi
  sleep 0.025
 done
 echo "Did not observe ${expected}: ${name}" >&2;return 1
}
psql_exec -q <<'SQL' >"${claim_logs}/setup.log" 2>&1

-- Rollback-only synthetic catalog/order; no payment provider is called.
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('00000000-0000-4000-8000-000000045301','authenticated','authenticated','claim-origin-staff@example.test','{}','{}',now(),now()),
('00000000-0000-4000-8000-000000045302','authenticated','authenticated','claim-origin-owner@example.test','{}','{}',now(),now()),
('00000000-0000-4000-8000-000000045303','authenticated','authenticated','claim-origin-other@example.test','{}','{}',now(),now());
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000045301';
insert into public.ips(id,title,vertical_key) values('claim-origin-test','회수 계약 검증','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('claim-origin-test','claim-origin-test','회수 상품','문구',10000,'ok',20);
insert into public.orders(id,user_id,status,total,address) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','paid',30000,'{}');
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '00000000-0000-4000-8000-000000045311','00000000-0000-4000-8000-000000045310','claim-origin-test',id,2,10000,'회수 상품','문구','claim-origin-test'
from public.goods_variants where good_id='claim-origin-test' and is_default;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select '00000000-0000-4000-8000-000000045312','00000000-0000-4000-8000-000000045310','claim-origin-test',id,1,10000,'회수 상품','문구','claim-origin-test'
from public.goods_variants where good_id='claim-origin-test' and is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values
('00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000042201','김포',0,'{}'),
('00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000042202','남양주',0,'{}');
insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045311'),
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045312');
SQL
# Each scenario leaves one winner; the other transaction re-evaluates eligibility
# after waiting for the exact same order lock, without deadlocks or dual writes.
for first in confirm request;do
 if [[ "$first" == request ]];then
  psql_exec -q <<'SQL' >/dev/null
  delete from public.audit_log where target='order:00000000-0000-4000-8000-000000045310';
  -- Recreate the synthetic order to start a genuinely unconfirmed history.
  delete from public.orders where id='00000000-0000-4000-8000-000000045310';
  insert into public.orders(id,user_id,status,total,address) values('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','paid',30000,'{}');
  insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
  values('00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000042201','김포',0,'{}');
SQL
 fi
 confirm="set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true); select public.admin_update_order_status('00000000-0000-4000-8000-000000045310','confirmed',null,null);"
 request="select public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','cancel','동시 취소 접수','defect');"
 if [[ "$first" == confirm ]];then first_sql="$confirm";second_sql="$request";else first_sql="$request";second_sql="$confirm";fi
 psql_exec -q <<SQL >"${claim_logs}/${first}-first.log" 2>&1 &
 set application_name='${claim_run}-first';begin;set local lock_timeout='5s';
 ${first_sql}
 select pg_sleep(1.5);commit;
SQL
 first_pid=$!;wait_event "${claim_run}-first" Timeout "$first_pid"
 psql_exec -q <<SQL >"${claim_logs}/${first}-second.log" 2>&1 &
 set application_name='${claim_run}-second';begin;set local lock_timeout='5s';
 ${second_sql}
 commit;
SQL
 second_pid=$!;wait_event "${claim_run}-second" Lock "$second_pid"
 wait "$first_pid"
 if [[ "$first" == confirm ]];then
  wait "$second_pid"
  grep -q 'not_cancelable' "${claim_logs}/${first}-second.log"
  psql_exec -qAt -c "select 1/case when not exists(select 1 from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310') then 1 else 0 end" >/dev/null
 else
  if wait "$second_pid";then echo 'confirmation won after claim' >&2;exit 1;fi
  grep -q 'order cancellation in progress' "${claim_logs}/${first}-second.log"
  psql_exec -qAt -c "select 1/case when (select status='paid' from public.orders where id='00000000-0000-4000-8000-000000045310') and (select count(*)=1 from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310') then 1 else 0 end" >/dev/null
 fi
 echo "PASS ${first}-first cancellation/confirmation serialization"
done

# No request can race through a shipment dispatch after confirmation.
psql_exec -q <<'SQL' >/dev/null
delete from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',false);
select public.admin_update_order_status('00000000-0000-4000-8000-000000045310','confirmed',null,null);
SQL
for first in dispatch request;do
 psql_exec -q -c "update public.order_shipments set status='ready',shipped_at=null,delivered_at=null where order_id='00000000-0000-4000-8000-000000045310'" >/dev/null
 dispatch="set local role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true); select public.admin_update_shipment_status('00000000-0000-4000-8000-000000045321','shipping','hanjin','RACE453001');"
 request="select public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','cancel','출고 경합 취소','defect');"
 if [[ "$first" == dispatch ]];then first_sql="$dispatch";second_sql="$request";else first_sql="$request";second_sql="$dispatch";fi
 psql_exec -q <<SQL >"${claim_logs}/dispatch-${first}-first.log" 2>&1 &
 set application_name='${claim_run}-first';begin;set local lock_timeout='5s';${first_sql}
 select pg_sleep(1.5);commit;
SQL
 first_pid=$!;wait_event "${claim_run}-first" Timeout "$first_pid"
 psql_exec -q <<SQL >"${claim_logs}/dispatch-${first}-second.log" 2>&1 &
 set application_name='${claim_run}-second';begin;set local lock_timeout='5s';${second_sql} commit;
SQL
 second_pid=$!;wait_event "${claim_run}-second" Lock "$second_pid"
 wait "$first_pid";wait "$second_pid"
 psql_exec -qAt -c "select 1/case when (select status='shipping' from public.orders where id='00000000-0000-4000-8000-000000045310') and not exists(select 1 from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310') then 1 else 0 end" >/dev/null
 echo "PASS ${first}-first cancellation/dispatch serialization"
done

# Recreate one delivered order with two actual goods and known return addresses.
psql_exec -q <<'SQL' >"${claim_logs}/collection-setup.log" 2>&1
begin;
delete from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310';
delete from public.orders where id='00000000-0000-4000-8000-000000045310';
insert into public.fulfillment_origins(id,code,name,default_carrier,return_address,base_fee) values
('00000000-0000-4000-8000-000000045341','claimracea','회수 경합 A','hanjin','합성 회수 A',0),
('00000000-0000-4000-8000-000000045342','claimraceb','회수 경합 B','hanjin','합성 회수 B',0);
insert into public.orders(id,user_id,status,total,address,delivered_at)
values('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','delivered',30000,'{}',now());
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select v.id,'00000000-0000-4000-8000-000000045310','claim-origin-test',g.id,v.qty,10000,'회수 상품','문구','claim-origin-test'
from (values ('00000000-0000-4000-8000-000000045311'::uuid,2),('00000000-0000-4000-8000-000000045312'::uuid,1)) v(id,qty)
cross join public.goods_variants g where g.good_id='claim-origin-test' and g.is_default;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,delivered_at) values
('00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045341','A',0,'{}','delivered',now()),
('00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045342','B',0,'{}','delivered',now());
insert into public.order_shipment_items(order_id,shipment_id,order_item_id) values
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045321','00000000-0000-4000-8000-000000045311'),
('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045322','00000000-0000-4000-8000-000000045312');
select public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','동시 회수 검증','defect');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
select public.admin_decide_order_claim((select id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310'),'approve',null);
commit;
SQL
claim_id="$(psql_exec -qAt -c "select id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310'")"
for scenario in two-receipts last-receipt-refund;do
 if [[ "$scenario" == last-receipt-refund ]];then
  # A new independent claim exercises the last physical receipt / financial entry
  # boundary after the first race proved both receipts cannot lose an update.
  psql_exec -q <<SQL >/dev/null
  begin;
  delete from public.order_cancellation_requests where id='${claim_id}';
  select public.request_order_claim('00000000-0000-4000-8000-000000045310','00000000-0000-4000-8000-000000045302','return','환불 경합 검증','defect');
  set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
  select public.admin_decide_order_claim((select id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310'),'approve',null);
  select public.admin_record_order_claim_origin_collection((select id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310'),'00000000-0000-4000-8000-000000045321','A 실물 확인');
  commit;
SQL
  claim_id="$(psql_exec -qAt -c "select id from public.order_cancellation_requests where order_id='00000000-0000-4000-8000-000000045310'")"
  first_sql="select public.admin_record_order_claim_origin_collection('${claim_id}','00000000-0000-4000-8000-000000045322','B 실물 확인');"
  second_sql="select public.admin_record_order_claim_refund('${claim_id}','pg_cancel','filed',null);"
 else
  first_sql="select public.admin_record_order_claim_origin_collection('${claim_id}','00000000-0000-4000-8000-000000045321','A 실물 확인');"
  second_sql="select public.admin_record_order_claim_origin_collection('${claim_id}','00000000-0000-4000-8000-000000045322','B 실물 확인');"
 fi
 psql_exec -q <<SQL >"${claim_logs}/${scenario}-first.log" 2>&1 &
 set application_name='${claim_run}-first';begin;set local lock_timeout='5s';
 set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
 ${first_sql}
 select pg_sleep(1.5);commit;
SQL
 first_pid=$!;wait_event "${claim_run}-first" Timeout "$first_pid"
 psql_exec -q <<SQL >"${claim_logs}/${scenario}-second.log" 2>&1 &
 set application_name='${claim_run}-second';begin;set local lock_timeout='5s';
 set local role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000045301',true);
 ${second_sql}
 commit;
SQL
 second_pid=$!;wait_event "${claim_run}-second" Lock "$second_pid"
 wait "$first_pid";wait "$second_pid"
 psql_exec -qAt -c "select 1/case when (select count(*)=2 from public.order_claim_collections where claim_id='${claim_id}' and collected_at is not null) then 1 else 0 end" >/dev/null
 echo "PASS ${scenario} serializes physical and financial transitions"
done

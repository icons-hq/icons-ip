#!/usr/bin/env bash
set -euo pipefail
psql_bin="${PSQL_BIN:-psql}"
work_dir="$(mktemp -d)"
app_prefix="fulfillment-policy-race-$$"
origin='00000000-0000-4000-8000-000000042291'
actor='00000000-0000-4000-8000-000000042292'
order_a='00000000-0000-4000-8000-000000042293'
order_b='00000000-0000-4000-8000-000000042294'
psql_exec() { "$psql_bin" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"; }
kc_fixture_sql="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
psql_exec_with_kc() { { cat "$kc_fixture_sql"; cat; } | psql_exec "$@"; }
cleanup() {
  local result=$?
  if ! psql_exec_with_kc -q > "$work_dir/cleanup.log" 2>&1 <<SQL
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${app_prefix}-%' and pid<>pg_backend_pid();
begin;
delete from public.orders where id in ('${order_a}','${order_b}');
select pg_temp.cleanup_goods_kc_fixture('fulfillment-policy-race');
delete from public.goods_variants where good_id='fulfillment-policy-race';
delete from public.goods where id='fulfillment-policy-race';
delete from public.ips where id='fulfillment-policy-race';
delete from public.verticals where key='fulfillment-policy-race';
delete from public.fulfillment_origins where id='${origin}';
delete from auth.users where id='${actor}';
commit;
SQL
  then cat "$work_dir/cleanup.log" >&2; echo "Cleanup failed; evidence: $work_dir" >&2; exit 1; fi
  rm -rf "$work_dir"
  exit "$result"
}
trap cleanup EXIT
psql_exec_with_kc -q >/dev/null <<SQL
begin;
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,free_threshold,is_active) values('${origin}','policy-race','정책 경합 검증','hanjin',1900,null,true);
insert into public.verticals(key,label,color) values('fulfillment-policy-race','정책 경합 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('fulfillment-policy-race','정책 경합 검증','fulfillment-policy-race',now());
insert into public.goods(id,ip_id,name,type,price,origin_id,published_at) values('fulfillment-policy-race','fulfillment-policy-race','정책 경합 검증','문구',1000,'${origin}',null);
select pg_temp.publish_goods_kc_fixture('fulfillment-policy-race');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('${actor}','authenticated','authenticated','fulfillment-policy-race@example.test',now(),'{}','{}',now(),now());
insert into public.orders(id,user_id,status,total,shipping_fee,address,expires_at)
select id::uuid,'${actor}','pending',0,0,'{"recipientName":"정책 검증","phone":"01000000000","postalCode":"12345","address1":"서울시 합성 검증주소"}',now()+interval '1 hour' from unnest(array['${order_a}','${order_b}'])id;
insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot, variant_id)
select id::uuid,'fulfillment-policy-race',1,1000,'정책 경합 검증','문구','fulfillment-policy-race', (select id from public.goods_variants where good_id='fulfillment-policy-race' and is_default) from unnest(array['${order_a}','${order_b}'])id;
commit;
SQL
wait_state() {
  local app="$1" expected="$2" pid="$3" log="$4" observed=''
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    if [[ "$observed" == "$expected" ]]; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.025
  done
  cat "$log" >&2; echo "expected $expected, observed $observed" >&2; return 1
}
psql_exec -q > "$work_dir/settings-first.log" 2>&1 <<SQL &
set application_name='${app_prefix}-settings-first';
begin;
update public.fulfillment_origins set base_fee=4200 where id='${origin}';
select pg_sleep(1.5);
commit;
SQL
first_pid=$!
wait_state "${app_prefix}-settings-first" Timeout "$first_pid" "$work_dir/settings-first.log"
psql_exec -q > "$work_dir/order-second.log" 2>&1 <<SQL &
set application_name='${app_prefix}-order-second';
begin;
set local lock_timeout='5s';
select private.goods_shipping_fee_for('${order_a}'::uuid) as fee \gset
update public.orders set shipping_fee=:'fee'::bigint where id='${order_a}';
commit;
SQL
second_pid=$!
wait_state "${app_prefix}-order-second" Lock "$second_pid" "$work_dir/order-second.log"
wait "$first_pid" || { cat "$work_dir/settings-first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$work_dir/order-second.log" >&2; exit 1; }
psql_exec -q -c "select 1 / case when (select shipping_fee from public.orders where id='${order_a}')=4200 then 1 else 0 end" >/dev/null
psql_exec -q > "$work_dir/order-first.log" 2>&1 <<SQL &
set application_name='${app_prefix}-order-first';
begin;
select private.goods_shipping_fee_for('${order_b}'::uuid) as fee \gset
update public.orders set shipping_fee=:'fee'::bigint where id='${order_b}';
select pg_sleep(1.5);
commit;
SQL
first_pid=$!
wait_state "${app_prefix}-order-first" Timeout "$first_pid" "$work_dir/order-first.log"
psql_exec -q > "$work_dir/settings-second.log" 2>&1 <<SQL &
set application_name='${app_prefix}-settings-second';
begin;
set local lock_timeout='5s';
update public.fulfillment_origins set base_fee=9800 where id='${origin}';
commit;
SQL
second_pid=$!
wait_state "${app_prefix}-settings-second" Lock "$second_pid" "$work_dir/settings-second.log"
wait "$first_pid" || { cat "$work_dir/order-first.log" >&2; exit 1; }
wait "$second_pid" || { cat "$work_dir/settings-second.log" >&2; exit 1; }
psql_exec -q -c "select 1 / case when (select base_fee from public.fulfillment_origins where id='${origin}')=9800 and not exists(select 1 from public.orders where id in ('${order_a}','${order_b}') and (shipping_fee<>4200 or shipping_fee_breakdown->0->>'totalFee'<>'4200')) then 1 else 0 end" >/dev/null
echo 'PASS origin policy/order snapshots serialize in both directions and retain the charged fee'

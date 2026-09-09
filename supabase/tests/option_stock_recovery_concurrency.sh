#!/usr/bin/env bash
set -euo pipefail

# Host psql only. Shared developer 54322 is forbidden; GitHub CI owns its fresh stack.
[[ "${PGHOST:-}" == '127.0.0.1' && "${PGPORT:-}" =~ ^[1-9][0-9]{0,4}$ ]] && (( PGPORT <= 65535 )) &&
[[ ( "$PGPORT" != '54322' || "${GITHUB_ACTIONS:-}" == 'true' ) && "${PGDATABASE:-postgres}" == 'postgres' && "${PGUSER:-postgres}" == 'postgres' ]] || {
  echo 'Set PGHOST=127.0.0.1, a canonical isolated PGPORT (1..65535, no shared 54322), and postgres user/database.' >&2; exit 1;
}
psql_bin="${PSQL_BIN:-psql}"
psql_exec() { env -u PGHOSTADDR -u PGSERVICE -u PGSERVICEFILE "$psql_bin" -X -h "$PGHOST" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
work_dir="${OPTION_STOCK_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$work_dir"
fixture_ids="$(psql_exec -qAt -c "select string_agg(extensions.gen_random_uuid()::text,'|' order by n) from generate_series(1,13) n")"
IFS='|' read -r staff customer blue red first_order second_order first_item second_item payment adjustment origin first_shipment second_shipment <<< "$fixture_ids"
for fixture_id in "$staff" "$customer" "$blue" "$red" "$first_order" "$second_order" "$first_item" "$second_item" "$payment" "$adjustment" "$origin" "$first_shipment" "$second_shipment"; do
  [[ "$fixture_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo 'Invalid fixture UUID; no cleanup or writes attempted.' >&2; exit 1; }
done
test_suffix="${staff//-/}"
test_prefix="option-recovery-${test_suffix:0:12}"
# Guard before installing the destructive cleanup trap. Even an unlikely UUID,
# catalog code, or synthetic email collision must never claim pre-existing rows.
psql_exec -q <<SQL >"$work_dir/preflight.log"
select 1 / case when
  (select count(distinct id) from unnest(string_to_array('${fixture_ids}','|')) id)=13
  and not exists(select 1 from auth.users where id in('${staff}','${customer}') or email in('${staff}@option-race.test','${customer}@option-race.test'))
  and not exists(select 1 from public.profiles where id in('${staff}','${customer}'))
  and not exists(select 1 from public.ips where id='${test_prefix}')
  and not exists(select 1 from public.goods where id='${test_prefix}')
  and not exists(select 1 from public.goods_variants where id in('${blue}','${red}'))
  and not exists(select 1 from public.orders where id in('${first_order}','${second_order}'))
  and not exists(select 1 from public.order_items where id in('${first_item}','${second_item}'))
  and not exists(select 1 from public.order_shipments where id in('${first_shipment}','${second_shipment}'))
  and not exists(select 1 from public.fulfillment_origins where id='${origin}' or code='${test_prefix}')
  and not exists(select 1 from public.payments where id='${payment}' or payment_key='${test_prefix}' or idempotency_key='${payment}')
  and not exists(select 1 from public.audit_log where id='${adjustment}' or actor_id='${staff}' or target in('order:${first_order}','order:${second_order}'))
  then 1 else 0 end;
SQL
cleanup() {
  local code=$?
  trap - EXIT
  if ! psql_exec -q <<SQL >"$work_dir/cleanup.log" 2>&1
set lock_timeout='5s'; set statement_timeout='30s';
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${test_prefix}-%' and pid<>pg_backend_pid();
begin;
delete from public.order_cancellation_requests where order_id in('${first_order}','${second_order}');
delete from public.order_cancellation_claims where order_id in('${first_order}','${second_order}');
delete from public.refunds where payment_id='${payment}';
delete from public.payments where id='${payment}';
delete from public.order_shipments where order_id in('${first_order}','${second_order}');
delete from public.order_items where order_id in('${first_order}','${second_order}');
delete from public.orders where id in('${first_order}','${second_order}');
delete from public.audit_log where actor_id='${staff}' or target in('order:${first_order}','order:${second_order}');
delete from public.goods where id='${test_prefix}';
delete from public.ips where id='${test_prefix}';
delete from public.fulfillment_origins where id='${origin}';
delete from auth.users where id in('${staff}','${customer}');
select 1 / case when
  not exists(select 1 from auth.users where id in('${staff}','${customer}'))
  and not exists(select 1 from public.profiles where id in('${staff}','${customer}'))
  and not exists(select 1 from public.orders where id in('${first_order}','${second_order}'))
  and not exists(select 1 from public.order_cancellation_requests where order_id in('${first_order}','${second_order}'))
  and not exists(select 1 from public.order_cancellation_claims where order_id in('${first_order}','${second_order}'))
  and not exists(select 1 from public.order_shipments where id in('${first_shipment}','${second_shipment}'))
  and not exists(select 1 from public.order_shipment_items where shipment_id in('${first_shipment}','${second_shipment}'))
  and not exists(select 1 from public.order_claim_collections where shipment_id in('${first_shipment}','${second_shipment}'))
  and not exists(select 1 from public.order_claim_reshipment_items where good_id='${test_prefix}')
  and not exists(select 1 from public.order_items where id in('${first_item}','${second_item}'))
  and not exists(select 1 from public.payments where id='${payment}')
  and not exists(select 1 from public.refunds where payment_id='${payment}')
  and not exists(select 1 from public.audit_log where id='${adjustment}' or actor_id='${staff}' or target in('order:${first_order}','order:${second_order}'))
  and not exists(select 1 from public.goods_variants where good_id='${test_prefix}')
  and not exists(select 1 from public.goods where id='${test_prefix}')
  and not exists(select 1 from public.ips where id='${test_prefix}')
  and not exists(select 1 from public.fulfillment_origins where id='${origin}')
  then 1 else 0 end;
commit;
SQL
  then
    echo 'Fixture cleanup failed; see cleanup.log.' >&2
    [[ "$code" != 0 ]] || code=1
  fi
  if [[ "$code" != 0 ]]; then cat "$work_dir"/*.log >&2; fi
  exit "$code"
}
wait_for_state() {
  local app="$1" expected="$2" process="$3" log="$4" observed=''
  for _ in $(seq 1 200); do
    observed="$(psql_exec -qAt -c "select coalesce(wait_event_type,'') from pg_stat_activity where application_name='${app}'")"
    [[ "$observed" != "$expected" ]] || return 0
    if ! kill -0 "$process" 2>/dev/null; then cat "$log" >&2; return 1; fi
    sleep 0.025
  done
  echo "${app}: expected ${expected}, got ${observed}" >&2; return 1
}
if ! psql_exec -q <<SQL >"$work_dir/setup.log" 2>&1
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('${staff}','authenticated','authenticated','${staff}@option-race.test',now(),'{}','{}',now(),now()),
('${customer}','authenticated','authenticated','${customer}@option-race.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='${staff}';
insert into public.ips(id,title,vertical_key) values('${test_prefix}','옵션 경합 테스트','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
values('${origin}','${test_prefix}','합성 옵션 반송지',0,'합성 옵션 경합 반송 주소');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values('${test_prefix}','${test_prefix}','옵션 경합','문구',10000,'ok',0,'${origin}');
insert into public.goods_variants(id,good_id,name,price,stock_qty) values('${blue}','${test_prefix}','파랑',10000,0),('${red}','${test_prefix}','빨강',10000,1);
insert into public.orders(id,user_id,status,total,address,shipped_at,delivered_at) values
('${first_order}','${customer}','delivered',10000,'{}',now(),now()),('${second_order}','${customer}','delivered',10000,'{}',now(),now());
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
('${first_item}','${first_order}','${test_prefix}','${blue}',1,10000,'옵션 경합','문구','${test_prefix}'),
('${second_item}','${second_order}','${test_prefix}','${blue}',1,10000,'옵션 경합','문구','${test_prefix}');
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values
('${first_shipment}','${first_order}','${origin}','합성 옵션 반송지',0,'{}','delivered','hanjin','SALE440001',now(),now()),
('${second_shipment}','${second_order}','${origin}','합성 옵션 반송지',0,'{}','delivered','hanjin','SALE440002',now(),now());
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values
('${first_order}','${first_shipment}','${first_item}',1),('${second_order}','${second_shipment}','${second_item}',1);
select 1 / case when public.request_order_claim('${first_order}','${customer}','exchange','첫 주문 옵션 교환','defect')='requested'
  and public.request_order_claim('${second_order}','${customer}','exchange','둘째 주문 옵션 교환','defect')='requested' then 1 else 0 end;
select id as first_claim from public.order_cancellation_requests where order_id='${first_order}' \gset
select id as second_claim from public.order_cancellation_requests where order_id='${second_order}' \gset
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_decide_order_claim(:'first_claim','approve',null);
select public.admin_decide_order_claim(:'second_claim','approve',null);
select 1 / case when public.admin_record_order_claim_origin_collection(:'first_claim','${first_shipment}','첫 주문 파랑 옵션 1개 실물 입고 확인')='collected'
  and public.admin_record_order_claim_origin_collection(:'second_claim','${second_shipment}','둘째 주문 파랑 옵션 1개 실물 입고 확인')='collected' then 1 else 0 end;
commit;
SQL
then
  cat "$work_dir/setup.log" >&2
  exit 1
fi
# Only a committed setup owns rows. A collision or failed RPC rolls back the
# entire setup and must not arm cleanup against someone else's existing rows.
trap cleanup EXIT
claim_ids="$(psql_exec -qAt -c "select (select id from public.order_cancellation_requests where order_id='${first_order}'),(select id from public.order_cancellation_requests where order_id='${second_order}')")"
IFS='|' read -r first_claim second_claim <<< "$claim_ids"
for claim_id in "$first_claim" "$second_claim"; do
  [[ "$claim_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo 'Expected one requested and collected exchange per fixture order.' >&2; exit 1; }
done

# One claim holds the last red option. Its retry waits on order; another order
# waits on goods. Only one shipment can consume that option.
psql_exec -q <<SQL >"$work_dir/reship-holder.log" 2>&1 &
set application_name='${test_prefix}-reship-holder'; begin; set local lock_timeout='5s';
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_record_order_claim_reshipment('${first_claim}','hanjin','RACE440001','[{"orderItemId":"${first_item}","variantId":"${red}"}]');
select pg_sleep(1.5); commit;
SQL
holder=$!
wait_for_state "${test_prefix}-reship-holder" Timeout "$holder" "$work_dir/reship-holder.log"
psql_exec -q <<SQL >"$work_dir/reship-replay.log" 2>&1 &
set application_name='${test_prefix}-reship-replay'; begin; set local lock_timeout='5s';
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_record_order_claim_reshipment('${first_claim}','hanjin','RACE440001','[{"orderItemId":"${first_item}","variantId":"${red}"}]'); commit;
SQL
replay=$!
wait_for_state "${test_prefix}-reship-replay" Lock "$replay" "$work_dir/reship-replay.log"
psql_exec -q <<SQL >"$work_dir/reship-competing.log" 2>&1 &
set application_name='${test_prefix}-reship-competing'; begin; set local lock_timeout='5s';
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_record_order_claim_reshipment('${second_claim}','hanjin','RACE440002','[{"orderItemId":"${second_item}","variantId":"${red}"}]'); commit;
SQL
competing=$!
wait_for_state "${test_prefix}-reship-competing" Lock "$competing" "$work_dir/reship-competing.log"
wait "$holder"; wait "$replay"
if wait "$competing"; then echo 'last option shipped twice' >&2; exit 1; fi
grep -Fq 'stock_out_of_range' "$work_dir/reship-competing.log"
psql_exec -q <<SQL >"$work_dir/reship-assert.log"
select 1 / case when (select stock_qty from public.goods_variants where id='${red}')=0
and (select stock_qty from public.goods_variants where id='${blue}')=1
and (select count(*) from public.order_claim_reshipment_items where claim_id in('${first_claim}','${second_claim}'))=1
and (select count(*) from public.audit_log where action='admin.order.claim_reshipped' and target='order:${first_order}')=1
then 1 else 0 end;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,provider,payment_key,idempotency_key)
values('${payment}','${customer}','order','${first_order}',10000,'paid','toss','${test_prefix}','${payment}');
SQL
echo 'PASS last-option exchange and duplicate request serialize without overshipping'

# A later refund restores the exchanged option exactly once. An operator who
# loaded its old quantity must fail optimistic locking after waiting for refund.
# The replacement must really be delivered, then a new full return must be
# approved and received at its origin before creating the refund intent.
psql_exec -q <<SQL >"$work_dir/return-setup.log" 2>&1
begin;
select 1 / case when public.request_order_claim('${first_order}','${customer}','return','교환품 이동 중 반품','defect')='not_claimable' then 1 else 0 end;
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_record_order_claim_reshipment_delivery('${first_claim}','빨강 교환품 1개 실제 배송완료 근거 대조');
reset role;
select 1 / case when public.request_order_claim('${first_order}','${customer}','return','교환 후 전액 반품','defect')='requested' then 1 else 0 end;
select id as return_claim from public.order_cancellation_requests where order_id='${first_order}' and claim_type='return' \gset
set local role authenticated;
select public.admin_decide_order_claim(:'return_claim','approve',null);
select 1 / case when public.admin_record_order_claim_origin_collection(:'return_claim','${first_shipment}','마지막 재출고 빨강 옵션 1개 실물 입고 확인')='collected' then 1 else 0 end;
select public.admin_record_order_claim_refund(:'return_claim','pg_cancel','filed',null);
reset role;
select 1 / case when (select stock_qty from public.goods_variants where id='${red}')=0
  and (select stock_qty from public.goods_variants where id='${blue}')=1
  and exists(select 1 from public.order_cancellation_claims where order_id='${first_order}')
  and exists(select 1 from public.order_cancellation_requests where id=:'return_claim' and stage='processing')
  then 1 else 0 end;
commit;
SQL
psql_exec -q <<SQL >"$work_dir/refund-holder.log" 2>&1 &
set application_name='${test_prefix}-refund-holder'; begin; set local lock_timeout='5s';
select public.finalize_order_cancellation_with_provider_evidence('${first_order}','교환 후 반품',array['${test_prefix}']);
select pg_sleep(1.5); commit;
SQL
holder=$!
wait_for_state "${test_prefix}-refund-holder" Timeout "$holder" "$work_dir/refund-holder.log"
psql_exec -q <<SQL >"$work_dir/refund-replay.log" 2>&1 &
set application_name='${test_prefix}-refund-replay'; begin; set local lock_timeout='5s';
select public.finalize_order_cancellation_with_provider_evidence('${first_order}','교환 후 반품',array['${test_prefix}']); commit;
SQL
replay=$!
wait_for_state "${test_prefix}-refund-replay" Lock "$replay" "$work_dir/refund-replay.log"
psql_exec -q <<SQL >"$work_dir/stale-adjustment.log" 2>&1 &
set application_name='${test_prefix}-stale-adjustment'; begin; set local lock_timeout='5s';
set local role authenticated; select set_config('request.jwt.claim.sub','${staff}',true);
select public.admin_adjust_stock('${adjustment}','${test_prefix}','${red}',0,1,'오래된 입고 화면'); commit;
SQL
adjuster=$!
wait_for_state "${test_prefix}-stale-adjustment" Lock "$adjuster" "$work_dir/stale-adjustment.log"
wait "$holder"; wait "$replay"
if wait "$adjuster"; then echo 'stale option quantity accepted' >&2; exit 1; fi
grep -Fq 'stock_changed' "$work_dir/stale-adjustment.log"
psql_exec -q <<SQL >"$work_dir/refund-assert.log"
select 1 / case when (select stock_qty from public.goods_variants where id='${red}')=1
and (select stock_qty from public.goods_variants where id='${blue}')=1
and (select stock_qty from public.goods where id='${test_prefix}')=2
and (select count(*) from public.audit_log where action='order.option_stock_restored' and target='order:${first_order}')=1
and not exists(select 1 from public.audit_log where id='${adjustment}') then 1 else 0 end;
SQL
echo 'PASS refund replay and stale operator adjustment preserve exact option quantities'

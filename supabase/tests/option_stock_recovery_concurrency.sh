#!/usr/bin/env bash
set -euo pipefail

# Host psql only. Shared developer 54322 is forbidden; GitHub CI owns its fresh stack.
[[ "${PGHOST:-}" == '127.0.0.1' && -n "${PGPORT:-}" && ( "$PGPORT" != '54322' || "${GITHUB_ACTIONS:-}" == 'true' ) ]] || {
  echo 'Set PGHOST=127.0.0.1 and an isolated PGPORT other than shared 54322.' >&2; exit 1;
}
psql_bin="${PSQL_BIN:-psql}"
psql_exec() { "$psql_bin" -X -U "${PGUSER:-postgres}" -d "${PGDATABASE:-postgres}" -v ON_ERROR_STOP=1 "$@"; }
test_prefix="option-recovery-$$"
work_dir="${OPTION_STOCK_LOG_DIR:-$(mktemp -d)}"
mkdir -p "$work_dir"
IFS='|' read -r staff customer blue red first_order second_order first_item second_item first_claim second_claim payment adjustment < <(
  psql_exec -qAt -c 'select extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid(),extensions.gen_random_uuid()'
)
cleanup() {
  local code=$?
  trap - EXIT
  psql_exec -q <<SQL >"$work_dir/cleanup.log" 2>&1 || true
select pg_terminate_backend(pid) from pg_stat_activity where application_name like '${test_prefix}-%' and pid<>pg_backend_pid();
delete from public.order_cancellation_requests where order_id in('${first_order}','${second_order}');
delete from public.order_items where order_id in('${first_order}','${second_order}');
delete from public.refunds where payment_id='${payment}';
delete from public.payments where id='${payment}';
delete from public.orders where id in('${first_order}','${second_order}');
delete from public.audit_log where actor_id='${staff}' or target in('order:${first_order}','order:${second_order}');
delete from public.goods where id='${test_prefix}';
delete from public.ips where id='${test_prefix}';
delete from auth.users where id in('${staff}','${customer}');
SQL
  if [[ "$code" != 0 ]]; then cat "$work_dir"/*.log >&2; fi
  exit "$code"
}
trap cleanup EXIT
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
psql_exec -q <<SQL >"$work_dir/setup.log"
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
('${staff}','authenticated','authenticated','${staff}@option-race.test',now(),'{}','{}',now(),now()),
('${customer}','authenticated','authenticated','${customer}@option-race.test',now(),'{}','{}',now(),now());
update public.profiles set role='staff' where id='${staff}';
insert into public.ips(id,title,vertical_key) values('${test_prefix}','옵션 경합 테스트','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('${test_prefix}','${test_prefix}','옵션 경합','문구',10000,'ok',0);
insert into public.goods_variants(id,good_id,name,price,stock_qty) values('${blue}','${test_prefix}','파랑',10000,0),('${red}','${test_prefix}','빨강',10000,1);
insert into public.orders(id,user_id,status,total,address,shipped_at,delivered_at) values
('${first_order}','${customer}','delivered',10000,'{}',now(),now()),('${second_order}','${customer}','delivered',10000,'{}',now(),now());
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values
('${first_item}','${first_order}','${test_prefix}','${blue}',1,10000,'옵션 경합','문구','${test_prefix}'),
('${second_item}','${second_order}','${test_prefix}','${blue}',1,10000,'옵션 경합','문구','${test_prefix}');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,collected_at) values
('${first_claim}','${first_order}','${customer}','옵션 교환','exchange','collected',now()),
('${second_claim}','${second_order}','${customer}','옵션 교환','exchange','collected',now());
commit;
SQL

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
rg -q 'stock_out_of_range' "$work_dir/reship-competing.log"
psql_exec -q <<SQL >"$work_dir/reship-assert.log"
select 1 / case when (select stock_qty from public.goods_variants where id='${red}')=0
and (select stock_qty from public.goods_variants where id='${blue}')=1
and (select count(*) from public.order_claim_reshipment_items where claim_id in('${first_claim}','${second_claim}'))=1
and (select count(*) from public.audit_log where action='admin.order.claim_reshipped' and target='order:${first_order}')=1
then 1 else 0 end;
insert into public.payments(id,user_id,purpose,ref_id,amount,status,provider,payment_key,idempotency_key)
values('${payment}','${customer}','order','${first_order}',10000,'paid','toss','${test_prefix}','${payment}');
insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values('${first_order}','${customer}','delivered');
SQL
echo 'PASS last-option exchange and duplicate request serialize without overshipping'

# A later refund restores the exchanged option exactly once. An operator who
# loaded its old quantity must fail optimistic locking after waiting for refund.
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
rg -q 'stock_changed' "$work_dir/stale-adjustment.log"
psql_exec -q <<SQL >"$work_dir/refund-assert.log"
select 1 / case when (select stock_qty from public.goods_variants where id='${red}')=1
and (select stock_qty from public.goods_variants where id='${blue}')=1
and (select stock_qty from public.goods where id='${test_prefix}')=2
and (select count(*) from public.audit_log where action='order.option_stock_restored' and target='order:${first_order}')=1
and not exists(select 1 from public.audit_log where id='${adjustment}') then 1 else 0 end;
SQL
echo 'PASS refund replay and stale operator adjustment preserve exact option quantities'

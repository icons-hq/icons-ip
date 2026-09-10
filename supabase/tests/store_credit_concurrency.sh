#!/usr/bin/env bash
set -euo pipefail

# No implicit default stack. The caller must select a task-owned disposable DB.
: "${SUPABASE_DB_CONTAINER:?Set SUPABASE_DB_CONTAINER to the task-owned test database}"
credit_container="$SUPABASE_DB_CONTAINER"
credit_user='00000000-0000-4000-8000-000000004899'
credit_admin='00000000-0000-4000-8000-000000004898'
credit_prefix="store-credit-race-$$"
credit_output_root="${STORE_CREDIT_TEST_OUTPUT_DIR:-/tmp}"
mkdir -p "$credit_output_root"
credit_logs="$(mktemp -d "${credit_output_root%/}/store-credit-race.XXXXXX")"
psql_exec() { docker exec -i "$credit_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_scalar() { psql_exec -A -t -q -c "$1"; }
kc_fixture_sql="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
psql_exec_with_kc() { { cat "$kc_fixture_sql"; cat; } | psql_exec "$@"; }
credit_policy_before="$(psql_scalar 'select to_jsonb(p) from private.store_credit_policy p where singleton')"
credit_expiry="$(psql_scalar "select (now()+interval '2 days')::text")"

cleanup() {
  # Wait for only this script's bounded transactions; never terminate a daemon,
  # server, unrelated connection, or the user's regular Supabase stack.
  wait || true
  psql_exec_with_kc -q -v original_policy="$credit_policy_before" <<SQL
delete from private.store_credit_allocations where user_id='$credit_user';
delete from private.store_credit_checkout_intents where user_id='$credit_user';
delete from public.store_credit_ledger where user_id='$credit_user';
delete from private.store_credit_lots where user_id='$credit_user';
delete from private.store_credit_accounts where user_id='$credit_user';
delete from private.store_credit_operations where actor_id='$credit_admin';
delete from public.audit_log where actor_id in ('$credit_user','$credit_admin');
delete from public.order_cancellation_requests where order_id in(select id from public.orders where user_id='$credit_user');
delete from public.order_shipment_items where order_id in(select id from public.orders where user_id='$credit_user');
delete from public.order_shipments where order_id in(select id from public.orders where user_id='$credit_user');
delete from public.order_items where order_id in(select id from public.orders where user_id='$credit_user');
delete from public.orders where user_id='$credit_user';
delete from public.cart_items where user_id='$credit_user';
select pg_temp.cleanup_goods_kc_fixture('store-credit-race-good');
delete from public.goods where id='store-credit-race-good';
delete from public.ips where id='store-credit-race-ip';
delete from public.profiles where id in ('$credit_user','$credit_admin');
delete from auth.users where id in ('$credit_user','$credit_admin');
update private.store_credit_policy p set (enabled,earn_kind,earn_value,earn_max_per_order,max_balance,validity_days,min_use,max_use,restore_grace_days,refund_earned_credit_mode,evidence,version,updated_at)=
  (select r.enabled,r.earn_kind,r.earn_value,r.earn_max_per_order,r.max_balance,r.validity_days,r.min_use,r.max_use,r.restore_grace_days,r.refund_earned_credit_mode,r.evidence,r.version,r.updated_at
   from jsonb_populate_record(null::private.store_credit_policy,:'original_policy'::jsonb) r) where p.singleton;
SQL
  printf 'Evidence preserved: %s\n' "$credit_logs"
}
trap cleanup EXIT

psql_exec_with_kc -q <<SQL
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('$credit_admin','authenticated','authenticated','store-credit-race-admin@example.test',now(),'{}','{}',now(),now()),
 ('$credit_user','authenticated','authenticated','store-credit-race-user@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='credit-race-'||right(id::text,4)||'@example.test',nickname='credit_race_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='$credit_admin' then 'admin'::public.user_role else 'user'::public.user_role end where id in ('$credit_admin','$credit_user');
update private.store_credit_policy set enabled=true,earn_kind='rate_bps',earn_value=1000,earn_max_per_order=10000,max_balance=100000,validity_days=30,min_use=100,max_use=10000,restore_grace_days=3,refund_earned_credit_mode='offset_future_credits',evidence='synthetic concurrency fixture';
insert into public.ips(id,title,vertical_key,published_at) values('store-credit-race-ip','동시성 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values('store-credit-race-good','store-credit-race-ip','동시성 합성 굿즈','문구',10000,'ok',20,null);
select pg_temp.publish_goods_kc_fixture('store-credit-race-good');
SQL

wait_for_sleep() {
  local app_name="$1"
  for _ in $(seq 1 100); do
    if [[ "$(psql_scalar "select count(*) from pg_stat_activity where application_name='$app_name' and wait_event='PgSleep'")" == '1' ]]; then return 0; fi
    sleep 0.02
  done
  echo "Timed out waiting for owned transaction: $app_name" >&2
  return 1
}

# 1. Replayed administrative issuance: same operation + same frozen input.
psql_exec -q >"$credit_logs/grant-a" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; set local application_name='$credit_prefix-grant';
select set_config('request.jwt.claim.sub','$credit_admin',true); set local role authenticated;
select public.admin_adjust_store_credit('10000000-0000-4000-8000-000000004899','$credit_user',1000,'$credit_expiry','동시 지급 검증',0);
select pg_sleep(1); commit;
SQL
credit_pid_a=$!
wait_for_sleep "$credit_prefix-grant"
psql_exec -q >"$credit_logs/grant-b" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; select set_config('request.jwt.claim.sub','$credit_admin',true); set local role authenticated;
select public.admin_adjust_store_credit('10000000-0000-4000-8000-000000004899','$credit_user',1000,'$credit_expiry','동시 지급 검증',0); commit;
SQL
credit_pid_b=$!
wait "$credit_pid_a"; wait "$credit_pid_b"
psql_exec -q <<SQL
select set_config('request.jwt.claim.sub','$credit_user',false);
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=1000 and (public.get_my_store_credit_history()->>'total')::bigint=1 then 1 else 0 end as duplicate_grant_once;
SQL

# 2. Two real checkouts insert their own cart selection. After the first commit
# the second still cannot reuse the first order's reserved balance.
psql_exec -q >"$credit_logs/spend-a" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; set local application_name='$credit_prefix-spend';
select set_config('request.jwt.claim.sub','$credit_user',true); set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '$credit_user','store-credit-race-good',id,1 from public.goods_variants where good_id='store-credit-race-good' and is_default;
reset role; set local role service_role;
select public.place_order_with_store_credits('$credit_user','{"recipientName":"동시성","phone":"01012345678","postalCode":"12345","address1":"합성주소"}','20000000-0000-4000-8000-000000004898','card',600);
select pg_sleep(1); commit;
SQL
credit_pid_a=$!
wait_for_sleep "$credit_prefix-spend"
psql_exec -q >"$credit_logs/spend-b" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; select set_config('request.jwt.claim.sub','$credit_user',true); set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '$credit_user','store-credit-race-good',id,1 from public.goods_variants where good_id='store-credit-race-good' and is_default;
reset role; set local role service_role;
select public.place_order_with_store_credits('$credit_user','{"recipientName":"동시성","phone":"01012345678","postalCode":"12345","address1":"합성주소"}','20000000-0000-4000-8000-000000004899','card',600); commit;
SQL
credit_pid_b=$!
wait "$credit_pid_a"
if wait "$credit_pid_b"; then echo 'Concurrent overspend unexpectedly succeeded' >&2; exit 1; fi
if ! rg -q 'store_credit_insufficient' "$credit_logs/spend-b"; then cat "$credit_logs/spend-b" >&2; exit 1; fi
psql_exec -q <<SQL
select set_config('request.jwt.claim.sub','$credit_user',false);
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=400 and (public.get_my_store_credit_history()->>'reserved')::bigint=600 then 1 else 0 end as simultaneous_orders_do_not_double_spend;
update private.store_credit_lots set expires_at=now()-interval '1 second' where user_id='$credit_user';
update private.store_credit_allocations set original_expires_at=now()-interval '1 second' where user_id='$credit_user';
SQL

# 3. Terminal cancellation races expiry. An expiry worker cannot expire the
# restored allocation or restore it twice while the account is held.
psql_exec -q >"$credit_logs/cancel" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; set local application_name='$credit_prefix-cancel'; set local role service_role;
select public.request_order_cancellation((select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004898'),'$credit_user','동시 만료 검증','change_of_mind');
select pg_sleep(1); commit;
SQL
credit_pid_a=$!
wait_for_sleep "$credit_prefix-cancel"
psql_exec -q >"$credit_logs/expiry" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; set local role service_role; select public.expire_store_credits(); commit;
SQL
credit_pid_b=$!
wait "$credit_pid_a"; wait "$credit_pid_b"
psql_exec -q <<SQL
set role service_role;
select public.request_order_cancellation((select id from public.orders where checkout_key='20000000-0000-4000-8000-000000004898'),'$credit_user','동시 만료 검증','change_of_mind');
reset role;
select set_config('request.jwt.claim.sub','$credit_user',false);
select 1/case when (public.get_my_store_credit_history()->>'available')::bigint=600 and (public.get_my_store_credit_history()->>'reserved')::bigint=0
  and (select count(*) from public.store_credit_ledger where user_id='$credit_user' and kind='expire')=1 then 1 else 0 end as expiry_cancel_race_preserves_exact_restoration;
SQL
echo 'PASS: duplicate issuance, concurrent order use, expiration/cancellation restoration'

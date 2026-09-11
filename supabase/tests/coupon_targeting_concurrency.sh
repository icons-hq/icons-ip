#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_DB_CONTAINER:?Set SUPABASE_DB_CONTAINER to a task-owned test database}"
coupon_container="$SUPABASE_DB_CONTAINER"
coupon_database="${SUPABASE_DB_DATABASE:-postgres}"
coupon_user='00000000-0000-4000-8000-000000004879'
coupon_staff='00000000-0000-4000-8000-000000004878'
coupon_prefix="coupon-target-race-$$"
coupon_test_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
coupon_output_root="${COUPON_TARGET_TEST_OUTPUT_DIR:-/tmp}"
mkdir -p "$coupon_output_root"
coupon_logs="$(mktemp -d "${coupon_output_root%/}/coupon-target-race.XXXXXX")"
psql_exec() { docker exec -i "$coupon_container" psql -X -U postgres -d "$coupon_database" -v ON_ERROR_STOP=1 "$@"; }
psql_scalar() { psql_exec -A -t -q -c "$1"; }
cleanup() {
  wait || true
  {
  cat "$coupon_test_dir/helpers/goods_kc_fixture.sql"
  cat <<SQL
delete from private.coupon_first_purchase_claims where user_id='$coupon_user';
delete from private.store_credit_allocations where user_id='$coupon_user';
delete from private.store_credit_checkout_intents where user_id='$coupon_user';
delete from public.store_credit_ledger where user_id='$coupon_user';
delete from private.store_credit_lots where user_id='$coupon_user';
delete from private.store_credit_accounts where user_id='$coupon_user';
delete from public.cart_coupon_selections where user_id='$coupon_user';
delete from public.coupon_redemptions where user_id='$coupon_user';
delete from public.user_coupons where user_id='$coupon_user';
delete from public.order_cancellation_requests where order_id in(select id from public.orders where user_id='$coupon_user');
delete from public.order_shipment_items where order_id in(select id from public.orders where user_id='$coupon_user');
delete from public.order_shipments where order_id in(select id from public.orders where user_id='$coupon_user');
delete from public.order_items where order_id in(select id from public.orders where user_id='$coupon_user');
delete from public.orders where user_id='$coupon_user';
delete from public.cart_items where user_id='$coupon_user';
delete from public.coupons where code in ('TARGET-RACE-ONE','TARGET-RACE-TWO');
select pg_temp.cleanup_goods_kc_fixture('coupon-target-race-one');
select pg_temp.cleanup_goods_kc_fixture('coupon-target-race-two');
delete from public.goods where id in ('coupon-target-race-one','coupon-target-race-two');
delete from public.ips where id='coupon-target-race-ip';
delete from public.audit_log where actor_id in ('$coupon_user','$coupon_staff');
delete from public.profiles where id in ('$coupon_user','$coupon_staff');
delete from auth.users where id in ('$coupon_user','$coupon_staff');
SQL
  } | psql_exec -q
  echo "Logs: $coupon_logs"
}
if [[ "$(psql_scalar "select count(*) from auth.users where id in ('$coupon_user','$coupon_staff')")" != '0' ]] \
  || [[ "$(psql_scalar "select count(*) from public.goods where id in ('coupon-target-race-one','coupon-target-race-two')")" != '0' ]] \
  || [[ "$(psql_scalar "select count(*) from public.coupons where code in ('TARGET-RACE-ONE','TARGET-RACE-TWO')")" != '0' ]]; then
  echo 'Existing fixture identifiers found; refusing to overwrite or clean them.' >&2
  exit 1
fi
trap cleanup EXIT
{
  cat "$coupon_test_dir/helpers/goods_kc_fixture.sql"
  cat <<SQL
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('$coupon_staff','authenticated','authenticated','coupon-target-race-staff@example.test',now(),'{}','{}',now(),now()),
 ('$coupon_user','authenticated','authenticated','coupon-target-race-user@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='coupon-race-'||right(id::text,4)||'@example.test',nickname='coupon_race_'||right(id::text,4),birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),role=case when id='$coupon_staff' then 'staff'::public.user_role else 'user'::public.user_role end where id in ('$coupon_staff','$coupon_user');
insert into public.ips(id,title,vertical_key,published_at) values('coupon-target-race-ip','쿠폰 동시성 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values
 ('coupon-target-race-one','coupon-target-race-ip','쿠폰 동시성 상품1','문구',10000,'ok',20),
 ('coupon-target-race-two','coupon-target-race-ip','쿠폰 동시성 상품2','문구',20000,'ok',20);
select pg_temp.publish_goods_kc_fixture('coupon-target-race-one');
select pg_temp.publish_goods_kc_fixture('coupon-target-race-two');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status,recipient_segment) values
 ('TARGET-RACE-ONE','첫구매1','fixed',1000,0,now()-interval '1 day','active','first_purchase'),
 ('TARGET-RACE-TWO','첫구매2','fixed',1000,0,now()-interval '1 day','active','first_purchase');
select set_config('request.jwt.claim.sub','$coupon_user',false); set role authenticated;
select public.apply_cart_coupon_code('TARGET-RACE-ONE'); reset role;
SQL
} | psql_exec -q >"$coupon_logs/setup" 2>&1

wait_for_sleep() {
  for _ in $(seq 1 100); do
    if [[ "$(psql_scalar "select count(*) from pg_stat_activity where application_name='$coupon_prefix-order' and wait_event='PgSleep'")" == '1' ]]; then return 0; fi
    sleep 0.02
  done
  cat "$coupon_logs/order-a" >&2
  return 1
}

psql_exec -q >"$coupon_logs/order-a" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; set local application_name='$coupon_prefix-order'; select set_config('request.jwt.claim.sub','$coupon_user',true); set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '$coupon_user','coupon-target-race-one',id,1 from public.goods_variants where good_id='coupon-target-race-one' and is_default;
reset role; set local role service_role;
select public.place_order_with_store_credits('$coupon_user','{"recipientName":"쿠폰 동시성","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004878','card',0);
select pg_sleep(1); commit;
SQL
coupon_pid_a=$!
wait_for_sleep
psql_exec -q >"$coupon_logs/order-b" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; select set_config('request.jwt.claim.sub','$coupon_user',true); set local role authenticated;
insert into public.cart_items(user_id,good_id,variant_id,qty) select '$coupon_user','coupon-target-race-one',id,1 from public.goods_variants where good_id='coupon-target-race-one' and is_default;
reset role; set local role service_role;
select public.place_order_with_store_credits('$coupon_user','{"recipientName":"쿠폰 동시성","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004879','card',0); commit;
SQL
coupon_pid_b=$!
psql_exec -q >"$coupon_logs/terms-edit" 2>&1 <<SQL &
begin; set local statement_timeout='10s'; select set_config('request.jwt.claim.sub','$coupon_staff',true); set local role authenticated;
select public.admin_upsert_coupon_targeted(jsonb_build_object(
 'target_code','TARGET-RACE-ONE','target_name','대상 변경','target_discount_type','fixed','target_discount_value',2000,
 'target_max_discount_amount',null,'target_min_subtotal',0,'target_starts_at',now()-interval '1 day','target_ends_at',null,
 'target_issue_limit',null,'target_status','active','target_grade_benefit',null,'target_previous_code','TARGET-RACE-ONE',
 'target_recipient_segment','first_purchase','target_goods_scope','selected_goods','target_good_ids',jsonb_build_array('coupon-target-race-two'),'target_expected_revision',1)); commit;
SQL
coupon_pid_c=$!
wait "$coupon_pid_a"; wait "$coupon_pid_c"
if wait "$coupon_pid_b"; then echo 'Second payable order bypassed first-purchase reservation' >&2; exit 1; fi
if ! rg -q 'coupon_first_purchase_reserved' "$coupon_logs/order-b"; then cat "$coupon_logs/order-b" >&2; exit 1; fi
psql_exec -q <<SQL
select 1/case when (select count(*) from private.coupon_first_purchase_claims where user_id='$coupon_user' and state='reserved')=1
 and (select discount_total from public.orders where checkout_key='10000000-0000-4000-8000-000000004878')=1000
 and (select terms_snapshot->>'goodsScope' from public.coupon_redemptions where user_id='$coupon_user')='all'
 and (select goods_scope from public.coupons where code='TARGET-RACE-ONE')='selected_goods' then 1 else 0 end as first_purchase_and_locked_terms_are_exact;
set role service_role;
select public.request_order_cancellation((select id from public.orders where checkout_key='10000000-0000-4000-8000-000000004878'),'$coupon_user','첫구매 선점 해제','change_of_mind');
reset role; select set_config('request.jwt.claim.sub','$coupon_user',false); set role authenticated;
select public.apply_cart_coupon_code('TARGET-RACE-TWO');
insert into public.cart_items(user_id,good_id,variant_id,qty) select '$coupon_user','coupon-target-race-one',id,1 from public.goods_variants where good_id='coupon-target-race-one' and is_default;
reset role; set role service_role;
select public.place_order_with_store_credits('$coupon_user','{"recipientName":"쿠폰 동시성","phone":"01012345678","postalCode":"12345","address1":"합성 주소"}','10000000-0000-4000-8000-000000004877','card',0);
reset role;
select 1/case when (select count(*) from private.coupon_first_purchase_claims where user_id='$coupon_user' and state='reserved')=1
 and (select count(*) from private.coupon_first_purchase_claims where user_id='$coupon_user' and state='released')=1 then 1 else 0 end as canceled_claim_allows_exactly_one_new_first_benefit;
SQL
echo 'PASS: simultaneous first-purchase checkouts, term edit/order race, cancellation release'

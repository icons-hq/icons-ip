#!/usr/bin/env bash
# Explicitly selected test DB only. No local or hosted connection is inferred.
# Uses committed synthetic fixtures because separate sessions must observe commits;
# the EXIT trap deletes only the identities created by this script.
set -euo pipefail

if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_purchase_policies_concurrency.sh <explicit-test-container> <explicit-test-database> [/absolute/evidence-directory]' >&2
  exit 64
fi
sales_test_container="$1"
sales_test_database="$2"
if [[ -n "${3:-}" ]]; then
  if [[ "$3" != /* ]]; then printf '%s\n' 'Evidence directory must be absolute.' >&2; exit 64; fi
  mkdir -p "$3"
  sales_test_tmp="$(mktemp -d "${3%/}/quota-race.XXXXXX")"
else
  sales_test_tmp="$(mktemp -d /tmp/icons-sales-quota.XXXXXX)"
fi
sales_fixture_created=false
sales_race_pid=''

sales_db() {
  docker exec -i "$sales_test_container" psql -X -q -U postgres -d "$sales_test_database" -v ON_ERROR_STOP=1 "$@"
}
kc_fixture_sql="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
sales_db_with_kc() { { cat "$kc_fixture_sql"; cat; } | sales_db "$@"; }
sales_cleanup() {
  local sales_exit_status=$?
  if [[ -n "$sales_race_pid" ]]; then wait "$sales_race_pid" 2>/dev/null || true; fi
  if [[ "$sales_fixture_created" == true ]]; then
    if ! sales_db_with_kc >"$sales_test_tmp/cleanup.log" 2>&1 <<'SQL'
begin;
delete from public.audit_log where actor_id in ('00000000-0000-4000-8000-000000048401','00000000-0000-4000-8000-000000048402')
 or target='goods:sales-quota-race-4273'
 or target in(select 'order:'||id from public.orders where user_id='00000000-0000-4000-8000-000000048401');
delete from public.notifications where user_id in ('00000000-0000-4000-8000-000000048401','00000000-0000-4000-8000-000000048402');
delete from public.cart_items where user_id='00000000-0000-4000-8000-000000048401';
delete from public.orders where user_id='00000000-0000-4000-8000-000000048401';
delete from private.goods_variant_price_periods where good_id='sales-quota-race-4273';
select pg_temp.cleanup_goods_kc_fixture('sales-quota-race-4273');
delete from public.goods where id='sales-quota-race-4273';
delete from public.ips where id='sales-quota-race-4273';
delete from public.verticals where key='sales-quota-race-4273';
delete from public.fulfillment_origins where id='00000000-0000-4000-8000-000000048430';
delete from auth.users where id in ('00000000-0000-4000-8000-000000048401','00000000-0000-4000-8000-000000048402');
commit;
SQL
    then printf 'Synthetic fixture cleanup failed; see %s/cleanup.log\n' "$sales_test_tmp" >&2; sales_exit_status=1; fi
  fi
  printf 'Evidence preserved: %s\n' "$sales_test_tmp"
  if [[ "$sales_exit_status" != 0 ]]; then
    for sales_log in "$sales_test_tmp"/*.log; do
      if rg --quiet 'ERROR|FATAL' "$sales_log"; then tail -20 "$sales_log" >&2; fi
    done
  fi
  exit "$sales_exit_status"
}
trap sales_cleanup EXIT

sales_db_with_kc >"$sales_test_tmp/setup.log" <<'SQL'
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000048401','authenticated','authenticated','sales-quota-race-buyer@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048402','authenticated','authenticated','sales-quota-race-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='동시 주문 검증',birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id='00000000-0000-4000-8000-000000048401';
update public.profiles set role='staff' where id='00000000-0000-4000-8000-000000048402';
insert into public.verticals(key,label,color) values('sales-quota-race-4273','동시 주문 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('sales-quota-race-4273','동시 주문 검증','sales-quota-race-4273',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('00000000-0000-4000-8000-000000048430','sales-quota-race-4273','동시 검증 출고지','hanjin',3000,'배송 금지 검증 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at,origin_id,
 image_path,notice_maker,notice_origin,notice_material,notice_size,notice_made_on,notice_as_manager,notice_as_contact,
 order_quantity_limit_enabled,min_order_qty,max_order_qty,member_purchase_limit_enabled,member_lifetime_qty_limit)
 values('sales-quota-race-4273','sales-quota-race-4273','동시 주문 검증','문구',10000,'ok',10,null,
 '00000000-0000-4000-8000-000000048430','public-media/sales-quota-race-fixture.webp',
 '제조사','한국','종이','A5','2026-09','CS','02-000',true,1,5,true,3);
select pg_temp.publish_goods_kc_fixture('sales-quota-race-4273');
commit;
SQL
sales_fixture_created=true

sales_wait_marker() {
  local sales_log="$1" sales_marker="$2"
  for ((sales_attempt=0;sales_attempt<100;sales_attempt++)); do
    if rg --quiet "$sales_marker" "$sales_log"; then return 0; fi
    sleep 0.1
  done
  cat "$sales_log" >&2
  printf 'Missing test marker: %s\n' "$sales_marker" >&2
  return 1
}

# Session B begins place_order before A commits, so its outer statement predates
# A's reservation. A repopulates the same cart inside its transaction solely to
# test that B takes a fresh post-lock view of both the cart and historical quantity.
sales_db >"$sales_test_tmp/member-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048401',true);
select public.set_cart_item_quantity('sales-quota-race-4273',(select id from public.goods_variants where good_id='sales-quota-race-4273' and is_default),2);
select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048420'::uuid,'card'::public.order_payment_method);
select public.set_cart_item_quantity('sales-quota-race-4273',(select id from public.goods_variants where good_id='sales-quota-race-4273' and is_default),2);
\echo SALES_MEMBER_A_RESERVED
select pg_sleep(3);
commit;
SQL
sales_race_pid=$!
sales_wait_marker "$sales_test_tmp/member-a.log" SALES_MEMBER_A_RESERVED
if sales_db >"$sales_test_tmp/member-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048401',true);
select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048421'::uuid,'card'::public.order_payment_method);
commit;
SQL
then cat "$sales_test_tmp/member-b.log" >&2; printf '%s\n' 'Member quota was exceeded by the second session' >&2; exit 1; fi
wait "$sales_race_pid"; sales_race_pid=''
rg --quiet 'member_purchase_limit_exceeded' "$sales_test_tmp/member-b.log"
sales_db <<'SQL'
select 1/case when (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000048401')=1
 and private.member_goods_reserved_qty('00000000-0000-4000-8000-000000048401','sales-quota-race-4273')=2
 and (select stock_qty from public.goods_variants where good_id='sales-quota-race-4273' and is_default)=8
 then 1 else 0 end as assert_waiting_order_observes_first_reservation;
SQL

# Cancellation restores under its existing order->goods locks. A concurrent new
# order must see the committed cancellation after waiting for the same goods row.
sales_db >"$sales_test_tmp/cancel-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048402',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048420'),
 '합성 미결제 취소','{}');
\echo SALES_CANCELED_UNCOMMITTED
select pg_sleep(3);
commit;
SQL
sales_race_pid=$!
sales_wait_marker "$sales_test_tmp/cancel-a.log" SALES_CANCELED_UNCOMMITTED
sales_db >"$sales_test_tmp/cancel-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048401',true);
select public.place_order('{"recipientName":"검증 구매자","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048422'::uuid,'card'::public.order_payment_method);
commit;
SQL
wait "$sales_race_pid"; sales_race_pid=''
sales_db <<'SQL'
select 1/case when (select count(*) from public.orders where user_id='00000000-0000-4000-8000-000000048401')=2
 and private.member_goods_reserved_qty('00000000-0000-4000-8000-000000048401','sales-quota-race-4273')=2
 and (select stock_qty from public.goods_variants where good_id='sales-quota-race-4273' and is_default)=8
 then 1 else 0 end as assert_cancel_order_race_preserves_quota_and_stock;
SQL

# Two retries of the whole-order cancellation release the same quantity once.
sales_db >"$sales_test_tmp/release-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048402',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048422'),
 '합성 미결제 취소','{}');
\echo SALES_RELEASE_A
select pg_sleep(3);
commit;
SQL
sales_race_pid=$!
sales_wait_marker "$sales_test_tmp/release-a.log" SALES_RELEASE_A
sales_db >"$sales_test_tmp/release-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048402',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048422'),
 '합성 미결제 취소','{}');
commit;
SQL
wait "$sales_race_pid"; sales_race_pid=''
sales_db <<'SQL'
select 1/case when private.member_goods_reserved_qty('00000000-0000-4000-8000-000000048401','sales-quota-race-4273')=0
 and (select stock_qty from public.goods_variants where good_id='sales-quota-race-4273' and is_default)=10
 then 1 else 0 end as assert_concurrent_cancel_retries_release_once;
SQL

# A base-price update which began before activation committed must not invalidate
# the offer's regular-price evidence after waiting for its option lock.
sales_db >"$sales_test_tmp/price-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048402',true);
select public.admin_save_goods_price_period('sales-quota-race-4273',(select id from public.goods_variants where good_id='sales-quota-race-4273' and is_default),null,
 jsonb_build_object('state','active','discountPrice',8000,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour'));
\echo SALES_PRICE_A
select pg_sleep(3);
commit;
SQL
sales_race_pid=$!
sales_wait_marker "$sales_test_tmp/price-a.log" SALES_PRICE_A
if sales_db >"$sales_test_tmp/price-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
update public.goods_variants set price=11000 where good_id='sales-quota-race-4273' and is_default;
commit;
SQL
then cat "$sales_test_tmp/price-b.log" >&2; printf '%s\n' 'Concurrent base-price update invalidated the active offer' >&2; exit 1; fi
wait "$sales_race_pid"; sales_race_pid=''
rg --quiet 'active_price_period_requires_reset' "$sales_test_tmp/price-b.log"
sales_db <<'SQL'
select 1/case when (select price from public.goods_variants where good_id='sales-quota-race-4273' and is_default)=10000
 and (select count(*) from private.goods_variant_price_periods where good_id='sales-quota-race-4273' and state='active')=1
 then 1 else 0 end as assert_concurrent_price_change_is_rejected;
SQL
printf '%s\n' 'PASS: member quota, cancellation/order race, duplicate cancellation, and price activation race.'

#!/usr/bin/env bash
# Explicitly targeted test database only. Public RPCs exercise all business operations.
# Cleanup uses the existing migration owner solely to remove these committed
# synthetic records; it never changes a function grant or a global policy.
set -euo pipefail
if [[ $# -lt 2 || $# -gt 3 || ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ || ! "$2" =~ ^[A-Za-z_][A-Za-z0-9_-]*$ ]]; then
  printf '%s\n' 'Usage: bash supabase/tests/goods_preorders_concurrency.sh <explicit-test-container> <explicit-test-database> [/absolute/evidence-directory]' >&2
  exit 64
fi
preorder_container="$1"
preorder_database="$2"
if [[ -n "${3:-}" ]]; then
  if [[ "$3" != /* ]]; then printf '%s\n' 'Evidence directory must be absolute.' >&2; exit 64; fi
  mkdir -p "$3"
  preorder_logs="$(mktemp -d "${3%/}/preorder-race.XXXXXX")"
else
  preorder_logs="$(mktemp -d /tmp/icons-preorder.XXXXXX)"
fi
preorder_fixture_created=false
preorder_race_pid=''
preorder_kc_helper="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"
preorder_db() { docker exec -i "$preorder_container" psql -X -q -U postgres -d "$preorder_database" -v ON_ERROR_STOP=1 "$@"; }
preorder_owner_db() { docker exec -i "$preorder_container" psql -X -q -U supabase_admin -d "$preorder_database" -v ON_ERROR_STOP=1 "$@"; }
preorder_db_with_kc() { { cat "$preorder_kc_helper"; cat; } | preorder_db "$@"; }
preorder_owner_with_kc() { { cat "$preorder_kc_helper"; cat; } | preorder_owner_db "$@"; }
preorder_cleanup() {
  local preorder_exit=$?
  if [[ -n "$preorder_race_pid" ]]; then wait "$preorder_race_pid" 2>/dev/null || true; fi
  if [[ "$preorder_fixture_created" == true ]]; then
    if ! preorder_owner_with_kc >"$preorder_logs/cleanup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
do $$ begin
  if exists(select 1 from private.goods_preorder_policies policy join public.goods_variants variant on variant.id=policy.variant_id
    where variant.good_id in ('preorder-race-capacity-4273','preorder-race-allocation-4273')
      and coalesce(policy.approval_reference,'') not like 'TEST-ONLY:preorder-race:%') then
    raise exception 'Refusing to remove non-synthetic preorder evidence';
  end if;
end $$;
delete from private.order_shipment_promise_changes where shipment_id in(select shipment.id from public.order_shipments shipment
 join public.orders purchase on purchase.id=shipment.order_id where purchase.user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602'));
delete from private.goods_preorder_reservations where order_id in(select id from public.orders
 where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602'));
delete from private.payment_provider_evidence where payment_attempt_id in(select id from public.payment_attempts
 where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602'));
delete from public.refunds where payment_id in(select id from public.payments
 where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602'));
delete from public.payment_attempts where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from public.payments where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from public.draw_tickets where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from private.store_credit_allocations where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from private.store_credit_checkout_intents where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from public.store_credit_ledger where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from private.store_credit_lots where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from private.store_credit_accounts where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from public.audit_log where actor_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602','00000000-0000-4000-8000-000000048603','00000000-0000-4000-8000-000000048604')
 or target in ('goods:preorder-race-capacity-4273','goods:preorder-race-allocation-4273')
 or target in(select 'order:'||id from public.orders where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602'));
delete from public.notifications where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602','00000000-0000-4000-8000-000000048603','00000000-0000-4000-8000-000000048604');
delete from public.cart_items where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
delete from public.orders where user_id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
update public.goods_variants set preorder_policy_id=null where good_id in ('preorder-race-capacity-4273','preorder-race-allocation-4273');
delete from private.goods_preorder_policies where variant_id in(select id from public.goods_variants
 where good_id in ('preorder-race-capacity-4273','preorder-race-allocation-4273'));
select pg_temp.cleanup_goods_kc_fixture('preorder-race-capacity-4273');
select pg_temp.cleanup_goods_kc_fixture('preorder-race-allocation-4273');
delete from public.goods where id in ('preorder-race-capacity-4273','preorder-race-allocation-4273');
delete from public.ips where id='preorder-race-4273';
delete from public.verticals where key='preorder-race-4273';
delete from public.fulfillment_origins where id='00000000-0000-4000-8000-000000048630';
delete from auth.users where id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602','00000000-0000-4000-8000-000000048603','00000000-0000-4000-8000-000000048604');
commit;
SQL
    then preorder_exit=1; printf 'Owned fixture cleanup failed: %s/cleanup.log\n' "$preorder_logs" >&2; fi
  fi
  printf 'Evidence preserved: %s\n' "$preorder_logs"
  if [[ "$preorder_exit" != 0 ]]; then
    for preorder_log in "$preorder_logs"/*.log; do
      if rg --quiet 'ERROR|FATAL' "$preorder_log"; then tail -24 "$preorder_log" >&2; fi
    done
  fi
  exit "$preorder_exit"
}
trap preorder_cleanup EXIT

preorder_db_with_kc >"$preorder_logs/setup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
select set_config('request.jwt.claim.sub','',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('00000000-0000-4000-8000-000000048601','authenticated','authenticated','preorder-race-first@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048602','authenticated','authenticated','preorder-race-second@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048603','authenticated','authenticated','preorder-race-admin@example.test',now(),'{}','{}',now(),now()),
 ('00000000-0000-4000-8000-000000048604','authenticated','authenticated','preorder-race-staff@example.test',now(),'{}','{}',now(),now());
update public.profiles set nickname='예약경쟁'||right(id::text,4),birth_date='2000-01-01',onboarded_at=now(),consents='{"terms":true,"privacy":true}'
 where id in ('00000000-0000-4000-8000-000000048601','00000000-0000-4000-8000-000000048602');
update public.profiles set role='admin',nickname='예약경쟁관리8603' where id='00000000-0000-4000-8000-000000048603';
update public.profiles set role='staff',nickname='예약경쟁운영8604' where id='00000000-0000-4000-8000-000000048604';
insert into public.verticals(key,label,color) values('preorder-race-4273','예약 경쟁 검증','#000000');
insert into public.ips(id,title,vertical_key,published_at) values('preorder-race-4273','예약 경쟁 검증','preorder-race-4273',now());
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('00000000-0000-4000-8000-000000048630','preorder-race-4273','합성 예약 출고지','hanjin',3000,'배송 금지 검증 주소',true);
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048603',true);
select public.admin_save_good('{"id":"preorder-race-capacity-4273","ip_id":"preorder-race-4273","name":"승인 잔량 경쟁","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PREORDER-RACE-CAP","attributes":{},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_good('{"id":"preorder-race-allocation-4273","ip_id":"preorder-race-4273","name":"할당 취소 경쟁","price":10000,
 "variant_baseline":[],"variants":[{"name":"기본 옵션","code":"PREORDER-RACE-ALLOC","attributes":{},"extraPrice":0,"stockQty":0}]}');
select public.admin_save_goods_preorder('preorder-race-capacity-4273',(select id from public.goods_variants where good_id='preorder-race-capacity-4273' and is_default),null,
 jsonb_build_object('state','active','capacityQty',3,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
 'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY:preorder-race:capacity'));
select public.admin_save_goods_preorder('preorder-race-allocation-4273',(select id from public.goods_variants where good_id='preorder-race-allocation-4273' and is_default),null,
 jsonb_build_object('state','active','capacityQty',4,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour',
 'expectedShipDate',(now() at time zone 'Asia/Seoul')::date+7,'approvalReference','TEST-ONLY:preorder-race:allocation'));
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.goods set type='문구',image_path='public-media/preorder-race-fixture.webp',notice_maker='제조사',notice_origin='한국',notice_material='종이',
 notice_size='A5',notice_made_on='2026-09',notice_as_manager='CS',notice_as_contact='02-000',origin_id='00000000-0000-4000-8000-000000048630'
 where id in ('preorder-race-capacity-4273','preorder-race-allocation-4273');
select pg_temp.publish_goods_kc_fixture('preorder-race-capacity-4273');
select pg_temp.publish_goods_kc_fixture('preorder-race-allocation-4273');
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048601',true);
select public.set_cart_item_quantity('preorder-race-capacity-4273',(select id from public.goods_variants where good_id='preorder-race-capacity-4273' and is_default),2);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048602',true);
select public.set_cart_item_quantity('preorder-race-capacity-4273',(select id from public.goods_variants where good_id='preorder-race-capacity-4273' and is_default),2);
commit;
SQL
preorder_fixture_created=true

preorder_wait_marker() {
  local preorder_log="$1" preorder_marker="$2"
  for ((preorder_poll=0;preorder_poll<100;preorder_poll++)); do
    if rg --quiet "$preorder_marker" "$preorder_log"; then return 0; fi
    sleep 0.1
  done
  cat "$preorder_log" >&2
  printf 'Missing marker: %s\n' "$preorder_marker" >&2
  return 1
}

# Two different members contend for capacity 3 with quantity 2 each. The waiting
# order starts before the first reservation commits and must still see it.
preorder_db >"$preorder_logs/capacity-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048601',true);
select public.place_order('{"recipientName":"예약 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048620'::uuid,'card'::public.order_payment_method);
\echo PREORDER_CAPACITY_RESERVED
select pg_sleep(3);
commit;
SQL
preorder_race_pid=$!
preorder_wait_marker "$preorder_logs/capacity-a.log" PREORDER_CAPACITY_RESERVED
if preorder_db >"$preorder_logs/capacity-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048602',true);
select public.place_order('{"recipientName":"예약 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048621'::uuid,'card'::public.order_payment_method);
commit;
SQL
then printf '%s\n' 'Second member exceeded approved capacity' >&2; exit 1; fi
wait "$preorder_race_pid"; preorder_race_pid=''
rg --quiet 'preorder_capacity_exceeded' "$preorder_logs/capacity-b.log"
preorder_db >>"$preorder_logs/assertions.log" <<'SQL'
select 1/case when (select count(*) from public.orders where checkout_key in ('00000000-0000-4000-8000-000000048620','00000000-0000-4000-8000-000000048621'))=1
 and (select private.goods_preorder_remaining(preorder_policy_id) from public.goods_variants where good_id='preorder-race-capacity-4273')=1
 and (select stock_qty from public.goods_variants where good_id='preorder-race-capacity-4273')=0
 then 1 else 0 end as assert_capacity_race_preserves_physical_zero;
SQL

# A cancellation commits while the waiting member's new checkout is in flight.
preorder_db >"$preorder_logs/cancel-reserve-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048620'),'TEST-ONLY 미입고 경쟁 취소','{}');
\echo PREORDER_CAPACITY_RELEASED
select pg_sleep(3);
commit;
SQL
preorder_race_pid=$!
preorder_wait_marker "$preorder_logs/cancel-reserve-a.log" PREORDER_CAPACITY_RELEASED
preorder_db >"$preorder_logs/cancel-reserve-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048602',true);
select public.place_order('{"recipientName":"예약 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048622'::uuid,'card'::public.order_payment_method);
commit;
SQL
wait "$preorder_race_pid"; preorder_race_pid=''
preorder_db >>"$preorder_logs/assertions.log" <<'SQL'
select 1/case when (select status from public.orders where checkout_key='00000000-0000-4000-8000-000000048620')='canceled'
 and (select status from public.orders where checkout_key='00000000-0000-4000-8000-000000048622')='pending'
 and (select private.goods_preorder_remaining(preorder_policy_id) from public.goods_variants where good_id='preorder-race-capacity-4273')=1
 and (select stock_qty from public.goods_variants where good_id='preorder-race-capacity-4273')=0
 then 1 else 0 end as assert_cancellation_and_new_reservation_serialize;
SQL

# Two paid orders, each quantity 2, share a real receipt of 4 units. Neither test
# fabricates a payment callback: trusted SQL drives the existing claim/finalizer
# with explicit synthetic provider evidence, as in the payment-seam SQL suite.
preorder_db >"$preorder_logs/receipt-setup.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='20s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048601',true);
select public.set_cart_item_quantity('preorder-race-allocation-4273',(select id from public.goods_variants where good_id='preorder-race-allocation-4273'),2);
select public.place_order('{"recipientName":"할당 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048623'::uuid,'card'::public.order_payment_method);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048602',true);
select public.set_cart_item_quantity('preorder-race-allocation-4273',(select id from public.goods_variants where good_id='preorder-race-allocation-4273'),2);
select public.place_order('{"recipientName":"할당 경쟁","phone":"01012345678","postalCode":"00000","address1":"배송 금지 검증 주소"}'::jsonb,
 '00000000-0000-4000-8000-000000048624'::uuid,'card'::public.order_payment_method);
reset role;
do $$ declare purchase public.orders; attempt public.payment_attempts; claim_id uuid; provider_key text; begin
  for purchase in select * from public.orders where checkout_key in ('00000000-0000-4000-8000-000000048623','00000000-0000-4000-8000-000000048624') order by checkout_key loop
    claim_id:=case when purchase.checkout_key='00000000-0000-4000-8000-000000048623' then '00000000-0000-4000-8000-000000048640'::uuid else '00000000-0000-4000-8000-000000048641'::uuid end;
    provider_key:=case when purchase.checkout_key='00000000-0000-4000-8000-000000048623' then 'TEST-PREORDER-RACE-ALLOCATE-FIRST' else 'TEST-PREORDER-RACE-CANCEL-FIRST' end;
    perform public.prepare_goods_payment_attempt(purchase.user_id,purchase.id,'toss');
    select * into attempt from public.payment_attempts where ref_id=purchase.id order by created_at desc limit 1;
    perform public.bind_goods_payment_callback_nonce(attempt.id,repeat('b',64));
    perform public.claim_goods_payment_attempt('toss',attempt.provider_order_id,repeat('b',64),claim_id);
    if public.finalize_goods_payment_attempt(attempt.id,claim_id,'approved',null,provider_key)<>'approved' then raise exception 'synthetic payment must approve'; end if;
  end loop;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.admin_adjust_stock('00000000-0000-4000-8000-000000048650','preorder-race-allocation-4273',
 (select id from public.goods_variants where good_id='preorder-race-allocation-4273'),0,4,'TEST-ONLY 실입고 4개');
commit;
SQL

preorder_db >"$preorder_logs/allocate-first-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.admin_allocate_goods_preorders('preorder-race-allocation-4273',array[(select item.id from public.order_items item join public.orders purchase on purchase.id=item.order_id
 where purchase.checkout_key='00000000-0000-4000-8000-000000048623')],jsonb_build_object((select id::text from public.goods_variants where good_id='preorder-race-allocation-4273'),4),'TEST-ONLY:preorder-race:receipt-4');
\echo PREORDER_ALLOCATED_UNCOMMITTED
select pg_sleep(3);
commit;
SQL
preorder_race_pid=$!
preorder_wait_marker "$preorder_logs/allocate-first-a.log" PREORDER_ALLOCATED_UNCOMMITTED
preorder_db >"$preorder_logs/allocate-first-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048623'),
 'TEST-ONLY 할당 후 경쟁 환불',array['TEST-PREORDER-RACE-ALLOCATE-FIRST']);
commit;
SQL
wait "$preorder_race_pid"; preorder_race_pid=''
preorder_db >>"$preorder_logs/assertions.log" <<'SQL'
select 1/case when (select stock_qty from public.goods_variants where good_id='preorder-race-allocation-4273')=4
 and exists(select 1 from private.goods_preorder_reservations reservation join public.orders purchase on purchase.id=reservation.order_id
   where purchase.checkout_key='00000000-0000-4000-8000-000000048623' and reservation.state='returned')
 and (select private.goods_preorder_remaining(preorder_policy_id) from public.goods_variants where good_id='preorder-race-allocation-4273')=0
 then 1 else 0 end as assert_allocate_first_returns_only_physical_stock;
SQL

preorder_db >"$preorder_logs/cancel-first-a.log" 2>&1 <<'SQL' &
begin;
set local statement_timeout='15s';
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.finalize_order_cancellation_with_provider_evidence((select id from public.orders where checkout_key='00000000-0000-4000-8000-000000048624'),
 'TEST-ONLY 할당 전 경쟁 환불',array['TEST-PREORDER-RACE-CANCEL-FIRST']);
\echo PREORDER_CANCELED_UNCOMMITTED
select pg_sleep(3);
commit;
SQL
preorder_race_pid=$!
preorder_wait_marker "$preorder_logs/cancel-first-a.log" PREORDER_CANCELED_UNCOMMITTED
if preorder_db >"$preorder_logs/cancel-first-b.log" 2>&1 <<'SQL'
begin;
set local statement_timeout='15s';
set local role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000048604',true);
select public.admin_allocate_goods_preorders('preorder-race-allocation-4273',array[(select item.id from public.order_items item join public.orders purchase on purchase.id=item.order_id
 where purchase.checkout_key='00000000-0000-4000-8000-000000048624')],jsonb_build_object((select id::text from public.goods_variants where good_id='preorder-race-allocation-4273'),4),'TEST-ONLY:preorder-race:late-allocation');
commit;
SQL
then printf '%s\n' 'Allocation accepted an already canceled reservation' >&2; exit 1; fi
wait "$preorder_race_pid"; preorder_race_pid=''
rg --quiet 'preorder_reservation_released|preorder_payment_required' "$preorder_logs/cancel-first-b.log"
preorder_db >>"$preorder_logs/assertions.log" <<'SQL'
select 1/case when (select stock_qty from public.goods_variants where good_id='preorder-race-allocation-4273')=4
 and exists(select 1 from private.goods_preorder_reservations reservation join public.orders purchase on purchase.id=reservation.order_id
   where purchase.checkout_key='00000000-0000-4000-8000-000000048624' and reservation.state='released')
 and (select private.goods_preorder_remaining(preorder_policy_id) from public.goods_variants where good_id='preorder-race-allocation-4273')=2
 then 1 else 0 end as assert_cancel_first_never_consumes_physical_stock;
SQL
printf '%s\n' 'PASS: member capacity race, cancel/new reservation, allocate-before-cancel, and cancel-before-allocate.'

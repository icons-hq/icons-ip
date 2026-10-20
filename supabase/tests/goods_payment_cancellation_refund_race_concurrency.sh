#!/usr/bin/env bash
set -euo pipefail

# 2026-10-12 audit DB-2 + declined race. A buyer cancellation accepted while the
# Toss confirm is in flight must converge for every commit order:
#   A. request first, then confirm DONE  → paid ledger + auto-approved refund intent,
#      order stays pending; then two concurrent completions finalize exactly once
#   B. confirm DONE first, then request  → ordinary paid auto-approval
#   C. request first, then confirm decline → request closes without payment
#   D. a pre-migration stuck row (declined attempt + requested request) is closed
#      by the expiry sweep
#   E. request first, then confirm canceled (payment window abandoned or a full
#      provider cancel) → closes without payment and does not claim the payment
#      was never approved
# Every path restores stock, the coupon and the reserved store credit exactly once.
#
# Only this script's synthetic rows and application_name-tagged backends are
# touched. pg_cron runs expire_stale_checkouts() every minute; nothing here
# asserts a sweep return count, only the final converged state.

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="goods-cancel-refund-race-$$"
buyer='00000000-0000-4000-8000-000000011c01'
admin='00000000-0000-4000-8000-000000011c02'
good='goods-cancel-refund-race-good'
ip_id='goods-cancel-refund-race-ip'
address='{"recipientName":"경합검증","phone":"01012345678","postalCode":"12345","address1":"합성주소"}'
log_root="$(mktemp -d "${TMPDIR:-/tmp}/goods-cancel-refund-race.XXXXXX")"
kc_fixture_sql="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/helpers/goods_kc_fixture.sql"

psql_exec() { docker exec -i "$db_container" psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"; }
psql_scalar() { psql_exec -A -t -q -c "$1"; }
psql_exec_with_kc() { { cat "$kc_fixture_sql"; cat; } | psql_exec "$@"; }

policy_before="$(psql_scalar 'select to_jsonb(p) from private.store_credit_policy p where singleton')"

terminate_test_backends() {
  psql_exec -q >/dev/null 2>&1 <<SQL || true
select pg_catalog.pg_terminate_backend(pid)
from pg_catalog.pg_stat_activity
where application_name like '${test_prefix}-%'
  and pid <> pg_catalog.pg_backend_pid();
SQL
}

cleanup() {
  set +e
  wait 2>/dev/null
  terminate_test_backends
  psql_exec_with_kc -q -v original_policy="$policy_before" >/dev/null 2>&1 <<SQL
delete from public.notifications where user_id='$buyer';
delete from public.audit_log where target in (select 'order:'||id from public.orders where user_id='$buyer') or actor_id in ('$buyer','$admin');
delete from public.refunds where payment_id in (select id from public.payments where user_id='$buyer');
delete from public.order_cancellation_claims where order_id in (select id from public.orders where user_id='$buyer');
delete from public.order_cancellation_requests where order_id in (select id from public.orders where user_id='$buyer');
delete from private.payment_provider_evidence where payment_attempt_id in (select id from public.payment_attempts where user_id='$buyer');
delete from public.payment_attempts where user_id='$buyer';
delete from public.payments where user_id='$buyer';
delete from public.coupon_redemptions where order_id in (select id from public.orders where user_id='$buyer');
delete from public.cart_coupon_selections where user_id='$buyer';
delete from public.user_coupons where user_id='$buyer';
delete from public.coupons where code like 'RACE-REFUND-%';
delete from private.store_credit_allocations where user_id='$buyer';
delete from private.store_credit_checkout_intents where user_id='$buyer';
delete from public.store_credit_ledger where user_id='$buyer';
delete from private.store_credit_lots where user_id='$buyer';
delete from private.store_credit_accounts where user_id='$buyer';
delete from private.store_credit_operations where actor_id='$admin';
delete from public.order_shipment_items where order_id in (select id from public.orders where user_id='$buyer');
delete from public.order_shipments where order_id in (select id from public.orders where user_id='$buyer');
delete from public.order_items where order_id in (select id from public.orders where user_id='$buyer');
delete from public.orders where user_id='$buyer';
delete from public.cart_items where user_id='$buyer';
select pg_temp.cleanup_goods_kc_fixture('$good');
delete from public.goods where id='$good';
delete from public.ips where id='$ip_id';
delete from public.profiles where id in ('$buyer','$admin');
delete from auth.users where id in ('$buyer','$admin');
update private.store_credit_policy p set (enabled,earn_kind,earn_value,earn_max_per_order,max_balance,validity_days,min_use,max_use,restore_grace_days,refund_earned_credit_mode,evidence,version,updated_at)=
  (select r.enabled,r.earn_kind,r.earn_value,r.earn_max_per_order,r.max_balance,r.validity_days,r.min_use,r.max_use,r.restore_grace_days,r.refund_earned_credit_mode,r.evidence,r.version,r.updated_at
   from jsonb_populate_record(null::private.store_credit_policy,:'original_policy'::jsonb) r) where p.singleton;
SQL
  printf 'Evidence preserved: %s\n' "$log_root"
}
trap cleanup EXIT

wait_for_backend_wait() {
  local application_name="$1" expected="$2" client_pid="$3" log_file="$4" observed=""
  for _ in $(seq 1 200); do
    observed="$(psql_scalar "
      select coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '')
      from pg_catalog.pg_stat_activity where application_name = '${application_name}'")"
    if [[ "$observed" == "${expected}:"* ]]; then return 0; fi
    if ! kill -0 "$client_pid" 2>/dev/null; then
      echo "backend exited before ${expected} wait: ${application_name}" >&2
      sed -n '1,120p' "$log_file" >&2
      return 1
    fi
    sleep 0.05
  done
  echo "timed out waiting for ${expected}: ${application_name} (last=${observed})" >&2
  sed -n '1,120p' "$log_file" >&2
  return 1
}

# Runs $2 in a transaction that parks (pg_sleep) after the statement, then $3 as a
# contender that must wait on that transaction's row lock. Logs land in $1.*.
race() {
  local name="$1" holder_sql="$2" contender_sql="$3"
  local holder_app="${test_prefix}-${name}-holder" contender_app="${test_prefix}-${name}-contender"
  docker exec -e PGAPPNAME="$holder_app" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$log_root/$name.holder" 2>&1 <<SQL &
begin;
set local statement_timeout = '20s';
${holder_sql}
select pg_catalog.pg_sleep(1.5);
commit;
SQL
  local holder_pid=$!
  wait_for_backend_wait "$holder_app" "Timeout" "$holder_pid" "$log_root/$name.holder"
  docker exec -e PGAPPNAME="$contender_app" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$log_root/$name.contender" 2>&1 <<SQL &
set statement_timeout = '20s';
${contender_sql}
SQL
  local contender_pid=$!
  wait_for_backend_wait "$contender_app" "Lock" "$contender_pid" "$log_root/$name.contender"
  wait "$holder_pid"
  wait "$contender_pid"
}

assert_sql() {
  local label="$1" sql="$2"
  if [[ "$(psql_scalar "$sql")" != 't' ]]; then
    echo "FAIL: ${label}" >&2
    exit 1
  fi
}

variant_stock() { psql_scalar "select stock_qty from public.goods_variants where good_id='$good' and is_default"; }
credit_state() {
  psql_scalar "select set_config('request.jwt.claim.sub','$buyer',false);
    select (public.get_my_store_credit_history()->>'available')||'/'||(public.get_my_store_credit_history()->>'reserved');" | tail -1
}

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------
psql_exec_with_kc -q >/dev/null <<SQL
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('$admin','authenticated','authenticated','refund-race-admin@example.test',now(),'{}','{}',now(),now()),
 ('$buyer','authenticated','authenticated','refund-race-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='refund-race-'||right(id::text,4)||'@example.test',nickname='refund_race_'||right(id::text,4),
  birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),
  role=case when id='$admin' then 'admin'::public.user_role else 'user'::public.user_role end
where id in ('$admin','$buyer');
update private.store_credit_policy set enabled=true,earn_kind='rate_bps',earn_value=0,earn_max_per_order=0,max_balance=100000,
  validity_days=30,min_use=100,max_use=10000,restore_grace_days=3,refund_earned_credit_mode='offset_future_credits',
  evidence='synthetic cancellation race fixture';
insert into public.ips(id,title,vertical_key,published_at) values('$ip_id','취소 경합 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values('$good','$ip_id','취소 경합 합성 굿즈','문구',10000,'ok',20,null);
select pg_temp.publish_goods_kc_fixture('$good');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('RACE-REFUND-A','경합 A','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-REFUND-B','경합 B','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-REFUND-C','경합 C','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-REFUND-D','경합 D','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-REFUND-E','경합 E','fixed',1000,0,now()-interval '1 day','active');
select set_config('request.jwt.claim.sub','$admin',false);
set role authenticated;
select public.admin_adjust_store_credit('70000000-0000-4000-8000-000000011c01','$buyer',4000,now()+interval '20 days','취소 경합 합성 지급',0);
reset role;
SQL

assert_sql 'finalize and expiry sweep stay service-only after redefinition' "
select has_function_privilege('service_role','public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)','execute')
  and not has_function_privilege('authenticated','public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)','execute')
  and not has_function_privilege('anon','public.finalize_goods_payment_attempt(uuid,uuid,public.payment_attempt_state,text,text,text,text,text,text,timestamptz)','execute')
  and has_function_privilege('service_role','public.expire_stale_checkouts()','execute')
  and not has_function_privilege('authenticated','public.expire_stale_checkouts()','execute')
  and not has_function_privilege('anon','public.expire_stale_checkouts()','execute')"

stock_before="$(variant_stock)"
credits_before="$(credit_state)"
if [[ "$credits_before" != '4000/0' ]]; then echo "unexpected starting credit state: $credits_before" >&2; exit 1; fi

# Places a real pending card order (stock, coupon and 1,000 store credit held),
# then prepares, binds and claims its Toss attempt so it is confirming.
# Prints: order_id attempt_id claim_token
open_confirming_order() {
  local tag="$1" checkout_key="$2" claim_token="$3" coupon_code="$4" digest
  digest="$(printf "${tag}%.0s" {1..64})"
  psql_exec -q -A -t <<SQL | tail -1
select set_config('request.jwt.claim.sub','$buyer',false);
set role authenticated;
select public.apply_cart_coupon_code('${coupon_code}');
select public.set_cart_item_quantity('$good',(select id from public.goods_variants where good_id='$good' and is_default),1);
select user_coupon_id as coupon_id from public.cart_coupon_selections where user_id='$buyer' \gset
reset role;
set role service_role;
select public.place_order_with_store_credits('$buyer','$address','$checkout_key','card',1000,:'coupon_id') as order_id \gset
select public.prepare_goods_payment_attempt('$buyer', :'order_id', 'toss');
reset role;
select public.bind_goods_payment_callback_nonce((select id from public.payment_attempts where ref_id=:'order_id'::uuid), '$digest');
select public.claim_goods_payment_attempt('toss',
  (select provider_order_id from public.payment_attempts where ref_id=:'order_id'::uuid), '$digest', '$claim_token');
select :'order_id' || ' ' || (select id from public.payment_attempts where ref_id=:'order_id'::uuid) || ' $claim_token';
SQL
}

# ---------------------------------------------------------------------------
# A. Request wins, then confirm DONE. The paid ledger is kept and the request is
#    auto-approved into a refund intent while the order stays pending.
# ---------------------------------------------------------------------------
read -r order_a attempt_a token_a < <(open_confirming_order a '80000000-0000-4000-8000-000000011c0a' '90000000-0000-4000-8000-000000011c0a' RACE-REFUND-A)
[[ -n "${order_a:-}" && -n "${token_a:-}" ]] || { echo "fixture order a was not created" >&2; exit 1; }
assert_sql 'A attempt is confirming' "select state='confirming' from public.payment_attempts where id='$attempt_a'"

race request-then-approve \
  "select public.request_order_claim('$order_a','$buyer','cancel','사용자 주문 취소','change_of_mind');" \
  "select public.finalize_goods_payment_attempt('$attempt_a','$token_a','approved','race-refund-key-a-$$',null,null,null,'카드','1234-****',now());"
grep -qx 'requested' "$log_root/request-then-approve.holder" || { cat "$log_root/request-then-approve.holder" >&2; exit 1; }
grep -qx 'approved' "$log_root/request-then-approve.contender" || { cat "$log_root/request-then-approve.contender" >&2; exit 1; }

assert_sql 'A approval keeps a paid ledger and a pending order' "
select o.status='pending' and o.expires_at is null
  and a.state='approved' and a.payment_id=p.id
  and p.status='paid' and p.payment_key='race-refund-key-a-$$' and p.provider='toss'
from public.orders o join public.payment_attempts a on a.ref_id=o.id join public.payments p on p.ref_id=o.id and p.purpose='order'
where o.id='$order_a'"
assert_sql 'A request is auto-approved into a refund intent' "
select r.status='processing' and r.stage='processing'
  and exists(select 1 from public.order_cancellation_claims c where c.order_id=r.order_id)
  and (select count(*)=1 from public.refunds f where f.cancellation_request_id=r.id and f.status='requested')
  and (select count(*)=1 from public.audit_log l where l.target='order:$order_a' and l.action='order.claim_auto_approved'
       and l.actor_id is null and l.diff->>'trigger'='payment_approved_during_cancellation')
  and (select count(*)=1 from public.notifications n where n.user_id='$buyer' and n.source_id=r.id::text and n.dedupe_key like 'claim:auto_approved:%')
from public.order_cancellation_requests r where r.order_id='$order_a'"
assert_sql 'A holds stock, coupon and credit until the refund completes' "
select (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}-1
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-A' and u.status='used' and u.used_order_id='$order_a')"
assert_sql 'A replayed finalize returns the terminal state without a second payment' "
select public.finalize_goods_payment_attempt('$attempt_a','$token_a','approved','race-refund-key-a-$$')='approved'
  and (select count(*)=1 from public.payments where ref_id='$order_a')"

# System actor and staff complete concurrently with the same verified key.
race complete-twice \
  "set local role service_role; select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id='$order_a'),array['race-refund-key-a-$$'],null);" \
  "set role service_role; select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id='$order_a'),array['race-refund-key-a-$$'],'$admin');"

assert_sql 'A completes once and restores stock, coupon and credit once' "
select o.status='canceled' and r.status='completed' and p.status='refunded'
  and f.status='done' and f.method='pg_cancel' and f.completed_at is not null
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-A' and u.status='active' and u.used_order_id is null)
  and (select count(*)=1 from public.audit_log l where l.target='order:$order_a' and l.action like '%.order.cancellation_completed')
from public.orders o join public.order_cancellation_requests r on r.order_id=o.id
join public.payments p on p.ref_id=o.id and p.purpose='order' join public.refunds f on f.payment_id=p.id
where o.id='$order_a'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "A did not restore store credit exactly once: $(credit_state)" >&2; exit 1; fi
echo 'PASS=request-wins-approval-becomes-refund-intent-and-completes-once'

# ---------------------------------------------------------------------------
# B. Confirm DONE wins, then the request: ordinary paid auto-approval.
# ---------------------------------------------------------------------------
read -r order_b attempt_b token_b < <(open_confirming_order b '80000000-0000-4000-8000-000000011c0b' '90000000-0000-4000-8000-000000011c0b' RACE-REFUND-B)
[[ -n "${order_b:-}" && -n "${token_b:-}" ]] || { echo "fixture order b was not created" >&2; exit 1; }
race approve-then-request \
  "select public.finalize_goods_payment_attempt('$attempt_b','$token_b','approved','race-refund-key-b-$$',null,null,null,'카드','1234-****',now());" \
  "select public.request_order_claim('$order_b','$buyer','cancel','사용자 주문 취소','change_of_mind');"
grep -qx 'approved' "$log_root/approve-then-request.holder" || { cat "$log_root/approve-then-request.holder" >&2; exit 1; }
grep -qx 'auto_approved' "$log_root/approve-then-request.contender" || { cat "$log_root/approve-then-request.contender" >&2; exit 1; }
assert_sql 'B paid order is auto-approved with one refund intent' "
select o.status='paid' and r.status='processing'
  and (select count(*)=1 from public.refunds f where f.cancellation_request_id=r.id)
from public.orders o join public.order_cancellation_requests r on r.order_id=o.id where o.id='$order_b'"
psql_exec -q >/dev/null <<SQL
set role service_role;
select public.complete_order_cancellation_request((select id from public.order_cancellation_requests where order_id='$order_b'),array['race-refund-key-b-$$'],null);
SQL
assert_sql 'B completes and restores once' "
select o.status='canceled'
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-B' and u.status='active')
from public.orders o where o.id='$order_b'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "B did not restore store credit exactly once: $(credit_state)" >&2; exit 1; fi
echo 'PASS=approval-wins-request-auto-approves-and-completes-once'

# ---------------------------------------------------------------------------
# C. Request wins, then confirm declines: the request closes without payment.
# ---------------------------------------------------------------------------
read -r order_c attempt_c token_c < <(open_confirming_order c '80000000-0000-4000-8000-000000011c0c' '90000000-0000-4000-8000-000000011c0c' RACE-REFUND-C)
[[ -n "${order_c:-}" && -n "${token_c:-}" ]] || { echo "fixture order c was not created" >&2; exit 1; }
race request-then-decline \
  "select public.request_order_claim('$order_c','$buyer','cancel','사용자 주문 취소','change_of_mind');" \
  "select public.finalize_goods_payment_attempt('$attempt_c','$token_c','declined',null,null,null,'REJECT_CARD_COMPANY');"
grep -qx 'requested' "$log_root/request-then-decline.holder" || { cat "$log_root/request-then-decline.holder" >&2; exit 1; }
grep -qx 'declined' "$log_root/request-then-decline.contender" || { cat "$log_root/request-then-decline.contender" >&2; exit 1; }
assert_sql 'C decline completes the request and releases the order' "
select o.status='canceled' and r.status='completed' and a.state='declined'
  and not exists(select 1 from public.payments where ref_id=o.id)
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-C' and u.status='active')
  and (select count(*)=1 from public.audit_log l where l.target='order:$order_c' and l.action='system.order.cancellation_completed'
       and l.actor_id is null and l.diff->>'attemptOutcome'='declined')
  and (select count(*)=1 from public.notifications n where n.user_id='$buyer' and n.source_id=r.id::text
       and n.dedupe_key like 'claim:completed:%' and n.body='결제가 승인되지 않아 결제 없이 주문을 취소했습니다.')
from public.orders o join public.order_cancellation_requests r on r.order_id=o.id join public.payment_attempts a on a.ref_id=o.id
where o.id='$order_c'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "C did not release store credit exactly once: $(credit_state)" >&2; exit 1; fi
assert_sql 'C replayed decline and sweep do not restore again' "
select public.finalize_goods_payment_attempt('$attempt_c','$token_c','declined')='declined'
  and public.expire_stale_checkouts() >= 0
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}"
echo 'PASS=request-wins-decline-closes-request-without-payment'

# ---------------------------------------------------------------------------
# D. A row left by the previous finalizer (declined attempt + requested request)
#    is closed by the expiry sweep instead of being skipped forever.
# ---------------------------------------------------------------------------
read -r order_d attempt_d token_d < <(open_confirming_order d '80000000-0000-4000-8000-000000011c0d' '90000000-0000-4000-8000-000000011c0d' RACE-REFUND-D)
[[ -n "${order_d:-}" && -n "${token_d:-}" ]] || { echo "fixture order d was not created" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
set role service_role;
select public.request_order_claim('$order_d','$buyer','cancel','사용자 주문 취소','change_of_mind');
reset role;
-- Reproduce the pre-migration terminal state directly.
update public.payment_attempts set state='declined', claim_token=null, claim_expires_at=null where id='$attempt_d';
update public.orders set expires_at=now()-interval '10 minutes' where id='$order_d';
SQL
psql_scalar "select public.expire_stale_checkouts()" >/dev/null
assert_sql 'D sweep closes the stuck request and releases once' "
select o.status='canceled' and r.status='completed'
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-D' and u.status='active')
from public.orders o join public.order_cancellation_requests r on r.order_id=o.id where o.id='$order_d'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "D did not release store credit exactly once: $(credit_state)" >&2; exit 1; fi
echo 'PASS=sweep-closes-pre-migration-declined-request'

# ---------------------------------------------------------------------------
# E. Request first, then confirm canceled. canceled covers both an abandoned
#    payment window and a provider-confirmed full cancel of an approved charge,
#    so the buyer notice must not say the payment was never approved.
# ---------------------------------------------------------------------------
read -r order_e attempt_e token_e < <(open_confirming_order e '80000000-0000-4000-8000-000000011c0e' '90000000-0000-4000-8000-000000011c0e' RACE-REFUND-E)
[[ -n "${order_e:-}" && -n "${token_e:-}" ]] || { echo "fixture order e was not created" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
set role service_role;
select public.request_order_claim('$order_e','$buyer','cancel','사용자 주문 취소','change_of_mind');
select public.finalize_goods_payment_attempt('$attempt_e','$token_e','canceled',null,null,null,'PAY_PROCESS_CANCELED');
SQL
assert_sql 'E canceled closes the request without payment and with a neutral notice' "
select o.status='canceled' and r.status='completed' and a.state='canceled'
  and not exists(select 1 from public.payments where ref_id=o.id)
  and (select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
  and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='RACE-REFUND-E' and u.status='active')
  and (select count(*)=1 from public.audit_log l where l.target='order:$order_e' and l.action='system.order.cancellation_completed'
       and l.actor_id is null and l.diff->>'attemptOutcome'='canceled')
  and (select count(*)=1 from public.notifications n where n.user_id='$buyer' and n.source_id=r.id::text
       and n.dedupe_key like 'claim:completed:%' and n.body='결제가 취소되어 주문을 취소했습니다.')
from public.orders o join public.order_cancellation_requests r on r.order_id=o.id join public.payment_attempts a on a.ref_id=o.id
where o.id='$order_e'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "E did not release store credit exactly once: $(credit_state)" >&2; exit 1; fi
echo 'PASS=request-wins-canceled-closes-request-with-neutral-notice'

echo 'PASS: cancellation/confirm races converge and restore stock, coupon and credit once'

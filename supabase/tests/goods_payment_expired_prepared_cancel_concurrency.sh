#!/usr/bin/env bash
set -euo pipefail

# 2026-10-12 browser QA QA-1. A buyer who cancels a pending card order whose
# prepared payment attempt has already passed its TTL gets an immediate
# cancellation: request_order_claim closes the attempt (prepared -> canceled)
# under the order -> attempt locks it already holds, completes the request
# without a payment and releases stock, the coupon and the reserved store credit
# at once instead of waiting for the checkout-expiry sweep.
#
# The callback claim and the cancellation both lock the order first:
#   G. expired attempt, plain cancel → completed at once; a late callback claim
#      returns terminal canceled (no provider confirm)
#   H. a callback that passed its unlocked TTL check waits on the order lock the
#      cancellation holds; the cancellation evaluates after the TTL and closes the
#      attempt; the callback then reads canceled and does not claim
#   I. the callback claims first (attempt confirming) and the TTL passes before
#      the cancellation acquires the order; the cancellation does not touch the
#      confirming attempt and stays requested; a decline then closes it once
#   J. two concurrent cancellations of an expired attempt: one completes, the
#      other waits and reports already_canceled; stock is restored once
#
# Only this script's synthetic rows and application_name-tagged backends are
# touched. Order deadlines stay in the future, so the pg_cron expiry sweep never
# selects these orders.

db_container="${SUPABASE_DB_CONTAINER:-supabase_db_icons-ip}"
test_prefix="exp-prep-cancel-$$"
buyer='00000000-0000-4000-8000-000000011e01'
admin='00000000-0000-4000-8000-000000011e02'
good='goods-expired-prepared-cancel-good'
ip_id='goods-expired-prepared-cancel-ip'
address='{"recipientName":"만료취소","phone":"01012345678","postalCode":"12345","address1":"합성주소"}'
log_root="$(mktemp -d "${TMPDIR:-/tmp}/goods-expired-prepared-cancel.XXXXXX")"
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
delete from public.coupons where code like 'RACE-EXPPREP-%';
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
set local statement_timeout = '30s';
${holder_sql}
select pg_catalog.pg_sleep(1.5);
commit;
SQL
  local holder_pid=$!
  wait_for_backend_wait "$holder_app" "Timeout" "$holder_pid" "$log_root/$name.holder"
  docker exec -e PGAPPNAME="$contender_app" -i "$db_container" \
    psql -X -U postgres -d postgres -v ON_ERROR_STOP=1 -A -t >"$log_root/$name.contender" 2>&1 <<SQL &
set statement_timeout = '30s';
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
 ('$admin','authenticated','authenticated','expired-prepared-admin@example.test',now(),'{}','{}',now(),now()),
 ('$buyer','authenticated','authenticated','expired-prepared-buyer@example.test',now(),'{}','{}',now(),now());
update public.profiles set email='expired-prepared-'||right(id::text,4)||'@example.test',nickname='expired_prepared_'||right(id::text,4),
  birth_date='2000-01-01',consents='{"terms":true,"privacy":true}',onboarded_at=now(),
  role=case when id='$admin' then 'admin'::public.user_role else 'user'::public.user_role end
where id in ('$admin','$buyer');
update private.store_credit_policy set enabled=true,earn_kind='rate_bps',earn_value=0,earn_max_per_order=0,max_balance=100000,
  validity_days=30,min_use=100,max_use=10000,restore_grace_days=3,refund_earned_credit_mode='offset_future_credits',
  evidence='synthetic expired prepared cancellation fixture';
insert into public.ips(id,title,vertical_key,published_at) values('$ip_id','만료 결제 취소 합성 IP','character',now());
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,published_at) values('$good','$ip_id','만료 결제 취소 합성 굿즈','문구',10000,'ok',20,null);
select pg_temp.publish_goods_kc_fixture('$good');
insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,status) values
 ('RACE-EXPPREP-G','만료 G','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-EXPPREP-H','만료 H','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-EXPPREP-I','만료 I','fixed',1000,0,now()-interval '1 day','active'),
 ('RACE-EXPPREP-J','만료 J','fixed',1000,0,now()-interval '1 day','active');
select set_config('request.jwt.claim.sub','$admin',false);
set role authenticated;
select public.admin_adjust_store_credit('70000000-0000-4000-8000-000000011e01','$buyer',4000,now()+interval '20 days','만료 결제 취소 합성 지급',0);
reset role;
SQL

assert_sql 'request_order_claim and the callback claim stay service-only after redefinition' "
select has_function_privilege('service_role','public.request_order_claim(uuid,uuid,text,text,text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.request_order_claim(uuid,uuid,text,text,text,text,text,text)','execute')
  and not has_function_privilege('anon','public.request_order_claim(uuid,uuid,text,text,text,text,text,text)','execute')
  and has_function_privilege('service_role','public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid)','execute')
  and not has_function_privilege('authenticated','public.claim_goods_payment_attempt(public.payment_provider,text,text,uuid)','execute')"

stock_before="$(variant_stock)"
credits_before="$(credit_state)"
if [[ "$credits_before" != '4000/0' ]]; then echo "unexpected starting credit state: $credits_before" >&2; exit 1; fi

# Places a real pending card order (stock, coupon and 1,000 store credit held),
# then prepares and binds its Toss attempt without claiming it.
# Prints: order_id attempt_id provider_order_id
open_prepared_order() {
  local digest_char="$1" checkout_key="$2" coupon_code="$3" digest
  digest="$(printf "${digest_char}%.0s" {1..64})"
  psql_exec -q -A -t <<SQL | tail -1
select set_config('request.jwt.claim.sub','$buyer',false);
set role authenticated;
select public.apply_cart_coupon_code('${coupon_code}');
insert into public.cart_items(user_id,good_id,variant_id,qty)
select '$buyer','$good',id,1 from public.goods_variants where good_id='$good' and is_default;
select user_coupon_id as coupon_id from public.cart_coupon_selections where user_id='$buyer' \gset
reset role;
set role service_role;
select public.place_order_with_store_credits('$buyer','$address','$checkout_key','card',1000,:'coupon_id') as order_id \gset
select public.prepare_goods_payment_attempt('$buyer', :'order_id', 'toss');
reset role;
select public.bind_goods_payment_callback_nonce((select id from public.payment_attempts where ref_id=:'order_id'::uuid), '$digest');
select :'order_id' || ' ' || a.id || ' ' || a.provider_order_id from public.payment_attempts a where a.ref_id=:'order_id'::uuid;
SQL
}

held_state_sql() {
  local order_id="$1" coupon_code="$2"
  echo "(select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}-1
    and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='${coupon_code}' and u.status='used' and u.used_order_id='${order_id}')"
}

released_state_sql() {
  local coupon_code="$1"
  echo "(select stock_qty from public.goods_variants where good_id='$good' and is_default)=${stock_before}
    and exists(select 1 from public.user_coupons u where u.user_id='$buyer' and u.coupon_code='${coupon_code}' and u.status='active' and u.used_order_id is null)"
}

assert_completed_without_payment() {
  local label="$1" order_id="$2" attempt_id="$3" coupon_code="$4"
  assert_sql "$label closes attempt, request and order without payment" "
select o.status='canceled' and a.state='canceled' and a.claim_token is null and a.payment_id is null
  and r.status='completed' and r.stage='completed'
  and not exists(select 1 from public.payments p where p.purpose='order' and p.ref_id=o.id)
  and (select count(*)=1 from public.audit_log l where l.target='order:'||o.id
       and l.action='order.prepared_goods_cancellation_completed' and l.actor_id='$buyer'
       and l.diff->>'attemptId'='$attempt_id' and l.diff->>'outcome'='expired_no_capture')
  and $(released_state_sql "$coupon_code")
from public.orders o join public.payment_attempts a on a.ref_id=o.id
join public.order_cancellation_requests r on r.order_id=o.id
where o.id='$order_id'"
  if [[ "$(credit_state)" != '4000/0' ]]; then echo "$label did not release store credit exactly once: $(credit_state)" >&2; exit 1; fi
}

# ---------------------------------------------------------------------------
# G. Expired attempt, plain cancel: completed at once, late callback not claimed.
# ---------------------------------------------------------------------------
read -r order_g attempt_g provider_order_g < <(open_prepared_order a '80000000-0000-4000-8000-000000011e0a' RACE-EXPPREP-G)
[[ -n "${order_g:-}" && -n "${provider_order_g:-}" ]] || { echo "fixture order g was not created" >&2; exit 1; }
assert_sql 'G holds stock and coupon while prepared' "select $(held_state_sql "$order_g" RACE-EXPPREP-G)"
psql_exec -q >/dev/null <<SQL
update public.payment_attempts set expires_at=pg_catalog.clock_timestamp()-interval '1 minute' where id='$attempt_g';
SQL
result_g="$(psql_scalar "set role service_role; select public.request_order_claim('$order_g','$buyer','cancel','사용자 주문 취소','change_of_mind');" | tail -1)"
[[ "$result_g" == 'completed' ]] || { echo "G expected completed, got: $result_g" >&2; exit 1; }
assert_completed_without_payment G "$order_g" "$attempt_g" RACE-EXPPREP-G
late_g="$(psql_scalar "select public.claim_goods_payment_attempt('toss','$provider_order_g','$(printf 'a%.0s' {1..64})','91000000-0000-4000-8000-000000011e0a')->>'claim_status'")"
[[ "$late_g" == 'terminal' ]] || { echo "G late callback was not terminal: $late_g" >&2; exit 1; }
assert_sql 'G late callback leaves the attempt canceled' "select state='canceled' and claim_token is null from public.payment_attempts where id='$attempt_g'"
echo 'PASS=expired-prepared-cancel-completes-at-once-and-late-callback-is-terminal'

# ---------------------------------------------------------------------------
# H. The callback passed its unlocked TTL check and waits on the order lock; the
#    cancellation evaluates after the TTL, closes the attempt, and the callback
#    then reads canceled instead of claiming.
# ---------------------------------------------------------------------------
read -r order_h attempt_h provider_order_h < <(open_prepared_order b '80000000-0000-4000-8000-000000011e0b' RACE-EXPPREP-H)
[[ -n "${order_h:-}" && -n "${provider_order_h:-}" ]] || { echo "fixture order h was not created" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
update public.payment_attempts set expires_at=pg_catalog.clock_timestamp()+interval '3 seconds' where id='$attempt_h';
SQL
race cancel-across-ttl \
  "select 'locked' from public.orders where id='$order_h' for update;
   select pg_catalog.pg_sleep(4.5);
   select public.request_order_claim('$order_h','$buyer','cancel','사용자 주문 취소','change_of_mind');" \
  "select public.claim_goods_payment_attempt('toss','$provider_order_h','$(printf 'b%.0s' {1..64})','91000000-0000-4000-8000-000000011e0b')->>'claim_status';"
grep -qx 'completed' "$log_root/cancel-across-ttl.holder" || { cat "$log_root/cancel-across-ttl.holder" >&2; exit 1; }
grep -qx 'terminal' "$log_root/cancel-across-ttl.contender" || { cat "$log_root/cancel-across-ttl.contender" >&2; exit 1; }
assert_completed_without_payment H "$order_h" "$attempt_h" RACE-EXPPREP-H
echo 'PASS=waiting-callback-reads-canceled-after-cancellation-closes-expired-attempt'

# ---------------------------------------------------------------------------
# I. The callback claims first; the TTL passes before the cancellation acquires
#    the order. A confirming attempt is never closed by the cancellation.
# ---------------------------------------------------------------------------
read -r order_i attempt_i provider_order_i < <(open_prepared_order c '80000000-0000-4000-8000-000000011e0c' RACE-EXPPREP-I)
[[ -n "${order_i:-}" && -n "${provider_order_i:-}" ]] || { echo "fixture order i was not created" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
update public.payment_attempts set expires_at=pg_catalog.clock_timestamp()+interval '2 seconds' where id='$attempt_i';
SQL
token_i='91000000-0000-4000-8000-000000011e0c'
race claim-then-cancel \
  "select public.claim_goods_payment_attempt('toss','$provider_order_i','$(printf 'c%.0s' {1..64})','$token_i')->>'claim_status';
   select pg_catalog.pg_sleep(1.5);" \
  "select public.request_order_claim('$order_i','$buyer','cancel','사용자 주문 취소','change_of_mind');"
grep -qx 'claimed' "$log_root/claim-then-cancel.holder" || { cat "$log_root/claim-then-cancel.holder" >&2; exit 1; }
grep -qx 'requested' "$log_root/claim-then-cancel.contender" || { cat "$log_root/claim-then-cancel.contender" >&2; exit 1; }
assert_sql 'I keeps the confirming attempt and holds the order' "
select a.state='confirming' and a.claim_token='$token_i' and a.expires_at<=pg_catalog.clock_timestamp()
  and o.status='pending' and r.status='requested'
  and not exists(select 1 from public.audit_log l where l.target='order:'||o.id and l.action='order.prepared_goods_cancellation_completed')
  and (select count(*)=1 from public.notifications n where n.source_id=r.id::text and n.dedupe_key like 'claim:requested:%'
       and n.title='취소 요청이 접수됐어요' and n.body not like '%담당자%')
  and $(held_state_sql "$order_i" RACE-EXPPREP-I)
from public.orders o join public.payment_attempts a on a.ref_id=o.id
join public.order_cancellation_requests r on r.order_id=o.id
where o.id='$order_i'"
psql_exec -q >/dev/null <<SQL
select public.finalize_goods_payment_attempt('$attempt_i','$token_i','declined',null,null,null,'REJECT_CARD_COMPANY');
SQL
assert_sql 'I decline closes the request and releases once' "
select o.status='canceled' and r.status='completed' and a.state='declined'
  and $(released_state_sql RACE-EXPPREP-I)
from public.orders o join public.payment_attempts a on a.ref_id=o.id
join public.order_cancellation_requests r on r.order_id=o.id
where o.id='$order_i'"
if [[ "$(credit_state)" != '4000/0' ]]; then echo "I did not release store credit exactly once: $(credit_state)" >&2; exit 1; fi
echo 'PASS=claimed-attempt-is-not-closed-by-cancellation-after-ttl'

# ---------------------------------------------------------------------------
# J. Two concurrent cancellations of the same expired attempt.
# ---------------------------------------------------------------------------
read -r order_j attempt_j provider_order_j < <(open_prepared_order d '80000000-0000-4000-8000-000000011e0d' RACE-EXPPREP-J)
[[ -n "${order_j:-}" && -n "${provider_order_j:-}" ]] || { echo "fixture order j was not created" >&2; exit 1; }
psql_exec -q >/dev/null <<SQL
update public.payment_attempts set expires_at=pg_catalog.clock_timestamp()-interval '1 minute' where id='$attempt_j';
SQL
race double-cancel \
  "select public.request_order_claim('$order_j','$buyer','cancel','사용자 주문 취소','change_of_mind');" \
  "select public.request_order_claim('$order_j','$buyer','cancel','사용자 주문 취소','change_of_mind');"
grep -qx 'completed' "$log_root/double-cancel.holder" || { cat "$log_root/double-cancel.holder" >&2; exit 1; }
grep -qx 'already_canceled' "$log_root/double-cancel.contender" || { cat "$log_root/double-cancel.contender" >&2; exit 1; }
assert_completed_without_payment J "$order_j" "$attempt_j" RACE-EXPPREP-J
assert_sql 'J left exactly one request' "select count(*)=1 from public.order_cancellation_requests where order_id='$order_j'"
echo 'PASS=double-cancel-of-expired-attempt-completes-once'

echo 'PASS: expired prepared cancellation closes at once and converges with callback claims'

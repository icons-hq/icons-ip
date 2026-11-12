"""Competing confirmation/claim RPCs on a named disposable local database only."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-json', required=True)
args = parser.parse_args()
runtime = json.loads(Path(args.runtime_json).read_text())
assert runtime['projectId'].startswith('icons-ip-full-admin-')
container = runtime['databaseContainerId']
inspection = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert inspection['Name'] == '/supabase_db_' + runtime['projectId'] and inspection['State']['Running']

def sql(statement, expected=()):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=40)
    if result.returncode:
        error = result.stderr.decode()
        if any(word in error for word in expected):
            return 'rejected'
        raise RuntimeError(error[-1600:])
    return result.stdout.decode().strip()

assert sql('select auto_enabled from private.purchase_confirmation_policy where singleton') == 't'
prefix = uuid.uuid4().hex[:8]
source = Path('supabase/tests/purchase_confirmation.sql').read_text().split('-- Rollback-only baseline')[0]
source = source.replace('bb160000', prefix).replace('purchase-confirm', 'confirmation-race-' + prefix).replace('confirmation-kc', 'confirmation-kc-' + prefix).replace('TEST 구매확정 SQL ', 'TEST ' + prefix + ' ')
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text() + source + '\n' + '\n'.join(f'select pg_temp.confirm_order({n});' for n in range(1, 10)) + '\ncommit;')
actor = prefix + '-0000-4000-8000-000000000002'
session = prefix + '-0000-4000-9000-000000000002'
order = lambda n: prefix + '-0000-4001-8000-' + str(n).zfill(12)
claims = json.dumps({'sub': actor, 'role': 'authenticated', 'session_id': session})
def confirm(n, operation):
    return sql("begin;set local lock_timeout='12s';select set_config('request.jwt.claim.sub','%s',true);select set_config('request.jwt.claims','%s',true);set local role authenticated;select public.confirm_my_purchase('%s','confirm',0,'%s','%s','%s',true);commit;" % (actor, claims, order(n), operation, actor, session), ('purchase_confirmation_changed', 'purchase_confirmation_unavailable'))

barrier = threading.Barrier(12)
operation = str(uuid.uuid4())
def duplicate(_):
    barrier.wait(timeout=15)
    return confirm(1, operation)
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    results = list(pool.map(duplicate, range(12)))
assert all(r != 'rejected' for r in results)

# Make only this test's policy snapshots due. The global policy is deliberately
# enabled by browser QA; production and unrelated orders are never modified.
assert sql('select auto_enabled from private.purchase_confirmation_policy where singleton') == 't'
sql("update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second' where order_id::text like '%s-%%' and confirmed_at is null" % prefix)
barrier = threading.Barrier(12)
def auto_or_buyer(index):
    barrier.wait(timeout=15)
    if index < 4:
        return sql('select public.settle_delivered_orders()')
    return confirm(2 + (index - 4) % 4, str(uuid.uuid4()))
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    automatic_results = list(pool.map(auto_or_buyer, range(12)))
sql('select public.settle_delivered_orders()')
# Drain skipped rows after the concurrent calls; an eligible row may have been
# skipped while another worker owned its buyer profile.
# Fresh delivered orders for claim-vs-confirm races; automatic runs are finished.
sql("update private.order_purchase_confirmations set auto_due_at=null where order_id::text like '%s-%%' and confirmed_at is null" % prefix)
# The auto worker may already have confirmed orders 6-9. Post-confirmation claim
# eligibility is intentional; use another group for the competing transition.
source2 = source[source.index('create function pg_temp.confirm_order'):]
sql('begin;\n' + source2 + '\n' + '\n'.join(f'select pg_temp.confirm_order({n});' for n in range(10, 14)) + '\ncommit;')
barrier = threading.Barrier(8)
def claim_or_confirm(index):
    barrier.wait(timeout=15)
    n = 10 + index % 4
    if index < 4:
        return sql("begin;set local lock_timeout='12s';set local role service_role;select public.request_order_claim('%s','%s','return','TEST race return','change_of_mind');commit;" % (order(n), actor))
    return confirm(n, str(uuid.uuid4()))
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    claim_results = list(pool.map(claim_or_confirm, range(8)))
readback = json.loads(sql("select jsonb_build_object('done',count(*) filter(where status='done'),'orders',count(*),'duplicateGrants',(select count(*) from (select order_id from public.store_credit_ledger where order_id::text like '%s-%%' and kind='grant' group by order_id having count(*)>1)x),'duplicateConfirmEvents',(select count(*) from (select order_id from private.purchase_confirmation_events where order_id::text like '%s-%%' and kind in ('confirm','automatic') group by order_id having count(*)>1)x),'claims',(select count(*) from public.order_cancellation_requests where order_id::text like '%s-%%'),'automaticConfirmed',(select count(*) from private.order_purchase_confirmations where order_id::text like '%s-%%' and confirmation_kind='automatic')) from public.orders where id::text like '%s-%%'" % ((prefix,) * 5)))
assert readback['automaticConfirmed'] >= 4 and readback['orders'] == 13 and readback['claims'] == 4 and readback['duplicateGrants'] == readback['duplicateConfirmEvents'] == 0, readback
# request timestamps use transaction start, so temporal ordering is verified by
# lock/state outcomes, not by comparing that older timestamp to wall-clock events.
assert all('requested' in r for r in claim_results[:4])

# T14c(1014-079): review registration confirms the purchase in the same transaction.
# Whichever of review / [구매확정] / automatic worker / claim locks first, an order is
# confirmed and credited at most once, and a review only ever exists on a confirmed order.
good = 'confirmation-race-' + prefix + '-a'
def attempt(statement, expected):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=40)
    if result.returncode:
        error = result.stderr.decode()
        for word in expected:
            if word in error:
                return word
        raise RuntimeError(error[-1600:])
    return 'ok'
def review(n, ack=True):
    return attempt("begin;set local lock_timeout='12s';select set_config('request.jwt.claim.sub','%s',true);select set_config('request.jwt.claims','%s',true);set local role authenticated;select public.create_good_review_v3('%s','%s',5,'TEST race review','{}','ordinary',%s,'%s','%s');commit;" % (actor, claims, order(n), good, 'true' if ack else 'false', actor, session), ('review_already_exists', 'review_purchase_confirmation_blocked'))
def button(n):
    return attempt("begin;set local lock_timeout='12s';select set_config('request.jwt.claim.sub','%s',true);select set_config('request.jwt.claims','%s',true);set local role authenticated;select public.confirm_my_purchase('%s','confirm',0,'%s','%s','%s',true);commit;" % (actor, claims, order(n), uuid.uuid4(), actor, session), ('purchase_confirmation_changed', 'purchase_confirmation_unavailable'))
sql('begin;\n' + source2 + '\n' + '\n'.join(f'select pg_temp.confirm_order({n});' for n in range(14, 23)) + '\ncommit;')
# Orders 14-17: review vs buyer button vs automatic worker on the same order.
sql("update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second' where order_id=any(array['%s']::uuid[])" % "','".join(order(n) for n in range(14, 18)))
barrier = threading.Barrier(12)
def review_button_worker(index):
    barrier.wait(timeout=15)
    n = 14 + index % 4
    if index < 4:
        return review(n)
    if index < 8:
        return button(n)
    return attempt('select public.settle_delivered_orders()', ())
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    review_race = list(pool.map(review_button_worker, range(12)))
assert review_race[:4] == ['ok'] * 4, review_race
# Order 18: the same review submitted six times at once.
barrier = threading.Barrier(6)
def duplicate_review(_):
    barrier.wait(timeout=15)
    return review(18)
with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
    duplicate_reviews = list(pool.map(duplicate_review, range(6)))
assert duplicate_reviews.count('ok') == 1 and duplicate_reviews.count('review_already_exists') == 5, duplicate_reviews
# Orders 19-22: review vs return claim. A claim that locks first blocks the review;
# a review that locks first confirms, and the confirmed order still accepts the return.
barrier = threading.Barrier(8)
def review_or_claim(index):
    barrier.wait(timeout=15)
    n = 19 + index % 4
    if index < 4:
        return review(n)
    return attempt("begin;set local lock_timeout='12s';set local role service_role;select public.request_order_claim('%s','%s','return','TEST review race return','change_of_mind');commit;" % (order(n), actor), ())
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
    claim_review_race = list(pool.map(review_or_claim, range(8)))
assert all(r in ('ok', 'review_purchase_confirmation_blocked') for r in claim_review_race[:4]) and claim_review_race[4:] == ['ok'] * 4, claim_review_race
race_orders = "array['%s']::uuid[]" % "','".join(order(n) for n in range(14, 23))
review_readback = json.loads(sql("select jsonb_build_object('orders',count(*),'done',count(*) filter(where o.status='done'),'reviews',(select count(*) from public.reviews where order_id=any(%s)),'reviewsOnUnconfirmed',(select count(*) from public.reviews r join public.orders u on u.id=r.order_id where r.order_id=any(%s) and u.status<>'done'),'duplicateGrants',(select count(*) from (select order_id from public.store_credit_ledger where order_id=any(%s) and kind='grant' group by order_id having count(*)>1)x),'duplicateConfirmEvents',(select count(*) from (select order_id from private.purchase_confirmation_events where order_id=any(%s) and kind in ('confirm','automatic') group by order_id having count(*)>1)x),'reviewConfirmed',(select count(*) from private.purchase_confirmation_events where order_id=any(%s) and kind='confirm' and note='리뷰 등록과 함께 확정'),'claims',(select count(*) from public.order_cancellation_requests where order_id=any(%s))) from public.orders o where o.id=any(%s)" % ((race_orders,) * 7)))
blocked_reviews = claim_review_race[:4].count('review_purchase_confirmation_blocked')
assert review_readback['orders'] == 9 and review_readback['reviews'] == 9 - blocked_reviews and review_readback['reviewsOnUnconfirmed'] == 0 \
    and review_readback['duplicateGrants'] == review_readback['duplicateConfirmEvents'] == 0 and review_readback['claims'] == 4 \
    and review_readback['done'] == 9 - blocked_reviews and review_readback['reviewConfirmed'] >= 1, review_readback
# T14c follow-up: the automatic worker never waits on a customer that a payment,
# gift or review transaction holds, so those paths can never become its deadlock
# victims. Contended orders are skipped and confirmed by a later run.
import time
origin = prefix + '-0000-4000-8000-000000000010'
def worker_user(n):
    return prefix + '-0000-4000-8000-' + str(300 + n).zfill(12)
def worker_session(n):
    return prefix + '-0000-4000-9000-' + str(300 + n).zfill(12)
def worker_order(n):
    return prefix + '-0000-4001-9000-' + str(n).zfill(12)
def checkout_key(n):
    return prefix + '-0000-4002-a000-' + str(n).zfill(12)
def claim_token(n):
    return prefix + '-0000-4002-b000-' + str(n).zfill(12)
def run(statement):
    return subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=60)
users = [worker_user(n) for n in range(30)]
user_array = "array['%s']::uuid[]" % "','".join(users)
session_array = "array['%s']::uuid[]" % "','".join(worker_session(n) for n in range(30))
sql("begin;insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) "
    "select u,'authenticated','authenticated','worker-'||u||'@example.test',now(),'{}','{}',now(),now() from unnest(%s) u;"
    "update public.profiles set nickname='TEST W'||left(id::text,8)||right(id::text,3),birth_date='2000-01-01',onboarded_at=now(),consents='{\"terms\":true,\"privacy\":true}',role='user' where id=any(%s);"
    "insert into auth.sessions(id,user_id,created_at,updated_at,not_after) select s,u,now(),now(),now()+interval '1 hour' from unnest(%s,%s) t(u,s);"
    "create schema worker_race_%s;"
    "create function worker_race_%s.due_order(p_user uuid,p_order uuid) returns void language plpgsql as $f$"
    "declare shipment uuid:=gen_random_uuid();item uuid;begin"
    " insert into public.orders(id,user_id,status,total,address,store_credit_policy_snapshot) values(p_order,p_user,'confirmed',10000,"
    "  '{\"recipientName\":\"TEST 작업\",\"phone\":\"01000000000\",\"postalCode\":\"12345\",\"address1\":\"TEST 합성 주소\"}',"
    "  '{\"enabled\":true,\"earnKind\":\"fixed\",\"earnValue\":100,\"earnMaxPerOrder\":1000,\"maxBalance\":100000,\"validityDays\":30,\"minUse\":100,\"maxUse\":1000,\"restoreGraceDays\":3,\"refundEarnedCreditMode\":\"offset_future_credits\"}');"
    " insert into public.order_items(order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)"
    "  select p_order,g.id,v.id,1,10000,g.name,g.type,g.ip_id from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.id='%s' returning id into item;"
    " insert into public.payments(user_id,purpose,ref_id,provider,amount,status,idempotency_key) values(p_user,'order',p_order,'toss',10000,'paid','worker-race-'||p_order);"
    " insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot) values(shipment,p_order,'%s','TEST 출고지',0,'{}');"
    " insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(p_order,shipment,item,1);"
    " update public.order_shipments set status='delivered',carrier='hanjin',tracking_number='TW'||upper(right(replace(p_order::text,'-',''),28)),"
    "  shipped_at=clock_timestamp()-interval '11 days',delivered_at=clock_timestamp()-interval '10 days' where id=shipment;"
    " update public.orders set status='delivered',delivered_at=clock_timestamp()-interval '10 days' where id=p_order;"
    " update private.order_purchase_confirmations set auto_due_at=clock_timestamp()-interval '1 second' where order_id=p_order;"
    "end $f$;commit;" % (user_array, user_array, user_array, session_array, prefix, prefix, good, origin))
def due_orders(pairs):
    sql('begin;' + ''.join("select worker_race_%s.due_order('%s','%s');" % (prefix, user, order_id) for user, order_id in pairs) + 'commit;')
address = '{"recipientName":"TEST 작업","phone":"01012345678","postalCode":"12345","address1":"TEST 합성 주소"}'
def pending_payment(user, n):
    # The real checkout -> prepare -> nonce -> claim path; finalization happens inside the race.
    sql("begin;delete from public.cart_items where user_id='%s';"
        "insert into public.cart_items(user_id,good_id,variant_id,qty) select '%s',good_id,id,1 from public.goods_variants where good_id='%s' and is_default;"
        "set local role service_role;select public.place_order_with_store_credits('%s','%s','%s','card',0);reset role;"
        "do $d$declare purchase uuid;pending public.payment_attempts;nonce text:=encode(sha256('%s'::bytea),'hex');begin"
        " select id into purchase from public.orders where checkout_key='%s';"
        " perform public.prepare_goods_payment_attempt('%s',purchase,'toss');"
        " select * into pending from public.payment_attempts where ref_id=purchase;"
        " perform public.bind_goods_payment_callback_nonce(pending.id,nonce);"
        " perform public.claim_goods_payment_attempt('toss',pending.provider_order_id,nonce,'%s');"
        "end $d$;commit;" % (user, user, good, user, address, checkout_key(n), checkout_key(n), checkout_key(n), user, claim_token(n)))
def finalize_sql(n):
    return ("select public.finalize_goods_payment_attempt((select a.id from public.payment_attempts a join public.orders o on o.id=a.ref_id where o.checkout_key='%s'),"
            "'%s','approved',null,'TEST-WORKER-RACE-%s-%s');" % (checkout_key(n), claim_token(n), prefix, n))
def claims_for(n):
    return json.dumps({'sub': worker_user(n), 'role': 'authenticated', 'session_id': worker_session(n)})
def holder(name, statement, seconds):
    process = subprocess.Popen(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write("begin;set local application_name='%s';%sselect pg_sleep(%s);commit;" % (name, statement, seconds))
    process.stdin.close(); process.stdin = None
    return process
def wait_sleeping(name, process):
    for _ in range(200):
        if sql("select coalesce(wait_event,'') from pg_stat_activity where application_name='%s'" % name) == 'PgSleep':
            return
        if process.poll() is not None:
            raise RuntimeError(name + ' ended before holding: ' + str(process.communicate()))
        time.sleep(0.02)
    raise RuntimeError(name + ' never held its locks')
def statuses(order_ids):
    return json.loads(sql("select coalesce(jsonb_object_agg(id,status),'{}') from public.orders where id=any(array['%s']::uuid[])" % "','".join(order_ids)))

# Phase A, deterministic: each holder takes exactly the customer locks one path
# takes first and keeps them while the worker runs. The worker must return well
# before the holders release, skip only the held customers, and leave every
# holder unharmed. The previous worker waited inside its candidate scan here.
due_orders([(worker_user(n), worker_order(n)) for n in range(6)])
holder_names = {label: 'wr-%s-%s' % (prefix, label) for label in ('payment', 'gift', 'review', 'credit')}
holders = {
    # checkout / payment prefix: actor -> account action -> profile
    'payment': holder(holder_names['payment'], "select private.lock_goods_transaction_actor('%s');" % worker_user(1), 3),
    # gift prefix: both customers in id order
    'gift': holder(holder_names['gift'], "select private.gift_lock_subjects(array['%s','%s']::uuid[]);" % (worker_user(2), worker_user(3)), 3),
    # review registration and [구매확정] identity: profile -> account action
    'review': holder(holder_names['review'], "select set_config('request.jwt.claim.sub','%s',true);select set_config('request.jwt.claims','%s',true);select private.purchase_confirmation_identity('%s','%s',false);"
        % (worker_user(4), claims_for(4), worker_user(4), worker_session(4)), 3),
    # the paid-transition store credit lock a payment takes inside its triggers
    'credit': holder(holder_names['credit'], "select private.lock_store_credit_account('%s');" % worker_user(5), 3),
}
for label, process in holders.items():
    wait_sleeping(holder_names[label], process)
started = time.monotonic()
sql('select public.settle_delivered_orders()')
worker_seconds = round(time.monotonic() - started, 3)
held_statuses = statuses([worker_order(n) for n in range(6)])
assert worker_seconds < 1.5 and held_statuses[worker_order(0)] == 'done' \
    and all(held_statuses[worker_order(n)] == 'delivered' for n in range(1, 6)), (worker_seconds, held_statuses)
holder_results = {}
for label, process in holders.items():
    out, err = process.communicate(timeout=30)
    assert process.returncode == 0 and '40P01' not in err, (label, err)
    holder_results[label] = 'ok'
sql('select public.settle_delivered_orders()')
released_statuses = statuses([worker_order(n) for n in range(6)])
assert all(value == 'done' for value in released_statuses.values()), released_statuses

# Phase B, real paths together with the worker, three rounds on fresh customers:
# real payment finalization, a gift-style two-customer lock followed by the real
# finalizer, and review registration confirming a due order. None may fail; every
# due order is confirmed once the skipped ones are drained by later runs.
stress = []
for round_index in range(3):
    base = 6 + round_index * 8
    payers = [base, base + 1]
    gift_pairs = [(base + 2, base + 3), (base + 4, base + 5)]
    reviewers = [base + 6, base + 7]
    due = [(worker_user(n), worker_order(100 + n * 2 + k)) for n in range(base, base + 8) for k in range(2)]
    due_orders(due)
    for n in payers + [pair[0] for pair in gift_pairs]:
        pending_payment(worker_user(n), n)
    barrier = threading.Barrier(9)
    def stress_call(index):
        barrier.wait(timeout=20)
        if index < 2:
            n = payers[index]
            return ('payment', run("begin;set local lock_timeout='20s';set local role service_role;" + finalize_sql(n) + 'commit;'))
        if index < 4:
            first, second = gift_pairs[index - 2]
            return ('gift', run("begin;set local lock_timeout='20s';select private.gift_lock_subjects(array['%s','%s']::uuid[]);" % (worker_user(first), worker_user(second))
                + finalize_sql(first) + 'commit;'))
        if index < 6:
            n = reviewers[index - 4]
            return ('review', run("begin;set local lock_timeout='20s';select set_config('request.jwt.claim.sub','%s',true);select set_config('request.jwt.claims','%s',true);set local role authenticated;"
                "select public.create_good_review_v3('%s','%s',5,'TEST worker race review','{}','ordinary',true,'%s','%s');commit;"
                % (worker_user(n), claims_for(n), worker_order(100 + n * 2), good, worker_user(n), worker_session(n))))
        return ('worker', run('select public.settle_delivered_orders();'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:
        outcomes = list(pool.map(stress_call, range(9)))
    for kind, result in outcomes:
        error = result.stderr.decode()
        assert result.returncode == 0 and '40P01' not in error, (round_index, kind, error[-1500:])
        if kind in ('payment', 'gift'):
            assert result.stdout.decode().strip().splitlines()[-1] == 'approved', (round_index, kind, result.stdout.decode())
    for _ in range(5):
        if sql('select public.settle_delivered_orders()') == '0':
            break
    round_orders = "array['%s']::uuid[]" % "','".join(order_id for _, order_id in due)
    paid_keys = "array['%s']::uuid[]" % "','".join(checkout_key(n) for n in payers + [pair[0] for pair in gift_pairs])
    round_readback = json.loads(sql("select jsonb_build_object('due',count(*),'done',count(*) filter(where o.status='done'),"
        "'duplicateConfirmEvents',(select count(*) from (select order_id from private.purchase_confirmation_events where order_id=any(%s) and kind in ('confirm','automatic') group by order_id having count(*)>1)x),"
        "'duplicateGrants',(select count(*) from (select order_id from public.store_credit_ledger where order_id=any(%s) and kind='grant' group by order_id having count(*)>1)x),"
        "'reviewsOnUnconfirmed',(select count(*) from public.reviews r join public.orders u on u.id=r.order_id where r.order_id=any(%s) and u.status<>'done'),"
        "'reviews',(select count(*) from public.reviews where order_id=any(%s)),"
        "'paidPayments',(select count(*) from public.orders where checkout_key=any(%s) and status in ('paid','confirmed'))) from public.orders o where o.id=any(%s)"
        % (round_orders, round_orders, round_orders, round_orders, paid_keys, round_orders)))
    assert round_readback['due'] == round_readback['done'] == len(due) and round_readback['duplicateConfirmEvents'] == round_readback['duplicateGrants'] == 0 \
        and round_readback['reviewsOnUnconfirmed'] == 0 and round_readback['reviews'] == len(reviewers) and round_readback['paidPayments'] == 4, (round_index, round_readback)
    stress.append(round_readback)

print(json.dumps({'prefix': prefix, 'duplicateCalls': 12, 'workerBuyerCalls': 12, 'claimBuyerCalls': 8, 'readback': readback, 'claimRaceBuyerRejected': claim_results[4:].count('rejected'),
    'reviewRace': review_race, 'duplicateReviews': duplicate_reviews, 'claimReviewRace': claim_review_race, 'reviewReadback': review_readback,
    'workerPhaseA': {'workerSeconds': worker_seconds, 'heldStatuses': held_statuses, 'holders': holder_results}, 'workerStress': stress}, indent=2, ensure_ascii=False))

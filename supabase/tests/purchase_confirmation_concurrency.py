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
print(json.dumps({'prefix': prefix, 'duplicateCalls': 12, 'workerBuyerCalls': 12, 'claimBuyerCalls': 8, 'readback': readback, 'claimRaceBuyerRejected': claim_results[4:].count('rejected'),
    'reviewRace': review_race, 'duplicateReviews': duplicate_reviews, 'claimReviewRace': claim_review_race, 'reviewReadback': review_readback}, indent=2, ensure_ascii=False))

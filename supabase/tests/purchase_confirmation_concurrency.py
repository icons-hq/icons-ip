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
print(json.dumps({'prefix': prefix, 'duplicateCalls': 12, 'workerBuyerCalls': 12, 'claimBuyerCalls': 8, 'readback': readback, 'claimRaceBuyerRejected': claim_results[4:].count('rejected')}, indent=2))

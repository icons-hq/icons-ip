"""BEST payout and cancellation races in the named disposable QA database only.
Requires the synthetic reward policy explicitly enabled by the browser QA.
Never connects to production; never sends real payments or messages.
"""
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

def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.decode()[-1500:])
    return result.stdout.decode().strip()

assert sql("select best_enabled and best_reversal='revoke' from private.customer_reward_policy where singleton") == 't'
prefix = uuid.uuid4().hex[:8]
source = Path('supabase/tests/review_best.sql').read_text().split('select pg_temp.best_order(1,1)')[0]
source = source.replace("load 'safeupdate';\n", '').replace('93500000', prefix).replace('review-best-', 'reward-race-' + prefix + '-').replace('선정 합성', 'TEST 경쟁 ' + prefix)
fixture = source + '\n' + '\n'.join(f'select pg_temp.best_order({n},1);' for n in range(21, 33)) + '\ncommit;'
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text() + '\n' + fixture)
actor = prefix + '-0000-4000-8000-000000000001'
reviews = json.loads(sql("select jsonb_agg(jsonb_build_object('id',r.id,'order',r.order_id,'fingerprint',private.review_event_review_fingerprint(r))) from public.reviews r where r.good_id='reward-race-%s-good'" % prefix))
for review in reviews:
    sql("begin;select set_config('request.jwt.claim.sub','%s',true);select public.admin_set_review_best('%s',true,'TEST race selection',0,'%s',gen_random_uuid());commit;" % (actor, review['id'], review['fingerprint']))
barrier = threading.Barrier(12)
def pay(index):
    barrier.wait(timeout=15)
    review = reviews[index % 6]
    return sql("select private.process_review_best_reward_jobs('%s',30)" % review['id'])
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    paid = list(pool.map(pay, range(12)))
counts = json.loads(sql("select jsonb_build_object('rewards',(select count(*) from private.review_best_rewards r join public.orders o on o.id=r.order_id where o.id::text like '%s-%%'),'grants',(select count(*) from public.store_credit_ledger where order_id::text like '%s-%%' and reason='BEST 리뷰 보상'))" % (prefix, prefix)))
assert counts == {'rewards': 6, 'grants': 6}, counts
# Cancellation holds the order lock and queues reversal; concurrent payout reads
# must neither duplicate a grant nor deadlock against its financial transition.
barrier = threading.Barrier(24)
def cancel_or_process(index):
    barrier.wait(timeout=15)
    review = reviews[index % 12]
    return sql(("begin;select 1 from public.orders where id='%s' for update;update public.payments set status='refunded' where purpose='order' and ref_id='%s';commit;" % (review['order'],review['order'])) if index < 12 else ("select private.process_review_best_reward_jobs('%s',30)" % review['id']))
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
    canceled = list(pool.map(cancel_or_process, range(24)))
for review in reviews:
    sql("select private.process_review_best_reward_jobs('%s',30)" % review['id'])
readback = json.loads(sql("select jsonb_build_object('rewards',count(*),'revoked',count(*) filter(where r.revoked_at is not null),'remainingAvailable',coalesce(sum(l.available_amount),0),'duplicateGrants',(select count(*) from (select order_id from public.store_credit_ledger where order_id::text like '%s-%%' and reason='BEST 리뷰 보상' group by order_id having count(*)<>1)t),'failedJobs',(select count(*) from private.review_best_reward_jobs where order_id::text like '%s-%%' and (state<>'done' or attempts>0))) from private.review_best_rewards r left join private.store_credit_lots l on l.id=r.lot_id where r.order_id::text like '%s-%%'" % (prefix,prefix,prefix)))
assert 6 <= readback['rewards'] <= 12 and readback['revoked'] == readback['rewards'] and all(readback[key] == 0 for key in ['remainingAvailable', 'duplicateGrants', 'failedJobs']), readback
print(json.dumps({'syntheticPrefix': prefix, 'simultaneousPayoutCalls': len(paid), 'simultaneousCancellationAndPayoutCalls': len(canceled), 'readback': readback}, indent=2))

"""Claim intake racing an actual delivery-record RPC in the owned local DB."""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-json', required=True)
runtime = json.loads(Path(parser.parse_args().runtime_json).read_text())
assert runtime['projectId'].startswith('icons-ip-full-admin-')
container = runtime['databaseContainerId']
inspection = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert inspection['Name'] == '/supabase_db_' + runtime['projectId'] and inspection['State']['Running']
def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=40)
    if result.returncode:
        raise RuntimeError(result.stderr.decode()[-1800:])
    return result.stdout.decode().strip()

prefix = uuid.uuid4().hex[:8]
source = Path('supabase/tests/in_transit_claim_intake.sql').read_text().split('select pg_temp.confirm_order(1)')[0]
source = source.replace('bd160000', prefix).replace('transit-claim', 'transit-race-' + prefix).replace('transit-kc', 'transit-kc-' + prefix).replace('TEST 배송중 SQL ', 'TEST ' + prefix + ' ')
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text() + source + '\n' + '\n'.join(f'select pg_temp.confirm_order({n});' for n in range(1, 9)) + '\ncommit;')
shipments = json.loads(sql("select jsonb_agg(jsonb_build_object('order',order_id,'shipment',id) order by order_id) from public.order_shipments where order_id::text like '%s-%%'" % prefix))
barrier = threading.Barrier(24)
def compete(index):
    row = shipments[index % 8]
    barrier.wait(timeout=15)
    if index < 8:
        return sql("begin;set local lock_timeout='15s';select set_config('request.jwt.claim.sub','%s-0000-4000-8000-000000000001',true);set local role authenticated;select public.admin_update_shipment_status('%s','delivered',null,null);commit;" % (prefix, row['shipment']))
    return sql("begin;set local lock_timeout='15s';set local role service_role;select public.request_order_claim('%s','%s-0000-4000-8000-000000000002','return','TEST transit race','change_of_mind');commit;" % (row['order'], prefix))
with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
    results = list(pool.map(compete, range(24)))
assert all('requested' in value for value in results[8:])
readback = json.loads(sql("select jsonb_build_object('orders',count(*),'delivered',count(*) filter(where status='delivered'),'claims',(select count(*) from public.order_cancellation_requests where order_id::text like '%s-%%'),'physicalRecoveryRequired',(select count(*) from public.order_cancellation_requests where order_id::text like '%s-%%' and collection_required and collected_at is null and stage='requested'),'refunds',(select count(*) from public.refunds r join public.order_cancellation_requests c on c.id=r.cancellation_request_id where c.order_id::text like '%s-%%')) from public.orders where id::text like '%s-%%'" % ((prefix,) * 4)))
assert readback == {'orders': 8, 'delivered': 8, 'claims': 8, 'physicalRecoveryRequired': 8, 'refunds': 0}, readback
print(json.dumps({'prefix': prefix, 'concurrentCalls': 24, 'readback': readback}, indent=2))

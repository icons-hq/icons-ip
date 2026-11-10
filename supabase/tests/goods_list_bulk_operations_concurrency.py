"""Synthetic bulk-operation races; explicitly owned disposable runtime only."""
import argparse
import concurrent.futures
import json
import subprocess
import threading
import time
import uuid
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-json', required=True)
runtime = json.loads(Path(parser.parse_args().runtime_json).read_text())
container = runtime['databaseContainerId']
metadata = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert runtime['projectId'].startswith('icons-ip-full-admin-') and runtime['existingDatabaseReset'] is False
assert metadata['Id'] == container and metadata['Name'] == '/supabase_db_' + runtime['projectId'] and metadata['State']['Running']

def sql(query):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
                            input=query.encode(), capture_output=True, timeout=45)
    if result.returncode:
        raise RuntimeError(result.stderr.decode()[-2200:])
    return result.stdout.decode().strip()

run = uuid.uuid4().hex[:8]
fixture = Path(__file__).with_name('goods_list_bulk_operations.sql').read_text().split('create function pg_temp.bulk_preview')[0]
fixture = fixture.replace('b9000000', run).replace('bulk-', f'bulk-race-{run}-').replace('일괄검증관리자', f'일괄검증{run}')
sql(fixture + '\ncommit;')
actor = f'{run}-0000-4000-8000-000000000001'
session = f'{run}-0000-4000-8000-000000000011'
goods = [f'bulk-race-{run}-a', f'bulk-race-{run}-b']
claims = json.dumps({'sub': actor, 'session_id': session, 'role': 'authenticated'})
prefix = f"begin;set local lock_timeout='20s';select set_config('request.jwt.claims','{claims}',true);select set_config('request.jwt.claim.sub','{actor}',true);set local role authenticated;"

def call(expression):
    return json.loads(sql(prefix + 'select ' + expression + ';commit;').splitlines()[-1])

def preview(command='price', values=None):
    operation = str(uuid.uuid4())
    request = json.dumps({'kind': 'goods', 'ids': goods, 'command': command, 'values': values if values is not None else {'mode': 'increase', 'value': 100}})
    result = call(f"public.admin_preview_goods_bulk('{operation}','{request}','{actor}','{session}')")
    assert result['operationId'] == operation
    return operation

def commit(operation):
    return call(f"public.admin_commit_goods_bulk('{operation}','{actor}','{session}')")

def parallel(count, function):
    barrier = threading.Barrier(count)
    def execute(index):
        barrier.wait(timeout=15)
        return function(index)
    with concurrent.futures.ThreadPoolExecutor(max_workers=count) as pool:
        return list(pool.map(execute, range(count)))

same = preview()
receipts = parallel(12, lambda _: commit(same))
assert len({json.dumps(row, sort_keys=True) for row in receipts}) == 1 and receipts[0]['state'] == 'completed'
operations = [preview() for _ in range(8)]
competing = parallel(8, lambda i: commit(operations[i]))
assert sum(row['state'] == 'completed' for row in competing) == 1
assert all(row['state'] == 'completed' or row['error'] == 'goods_bulk_changed' for row in competing)
seal_operation = preview('stop', {})
sealed = parallel(12, lambda i: commit(seal_operation) if i % 2 else call(f"public.admin_read_goods_bulk('{seal_operation}','{actor}','{session}',true)"))
assert len({json.dumps(row, sort_keys=True) for row in sealed}) == 1 and sealed[0]['state'] in ('completed', 'sealed')

# Expiration must be checked after the topology lock has been released.
expiring = preview('stop', {})
sql(f"update private.goods_bulk_operations set expires_at=clock_timestamp()+interval '1 second' where id='{expiring}';")
lock = subprocess.Popen(['docker', 'exec', '-i', container, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
lock.stdin.write("begin;select pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));select 'LOCK_READY';select pg_sleep(1.5);commit;\n")
lock.stdin.close()
while lock.stdout.readline().strip() != 'LOCK_READY':
    if lock.poll() is not None:
        raise RuntimeError('Lock holder ended before readiness')
expired = commit(expiring)
lock.wait(timeout=10)
assert lock.returncode == 0 and expired['error'] == 'goods_bulk_preview_expired'
readback = json.loads(sql(f"select jsonb_build_object('prices',(select jsonb_agg(price order by id) from public.goods where id in ('{goods[0]}','{goods[1]}')),'stock',(select sum(stock_qty) from public.goods_variants where good_id in ('{goods[0]}','{goods[1]}')),'audit',(select count(*) from public.audit_log where action='catalog.goods_bulk.completed' and target='goods_bulk:{same}'));"))
assert readback == {'prices': [10200, 20200], 'stock': 21, 'audit': 1}
print(json.dumps({'run': run, 'sameRequest': 12, 'competing': [r['state'] for r in competing], 'sealRace': sealed[0]['state'], 'expiredAfterLock': expired['error'], 'readback': readback}, indent=2))

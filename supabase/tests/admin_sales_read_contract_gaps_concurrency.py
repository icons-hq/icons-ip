"""Disposable sales search/export SQL and receipt/permission lock checks."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_sales_read_gap_concurrency_'):
    raise SystemExit('Use the disposable sales read contract wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
root = Path(__file__).resolve().parents[1]


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


if sql("select to_regprocedure('private.collect_settled_export_for_search(date,date,text,text,text)') is null;") == 't':
    sql((root / 'migrations/20261013153022_admin_sales_read_contract_gaps.sql').read_text())
result = subprocess.run(command + ['-f', '-'], input=Path(__file__).with_name('admin_sales_read_contract_gaps.sql').read_text(), text=True, capture_output=True)
if result.returncode:
    print(result.stdout[-6000:])
    raise RuntimeError(result.stderr)
print('PASS sales read contract functional SQL through the existing postgres-owned public RPC', flush=True)
fixture = Path(__file__).with_name('admin_sales_read_contract_gaps.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.sales_gap_id'):fixture.index('-- FIXTURE END:')]
sql('begin;create schema sales_gap_test;grant usage on schema sales_gap_test to authenticated;'
    + fixture.replace('pg_temp.', 'sales_gap_test.') + 'commit;')
prefix = f'sales-read-gap-{os.getpid()}'


def uid(kind, number):
    value = list(hashlib.md5(f'sales-read-gap:{kind}:{number}'.encode()).hexdigest())
    value[12], value[16] = '4', '8'
    return str(uuid.UUID(''.join(value)))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('actor', number)}',true);set local role authenticated;"


def create(operation, field='recipient'):
    filters = json.dumps({'field': field, 'query': 'GAP1530'})
    return actor() + f"select public.admin_create_settled_export('{uid('race', operation)}','{filters}'::jsonb);"


def wait_state(name, expected, process):
    for _ in range(120):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"load 'safeupdate';set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close(); one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"load 'safeupdate';set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close(); two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: actual lock wait; ' + ('rejected safely' if expected_error else 'committed'), flush=True)
    return first_out[0].strip(), second_out[0].strip()


one, two = race('same-request-and-field', create(1), create(1))
# set_config emits the actor id before the JSON result.
receipt = json.loads(one.splitlines()[-1])
assert receipt == json.loads(two.splitlines()[-1])
assert receipt['orderCount'] == 1
race('changed-field-same-request', create(2), create(2, 'nickname'), 'settled_export_request_conflict')
assert sql(f"select count(*) from private.settled_export_receipts where actor_id='{uid('actor',1)}' and request_id in('{uid('race',1)}','{uid('race',2)}');") == '2'
assert sql(f"select count(*) from public.audit_log where actor_id='{uid('actor',1)}' and action='admin.settled_export.created';") == '2'
sql(f"update public.orders set address=jsonb_set(address,'{{recipientName}}','\"현재 값 변경\"') where id='{uid('order',101)}';")
replay = sql('begin;' + create(1) + 'commit;')
assert json.loads(replay.splitlines()[-1]) == receipt
frozen = json.loads(sql('begin;' + actor() + f"select public.admin_read_settled_export('{receipt['id']}');commit;").splitlines()[-1])
assert frozen['filters']['field'] == 'recipient' and frozen['orders'][0]['id'] == uid('order',101)
race('revoke-before-receipt-replay',
     f"select private.lock_operator_subjects(array['{uid('actor',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('actor',1)}';",
     create(1), 'operator_capability_required')
assert sql(f"select count(*) from private.settled_export_receipts where actor_id='{uid('actor',1)}';") == '2'
print('PASS immutable source selection, field-bound retries, current permission, and one audit per accepted receipt', flush=True)

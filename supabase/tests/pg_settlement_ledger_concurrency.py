"""Isolated settlement ledger functional and actual session-lock verification."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_pg_settlement_concurrency_'):
    raise SystemExit('Use the disposable settlement wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
root = Path(__file__).resolve().parents[1]


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


if sql("select to_regprocedure('public.admin_get_pg_settlement_report(jsonb)') is null;") == 't':
    sql((root / 'migrations/20261020085304_pg_settlement_ledger.sql').read_text())
result = subprocess.run(command, input=Path(__file__).with_name('pg_settlement_ledger.sql').read_text(), text=True, capture_output=True)
if result.returncode:
    print(result.stdout[-6000:])
    raise RuntimeError(result.stderr)
print('PASS settlement ledger functional SQL', flush=True)
fixture = Path(__file__).with_name('pg_settlement_ledger.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.settlement_id'):fixture.index('create temp table settlement_finance_before')]
sql('begin;create schema settlement_test;grant usage on schema settlement_test to service_role,authenticated;'
    + fixture.replace('pg_temp.', 'settlement_test.') + 'commit;')
prefix = f'pg-settlement-{os.getpid()}'


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'pg-settlement:{kind}:{number}'.encode()).hexdigest()))


def service():
    return 'set local role service_role;'


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('actor', number)}',true);set local role authenticated;"


def create(number):
    return sql(f"begin;{service()}select settlement_test.settlement_create({number});commit;")


def claim(import_id):
    return f"select public.service_claim_pg_settlement_import('{uid('actor',1)}','{import_id}',repeat('a',64));"


def finish(import_id, token, records='jsonb_build_array(settlement_test.settlement_record())'):
    return f"select public.service_finish_pg_settlement_import('{uid('actor',1)}','{import_id}','{token}',repeat('a',64),settlement_test.settlement_page({records}));"


def prepare(number):
    import_id = create(number)
    result = json.loads(sql(f'begin;{service()}{claim(import_id)}commit;'))
    return import_id, result['claimId']


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


one, two = race('same-operation', service() + 'select settlement_test.settlement_create(100);',
                service() + 'select settlement_test.settlement_create(100);')
assert one == two
import_id = one
race('operation-actor-binding', service() + 'select settlement_test.settlement_create(101);', service()
     + f"select public.service_create_pg_settlement_import('{uid('actor',2)}','{uid('op',101)}',settlement_test.settlement_query(),'test',repeat('a',64),'syntheticmid');", 'settlement_operation_conflict')
one, two = race('single-lease', service() + claim(import_id), service() + claim(import_id))
assert json.loads(one)['kind'] == 'ready' and json.loads(two)['kind'] == 'busy'
token = json.loads(one)['claimId']
one, two = race('same-page-receipt', service() + finish(import_id, token), service() + finish(import_id, token))
assert json.loads(one) == json.loads(two)
token = json.loads(sql(f'begin;{service()}{claim(import_id)}commit;'))['claimId']
one, two = race('complete-once', service() + finish(import_id, token), service() + finish(import_id, token))
assert json.loads(one)['kind'] == 'complete' and json.loads(one) == json.loads(two)
assert sql(f"select count(*) from public.audit_log where action='admin.pg_settlement.import_completed' and diff->>'importId'='{import_id}';") == '1'

late_id, old_token = prepare(102)
sql(f"update private.pg_settlement_imports set lease_until=clock_timestamp()-interval '1 second' where id='{late_id}';")
one, two = race('expired-token-cas', service() + claim(late_id), service() + finish(late_id, old_token))
assert json.loads(one)['kind'] == 'ready' and json.loads(two)['kind'] == 'stale'
assert sql(f"select count(*) from private.pg_settlement_pages where import_id='{late_id}';") == '0'

failed_id, failed_token = prepare(103)
one, two = race('failed-lease-before-late-finish', service()
    + f"select public.service_fail_pg_settlement_import('{uid('actor',1)}','{failed_id}','{failed_token}',repeat('a',64),'provider_unavailable');",
    service() + finish(failed_id, failed_token))
assert json.loads(one)['job']['state'] == 'collecting' and json.loads(two)['kind'] == 'stale'
assert json.loads(sql(f'begin;{service()}{claim(failed_id)}commit;'))['kind'] == 'ready'

scope_id, scope_token = prepare(104)
one, two = race('scope-change-before-finish', service()
    + f"select public.service_claim_pg_settlement_import('{uid('actor',1)}','{scope_id}',repeat('b',64));",
    service() + finish(scope_id, scope_token))
assert json.loads(one)['job']['errorCode'] == 'scope_changed' and json.loads(two)['kind'] == 'failed'

revoke_id, revoke_token = prepare(105)
revoke = f"select private.lock_operator_subjects(array['{uid('actor',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('actor',1)}';"
restore = f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('actor',1)}';"
race('revoked-during-provider-wait', revoke, service() + finish(revoke_id, revoke_token), 'operator_capability_required')
assert sql(f"select count(*) from private.pg_settlement_pages where import_id='{revoke_id}';") == '0'
sql(restore)
race('revoked-before-readback', revoke, actor() + f"select public.admin_get_pg_settlement_import('{import_id}');", 'operator_capability_required')
sql(restore)
export_query = "settlement_test.settlement_query()||jsonb_build_object('mode','test','importId','" + import_id + "')"
report = json.loads(sql('begin;' + actor() + f'select public.admin_export_pg_settlement_report({export_query});commit;').splitlines()[-1])
race('revoked-before-export-audit', revoke, actor() + f"select public.admin_record_pg_settlement_export({export_query},'{report['fingerprint']}',1);", 'operator_capability_required')
sql(restore)

# A paused completion transaction must not publish a half-completed snapshot.
visible_id = create(106)
sql(f"begin;{service()}select settlement_test.settlement_step('{visible_id}',jsonb_build_array(settlement_test.settlement_record()));commit;")
visible_token = json.loads(sql(f'begin;{service()}{claim(visible_id)}commit;'))['claimId']
name = prefix + '-atomic-publication'
process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
process.stdin.write(f"load 'safeupdate';set application_name='{name}';begin;{service()}{finish(visible_id, visible_token)}select pg_sleep(1.5);commit;")
process.stdin.close(); process.stdin = None
wait_state(name, 'Timeout', process)
query = "settlement_test.settlement_query()||jsonb_build_object('mode','test','importId','" + visible_id + "')"
before = json.loads(sql('begin;' + actor(2) + f'select public.admin_get_pg_settlement_report({query});commit;').splitlines()[-1])
assert before['coverage'] == 'uncollected' and before['transactions'] == []
output = process.communicate(timeout=10)
if process.returncode:
    raise RuntimeError(output[1])
after = json.loads(sql('begin;' + actor(2) + f'select public.admin_get_pg_settlement_report({query});commit;').splitlines()[-1])
assert after['coverage'] == 'complete' and len(after['transactions']) == 1
print('PASS atomic publication: uncommitted complete scan stays unavailable', flush=True)

# Current finance facts may later be corrected; the finished reconciliation
# remains a record of the observed completion snapshot, not a live join.
sql(f"delete from private.payment_provider_evidence where payment_attempt_id='{uid('attempt',1)}';")
frozen = json.loads(sql('begin;' + actor(2) + f'select public.admin_get_pg_settlement_report({query});commit;').splitlines()[-1])
assert frozen['transactions'] == after['transactions'] and frozen['fingerprint'] == after['fingerprint']
print('PASS completion match and export fingerprint stay immutable after ledger changes', flush=True)

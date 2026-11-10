"""Actual account/operation/parent lock races for individual hold and resume."""
import hashlib
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_claim_hold_concurrency_'):
    raise SystemExit('Use the disposable claim hold wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'claim-hold-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'claim-hold:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user', number)}',true);set local role authenticated;"


def hold(claim, operation, decision='hold', who=1, note='합성 고객 문의의 확인을 기다리는 중입니다'):
    current = sql(f"select claim_revision||':'||claim_type from public.order_cancellation_requests where id='{uid('claim',claim)}';").split(':')
    body = 'null' if decision == 'resume' else "'" + note.replace("'", "''") + "'"
    return actor(who) + f"select public.admin_change_order_claim_hold('{uid('claim',claim)}','{uid('op',operation)}',{current[0]},'{current[1]}','{decision}',{body},'{uid('user',who)}');"


def convert(claim, operation):
    revision = sql(f"select claim_revision from public.order_cancellation_requests where id='{uid('claim',claim)}';")
    return actor() + f"select public.admin_convert_order_claim_type('{uid('claim',claim)}','{uid('convert',operation)}',{revision},'exchange','합성 고객의 전환 및 비용 합의',true,null);"


def withdraw(claim, operation):
    revision = sql(f"select claim_revision from public.order_cancellation_requests where id='{uid('claim',claim)}';")
    return actor(3) + f"select public.withdraw_my_order_claim('{uid('claim',claim)}','{uid('withdraw',operation)}',{revision},'합성 고객 철회 합의',true);"


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


root = Path(__file__).resolve().parents[1]
if sql("select to_regprocedure('public.admin_change_order_claim_hold(uuid,uuid,integer,text,text,text,uuid)') is null;") == 't':
    sql((root / 'migrations/20261020085300_order_claim_hold_operations.sql').read_text())
fixture = Path(__file__).with_name('order_claim_hold_operations.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.hold_id'):fixture.index('create temp table hold_order_before')]
fixture = fixture.replace('generate_series(1,12)', 'generate_series(1,22)')
sql('begin;create schema hold_test;grant usage on schema hold_test to authenticated;' + fixture.replace('pg_temp.', 'hold_test.') + 'commit;')
sql("create table hold_test.before_orders as select to_jsonb(o) value from public.orders o where id in(select hold_test.hold_id('order',n)from generate_series(1,22)n);")

race('same-operation', hold(1, 1), hold(1, 1))
race('changed-payload', hold(12, 2), hold(12, 2, note='다른 합성 보류 본문을 전달합니다'), 'claim_hold_request_conflict')
race('different-actors', hold(3, 3), hold(3, 4, who=2), 'claim_changed')
race('read-waits-for-write', hold(13, 5), actor() + f"select public.admin_read_order_claim_hold('{uid('op',5)}');")
race('convert-before-hold', convert(14, 1), hold(14, 6), 'claim_changed')
race('hold-before-convert', hold(15, 7), convert(15, 2), 'claim_changed')
race('withdraw-before-hold', withdraw(16, 1), hold(16, 8), 'claim_changed')
race('hold-before-withdraw', hold(17, 9), withdraw(17, 2), 'claim_changed')
sql('begin;' + hold(18, 10) + 'commit;')
sql('begin;' + hold(19, 11) + 'commit;')
race('resume-before-convert', hold(18, 12, decision='resume'), convert(18, 3), 'claim_changed')
race('convert-before-resume', convert(19, 4), hold(19, 13, decision='resume'), 'claim_changed')


def review(claim):
    return actor() + f"select public.admin_decide_order_claim('{uid('claim',claim)}','review',null);"


race('review-before-hold', review(20), hold(20, 14), 'claim_changed')
race('hold-before-review', hold(21, 15), review(21), 'claim_not_decidable')
race('revoke-before-hold', f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('user',1)}';", hold(22, 16), 'operator_capability_required')

assert sql("select count(*)from private.order_claim_hold_operations where order_id in(select hold_test.hold_id('order',n)from generate_series(1,22)n);") == '10'
assert sql("select count(*)from(select value from hold_test.before_orders except select to_jsonb(o)from public.orders o where id in(select hold_test.hold_id('order',n)from generate_series(1,22)n))difference;") == '0'
assert sql(f"select count(*)from public.audit_log where action='admin.order.claim_held' and diff->>'claimId'='{uid('claim',1)}';") == '1'
assert sql("select stock_qty from public.goods where id='claim-hold-good';") == '100'
print('PASS 10 durable receipts; type/revision conflicts; money and stock preserved', flush=True)

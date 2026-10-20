"""Claim withdrawal against receipt retries, approvals, collection and role revocation."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_claim_withdrawal_concurrency_'):
    raise SystemExit('Use the disposable claim withdrawal wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'claim-withdrawal-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'claim-withdrawal:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user', number)}',true);set local role authenticated;"


def withdraw(claim, operation, who=3, reason='합성 고객의 요청 철회 동의'):
    function = 'withdraw_my_order_claim' if who == 3 else 'admin_withdraw_order_claim'
    return actor(who) + f"select public.{function}('{uid('claim', claim)}','{uid('op', operation)}',0,'{reason}',true);"


def decide(claim, decision='review'):
    return actor() + f"select public.admin_decide_order_claim('{uid('claim', claim)}','{decision}','합성 동시 처리 근거');"


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
if sql("select to_regprocedure('public.admin_withdraw_order_claim(uuid,uuid,integer,text,boolean)') is null;") == 't':
    sql((root / 'migrations/20261013110000_order_claim_withdrawal.sql').read_text())
fixture = Path(__file__).with_name('order_claim_withdrawal.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.withdraw_id'):fixture.index('create temp table withdrawal_before')]
fixture = fixture.replace('generate_series(1,12)', 'generate_series(1,22)')
sql('begin;create schema withdrawal_test;grant usage on schema withdrawal_test to authenticated;' + fixture.replace('pg_temp.', 'withdrawal_test.') + 'commit;')
sql("update public.order_shipments set status='delivered',delivered_at=now()-interval '1 day' where order_id in(select withdrawal_test.withdraw_id('order',n)from generate_series(13,22)n);")
sql("create table withdrawal_test.before_money as select id,status,total,shipping_fee,discount_total,store_credit_total,shipping_fee_breakdown from public.orders where id in(select withdrawal_test.withdraw_id('order',n) from generate_series(1,22)n);")
race('same-operation', withdraw(1, 1), withdraw(1, 1))
race('two-actors', withdraw(2, 2), withdraw(2, 3, 1), 'claim_changed')
race('changed-payload', withdraw(3, 4), withdraw(3, 4, reason='다른 철회 본문'), 'claim_withdrawal_request_conflict')
race('read-waits-for-write', withdraw(4, 5), actor(3) + f"select public.read_my_order_claim_withdrawal('{uid('op', 5)}');")
race('review-before-withdraw', decide(11), withdraw(11, 6), 'claim_changed')
race('withdraw-before-review', withdraw(12, 7), decide(12), 'claim_not_decidable')
race('approve-before-withdraw', decide(13, 'approve'), withdraw(13, 8), 'claim_changed')
race('withdraw-before-approve', withdraw(14, 9), decide(14, 'approve'), 'claim_not_decidable')
# Real origin collection function and prepared origin-policy fixtures.
for n in (15, 16):
    sql('begin;' + decide(n, 'approve') + 'commit;')


def collect(claim):
    shipment = sql(f"select shipment_id from public.order_claim_collections where claim_id='{uid('claim', claim)}' order by shipment_id limit 1;")
    if not shipment:
        raise RuntimeError('Expected an origin collection fixture')
    return actor() + f"select public.admin_record_order_claim_origin_collection('{uid('claim', claim)}','{shipment}','합성 입고 확인');"


# Current revision follows the immutable revision trigger; replace the expected version.
def current_withdraw(claim, operation):
    revision = sql(f"select claim_revision from public.order_cancellation_requests where id='{uid('claim', claim)}';")
    return withdraw(claim, operation).replace(",0,'합성", f",{revision},'합성")


race('collection-before-withdraw', collect(15), current_withdraw(15, 10), 'claim_changed')
race('withdraw-before-collection', current_withdraw(16, 11), collect(16), 'claim_not_collectable')
race('finance-before-withdraw', f"select id from public.orders where id='{uid('order', 17)}' for update;insert into public.order_cancellation_claims(order_id,requested_by,previous_status)values('{uid('order', 17)}','{uid('user',3)}','delivered');", withdraw(17, 12), 'claim_withdrawal_finance_started')
race('revoke-before-withdraw', f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('user',1)}';", withdraw(18, 13, 1), 'operator_capability_required')
assert sql("select count(*)from private.order_claim_withdrawals where order_id in(select id from withdrawal_test.before_money);") == '7'
assert sql("select count(*) from withdrawal_test.before_money b join public.orders o using(id) where (b.status,b.total,b.shipping_fee,b.discount_total,b.store_credit_total,b.shipping_fee_breakdown) is distinct from (o.status,o.total,o.shipping_fee,o.discount_total,o.store_credit_total,o.shipping_fee_breakdown);") == '0'
assert sql(f"select count(*)from public.audit_log where id='{uid('op',1)}';") == '1'
assert sql("select stock_qty from public.goods where id='claim-withdrawal-good';") == '100'
print('PASS 7 accepted receipts; paid amounts, order statuses and stock unchanged; blocked writes absent', flush=True)

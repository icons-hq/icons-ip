"""Race customer-agreed seller intake against existing fulfillment gates."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_seller_cancel_concurrency_'):
    raise SystemExit('Use the disposable seller cancellation wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'seller-cancel-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'seller-cancel-race:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user', number)}',true);set local role authenticated;"


def payload_for(order, reason='합성 고객의 전체 취소 요청'):
    return json.dumps(dict(orderId=uid('order', order), claimType='cancel', reasonType='change_of_mind', reason=reason,
        source='phone', inquiryId=None, customerRequestedAt=request_time, agreementEvidence='동시성 검수용 전체 취소 합의', agreementConfirmed=True,
        collectionAddress=None, collections=[]), ensure_ascii=False)


def intake(order, request, who=1):
    return actor(who) + f"select public.admin_submit_seller_claim_intake('{uid('request', request)}','{payload_for(order)}');"


def readback(order, request, reason='합성 고객의 전체 취소 요청'):
    return actor() + f"select coalesce(public.admin_read_seller_claim_intake('{uid('request', request)}','{payload_for(order, reason)}')->>'requestId','unconfirmed');"


def confirm(order):
    return actor() + f"select public.admin_update_order_status('{uid('order', order)}','confirmed',null,null);"


def wait_state(name, expected, process):
    for _ in range(100):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: real lock wait observed; ' + ('rejected safely' if expected_error else 'committed'))
    return first_out, second_out


source = Path(__file__).with_name('admin_seller_cancel_intake.sql').read_text()
seed = source[source.index('create function pg_temp.cancel_id'):source.index('create function pg_temp.cancel_values')]
seed = seed.replace('seller-cancel-', 'seller-cancel-race-').replace('seller-cancel:', 'seller-cancel-race:').replace('generate_series(1,6)', 'generate_series(1,12)')
sql("begin;update private.operator_access_state set configured=false,revision=1 where id;delete from private.operator_memberships;" + seed +
    f"update public.profiles set role='admin' where id='{uid('user', 1)}';update private.operator_memberships set manager_role='owner' where profile_id='{uid('user', 1)}';"
    "update private.operator_access_state set configured=true where id;commit;")
request_time = sql("select to_char(now()-interval '5 minutes','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"');")
race('same-request', intake(1, 1), intake(1, 1))
assert sql(f"select count(*) from public.audit_log where target='order:{uid('order', 1)}' and action='admin.order.claim_intake_created';") == '1'
race('same-order', intake(5, 5), intake(5, 15, 3), 'already_requested')
race('confirmation-before-intake', confirm(6), intake(6, 6), 'not_cancelable')
race('intake-before-confirmation', intake(7, 7), confirm(7), 'order cancellation in progress')
race('export-before-intake', f"update public.order_shipments set exported_at=clock_timestamp() where order_id='{uid('order', 8)}';", intake(8, 8), 'not_cancelable')
race('revoke-before-intake', actor() + f"select public.admin_change_operator_role('{uid('user', 3)}',null,1,1,'{uid('operation', 1)}');", intake(9, 9, 3), 'operator_capability_required')
_, completed_read = race('submit-before-bound-read', intake(10, 10), readback(10, 10))
assert uid('request', 10) in completed_read[0]
missing_read, _ = race('unconfirmed-read-before-late-submit', readback(11, 11), intake(11, 11))
assert 'unconfirmed' in missing_read[0]
assert uid('request', 11) in sql('begin;' + readback(11, 11) + 'commit;')
race('changed-read-payload-after-submit', intake(12, 12), readback(12, 12, '처음 전송한 내용과 다른 사유'), 'seller_claim_request_conflict')
assert sql(f"select count(*) from public.order_cancellation_requests where id in('{uid('request', 6)}','{uid('request', 8)}','{uid('request', 9)}','{uid('request', 15)}');") == '0'
assert sql(f"select status from public.orders where id='{uid('order', 7)}';") == 'paid'
assert sql(f"select count(*) from public.order_cancellation_claims where order_id in('{uid('order', 1)}','{uid('order', 5)}','{uid('order', 7)}');") == '0'
print('PASS final readback: one request per order, no post-confirmation intake, no financial execution')

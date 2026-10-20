"""Real lock waits against one explicitly leased bank-refund test clone."""
import datetime
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

container, database, destination = sys.argv[1:]
assert re.fullmatch(r'[0-9a-f]{64}', container)
assert re.fullmatch(r'icons_(bank_refund|goods_transaction)_[0-9a-f]{32}', database)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1']
out = Path(destination)
out.mkdir(parents=True, exist_ok=True)
results, processes = [], []
prefix = 'br-' + uuid.uuid4().hex[:12]
def sql(body):
    result = subprocess.run(command, input="load 'safeupdate';" + body, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()
lease = json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;'))
assert lease['container_id'] == container and lease['source_database'] == 'postgres' and lease['lease'].replace('-', '') == database[-32:]
def uid(kind, n):
    return str(uuid.UUID(hashlib.md5(f'bank-transfer-refund:{kind}:{n}'.encode()).hexdigest()))
def actor(n=1):
    claims = json.dumps({'role': 'authenticated', 'sub': uid('user', n), 'session_id': uid('session', n)})
    return f"select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{claims}',true);set local role authenticated;"
def moment():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(n, op, kind='confirm_cancellation', revision=0, occurred=None, evidence='TEST race evidence'):
    return actor() + f"select public.admin_record_bank_transfer_refund('{uid('order',n)}','{uid('claim',n)}','{uid('race',op)}','{kind}',{revision},10000,'{occurred or moment()}','{evidence}','TEST-ONLY race; no external transfer',true,'{uid('user',1)}','{uid('session',1)}');"
def read(n, op, kind='confirm_cancellation', revision=0, seal=False):
    return actor() + f"select public.admin_read_bank_transfer_refund('{uid('order',n)}','{uid('claim',n)}','{uid('race',op)}','{kind}',{revision},10000,'{uid('user',1)}','{uid('session',1)}',{str(seal).lower()});"
def view(n, op, revision=2):
    # Only the view UUID reaches stdout. Plaintext is never written to a log.
    return actor() + f"select public.admin_view_bank_transfer_refund_account('{uid('order',n)}','{uid('claim',n)}','{uid('race-view',op)}',{revision},'{uid('user',1)}','{uid('session',1)}')->>'viewId';"
def prepare(n):
    sql('begin;' + write(n, 1000 + n) + 'commit;')
    sql('begin;' + write(n, 2000 + n, 'file_transfer', 1) + 'commit;')
def wait_state(name, state, process):
    for _ in range(160):
        current = sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';")
        if current == state:
            return
        if process.poll() is not None:
            raise RuntimeError(name + ' ended before lock observation: ' + str(process.communicate()))
        time.sleep(.02)
    raise RuntimeError(name + ' did not reach ' + state)
def race(label, first, second, error=None):
    names = [prefix + '-' + str(len(results)) + '-a', prefix + '-' + str(len(results)) + '-b']
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(one)
    one.stdin.write(f"load 'safeupdate';set application_name='{names[0]}';begin;set local lock_timeout='8s';{first}select pg_sleep(1.2);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(names[0], 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(two)
    two.stdin.write(f"load 'safeupdate';set application_name='{names[1]}';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(names[1], 'Lock', two)
    a, b = one.communicate(timeout=15), two.communicate(timeout=15)
    (out / (label + '-first.log')).write_text(a[0] + a[1])
    (out / (label + '-second.log')).write_text(b[0] + b[1])
    if one.returncode:
        raise RuntimeError(a[1])
    if error:
        if not two.returncode or error not in b[1]:
            raise RuntimeError('Expected ' + error + ': ' + str(b))
    elif two.returncode:
        raise RuntimeError(b[1])
    results.append({'case': label, 'actualLockWait': True, 'result': error or 'both-committed'})
    print('PASS ' + label, flush=True)
    return a[0], b[0]
def receipt(output):
    return next(json.loads(line) for line in output.splitlines() if line.startswith('{') and 'operationId' in line)
def restore_session():
    sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{uid('session',1)}','{uid('user',1)}',clock_timestamp(),clock_timestamp());")
try:
    now = moment()
    a, b = race('same-confirmation-operation', write(24, 1, occurred=now), write(24, 1, occurred=now))
    assert receipt(a) == receipt(b)
    now = moment()
    race('changed-confirmation-payload', write(25, 2, occurred=now), write(25, 2, occurred=now, evidence='OTHER proof'), 'bank_refund_request_conflict')
    race('competing-confirmation-cas', write(26, 3), write(26, 4), 'claim_changed')
    a, b = race('read-waits-for-confirmation', write(27, 5), read(27, 5))
    assert receipt(a) == receipt(b)
    race('seal-before-delayed-confirmation', read(28, 6, seal=True), write(28, 6), 'bank_refund_request_sealed')
    a, b = race('confirmation-before-seal', write(29, 7), read(29, 7, seal=True))
    assert receipt(a) == receipt(b)
    prepare(30)
    now = moment()
    a, b = race('same-transfer-operation', write(30, 8, 'complete_transfer', 2, now), write(30, 8, 'complete_transfer', 2, now))
    assert receipt(a) == receipt(b)
    prepare(31)
    race('competing-transfer-cas', write(31, 9, 'complete_transfer', 2), write(31, 10, 'complete_transfer', 2), 'claim_changed')
    prepare(32)
    race('account-view-before-transfer', view(32, 1), write(32, 11, 'complete_transfer', 2))
    prepare(33)
    race('transfer-before-account-view', write(33, 12, 'complete_transfer', 2), view(33, 2), 'claim_changed')
    assert sql(f"select count(*) from private.bank_transfer_refund_account_views where claim_id='{uid('claim',33)}'") == '0'
    prepare(34)
    race('accepted-view-before-session-revoke', view(34, 3), f"delete from auth.sessions where id='{uid('session',1)}';")
    restore_session()
    race('session-revoke-before-writer', f"delete from auth.sessions where id='{uid('session',1)}';", write(35, 13), 'refund_account_auth_changed')
    restore_session()
    revoke = f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update public.profiles set suspended_at=clock_timestamp(),suspension_reason='TEST revocation' where id='{uid('user',1)}';"
    race('capability-revoke-before-writer', revoke, write(36, 14), 'operator_capability_required')
    sql(f"update public.profiles set suspended_at=null,suspension_reason=null where id='{uid('user',1)}';")
    race('accepted-confirmation-before-capability-revoke', write(37, 15), revoke)
    sql(f"update public.profiles set suspended_at=null,suspension_reason=null where id='{uid('user',1)}';")
    deletion_check = f"select private.lock_operator_subjects(array['{uid('user',2)}'::uuid]);select exists(select 1 from jsonb_array_elements(private.account_deletion_blockers('{uid('user',2)}')) blocker where blocker->>'code'='active_order_refund');"
    _, b = race('confirmation-before-payer-deletion-check', write(38, 16), deletion_check)
    assert 't' in b.splitlines()
    for n in [24, 25, 26, 27, 29, 30, 31, 32, 33, 34, 37, 38]:
        assert sql(f"select stock_qty from public.goods where id='bank-refund-good-{n}'") == '100'
    for n in [28, 35, 36]:
        assert sql(f"select stock_qty from public.goods where id='bank-refund-good-{n}'") == '98'
    assert sql("select count(*) from private.bank_transfer_claim_refunds where order_id in(" + ','.join("'" + uid('order', n) + "'" for n in [30, 31, 32, 33]) + ") and state='completed'") == '4'
    assert sql("select count(*) from private.bank_transfer_refund_operations where id in(" + ','.join("'" + uid('race', n) + "'" for n in [8, 9, 11, 12]) + ") and kind='complete_transfer' and state='recorded'") == '4'
    report = {'status': 'PASS', 'cases': results, 'externalProviderCalls': 0, 'rawAccountPersistedToArtifact': False}
    (out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=5)

"""Real local PostgREST checks; only an explicitly leased disposable clone."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import datetime

container, database, destination = sys.argv[1:]
assert re.fullmatch(r'[0-9a-f]{64}', container)
assert re.fullmatch(r'icons_(bank_refund|goods_transaction)_[0-9a-f]{32}', database)
out = Path(destination)
out.mkdir(parents=True, exist_ok=True)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1']
def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError('Local HTTP fixture query failed')
    return result.stdout.strip()
lease = json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;'))
assert lease['container_id'] == container and lease['source_database'] == 'postgres' and lease['lease'].replace('-', '') == database[-32:]
identity = json.loads(subprocess.check_output(['docker', 'inspect', container], text=True))[0]
network, net = next(iter(identity['NetworkSettings']['Networks'].items()))
db_env = dict(value.split('=', 1) for value in identity['Config']['Env'] if '=' in value)
secret = secrets.token_hex(32)
env = {**os.environ, 'PGRST_DB_URI': 'postgresql://authenticator:' + urllib.parse.quote(db_env['POSTGRES_PASSWORD'], safe='') + '@' + net['IPAddress'] + ':5432/' + database,
       'PGRST_JWT_SECRET': secret, 'PGRST_DB_SCHEMAS': 'public', 'PGRST_DB_ANON_ROLE': 'anon', 'PGRST_SERVER_PORT': '3000'}
image = 'public.ecr.aws/supabase/postgrest:v14.14'
subprocess.run(['docker', 'image', 'inspect', image], capture_output=True, check=True)
rest_id = None
cases = []
def uid(kind, n):
    return str(uuid.UUID(hashlib.md5(f'bank-transfer-refund:{kind}:{n}'.encode()).hexdigest()))
def token(actor, session, role):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': role, 'sub': uid('user', actor), 'session_id': uid('session', session), 'exp': int(time.time()) + 600})
    return (body + b'.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).rstrip(b'=')).decode()
def request(rpc, payload, actor=1, session=1, role='authenticated', method='POST'):
    headers = {'Content-Type': 'application/json'}
    if actor is not None:
        headers['Authorization'] = 'Bearer ' + token(actor, session, role)
    path = '/rpc/' + rpc + ('?' + urllib.parse.urlencode(payload) if method == 'GET' else '')
    req = urllib.request.Request(origin + path, data=json.dumps(payload).encode() if method == 'POST' else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response), dict(response.headers)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read()), dict(error.headers)
def args(n):
    return {'p_order_id': uid('order', n), 'p_claim_id': uid('claim', n), 'p_expected_actor_id': uid('user', 1), 'p_expected_session_id': uid('session', 1)}
def write(n, op, kind, revision):
    return {**args(n), 'p_operation_id': uid('http-op', op), 'p_kind': kind, 'p_expected_revision': revision, 'p_expected_amount': 10000,
            'p_occurred_at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'p_evidence': 'TEST HTTP 증빙', 'p_note': 'TEST-ONLY 합성 확인. 외부 송금 없음.', 'p_confirmed': True}
def metadata(value, seal=False):
    return {key: field for key, field in value.items() if key not in ('p_occurred_at', 'p_evidence', 'p_note', 'p_confirmed')} | {'p_seal': seal}
def passed(name, status):
    cases.append({'case': name, 'status': status})
    print('PASS ' + name, flush=True)
context_rpc = 'admin_bank_transfer_refund_context'
write_rpc = 'admin_record_bank_transfer_refund'
read_rpc = 'admin_read_bank_transfer_refund'
view_rpc = 'admin_view_bank_transfer_refund_account'
try:
    command_args = ['docker', 'run', '-d', '--name', 'icons-bank-refund-http-' + uuid.uuid4().hex, '--network', network, '-p', '127.0.0.1::3000']
    for key in ['PGRST_DB_URI', 'PGRST_JWT_SECRET', 'PGRST_DB_SCHEMAS', 'PGRST_DB_ANON_ROLE', 'PGRST_SERVER_PORT']:
        command_args += ['-e', key]
    rest_id = subprocess.check_output(command_args + [image], env=env, text=True).strip()
    rest = json.loads(subprocess.check_output(['docker', 'inspect', rest_id], text=True))[0]
    origin = 'http://127.0.0.1:' + rest['NetworkSettings']['Ports']['3000/tcp'][0]['HostPort']
    for _ in range(100):
        try:
            with urllib.request.urlopen(origin + '/', timeout=.5) as response:
                if response.status == 200:
                    break
        except Exception:
            time.sleep(.1)
    else:
        raise RuntimeError('Local PostgREST was not ready')
    for method in ['GET', 'POST']:
        status, data, _ = request(context_rpc, args(22), method=method)
        assert status == 200 and data['confirmBlocker'] is None and 'accountNumber' not in data
        passed('current-admin-context-' + method, status)
    for actor, session in [(2, 2), (3, 3), (5, 5)]:
        payload = args(22) | {'p_expected_actor_id': uid('user', actor), 'p_expected_session_id': uid('session', session)}
        status, _, _ = request(context_rpc, payload, actor, session)
        assert status == 403
        passed('payer-recipient-logistics-denied-' + str(actor), status)
    status, _, _ = request(context_rpc, args(22), actor=None)
    assert status in (401, 403)
    passed('anonymous-denied', status)
    status, _, _ = request(context_rpc, args(22), role='service_role')
    assert status == 403
    passed('service-role-direct-rpc-denied', status)
    status, _, _ = request(context_rpc, args(22), session=2)
    assert status == 403
    passed('wrong-session-denied', status)
    confirm = write(22, 1, 'confirm_cancellation', 0)
    status, _, _ = request(write_rpc, confirm | {'p_expected_amount': 9999})
    assert status == 409
    passed('amount-cas-denied', status)
    status, saved, _ = request(write_rpc, confirm)
    assert status == 200 and saved['state'] == 'recorded' and saved['resultRevision'] == 1
    status, replay, _ = request(write_rpc, confirm)
    assert status == 200 and replay == saved
    passed('confirmation-exact-replay', status)
    status, _, _ = request(write_rpc, confirm | {'p_note': 'TEST changed body'})
    assert status == 409
    passed('changed-payload-denied', status)
    status, _, _ = request(write_rpc, confirm | {'p_operation_id': uid('http-op', 9)})
    assert status == 409
    passed('stale-revision-denied', status)
    status, replay, _ = request(read_rpc, metadata(confirm))
    assert status == 200 and replay == saved
    assert not {'accountNumber', 'accountHolder', 'requestHash', 'sessionId', 'evidence', 'note'} & replay.keys()
    passed('metadata-only-recovery', status)
    status, _, _ = request(write_rpc, write(22, 2, 'complete_transfer', 1))
    assert status == 400
    passed('unfiled-transfer-denied', status)
    filed = write(22, 3, 'file_transfer', 1)
    status, data, _ = request(write_rpc, filed)
    assert status == 200 and data['resultRevision'] == 2
    passed('file-after-cancellation', status)
    view = args(22) | {'p_view_id': uid('http-view', 1), 'p_expected_revision': 2}
    status, _, _ = request(view_rpc, view, method='GET')
    assert status == 405
    assert sql("select count(*) from private.bank_transfer_refund_account_views where claim_id='" + uid('claim', 22) + "'") == '0'
    passed('raw-account-GET-readonly-rejected', status)
    status, account, headers = request(view_rpc, view)
    assert status == 200 and account['accountNumber'] == '000000001234'
    assert 'no-store' in next(value for key, value in headers.items() if key.lower() == 'cache-control')
    assert sql("select count(*) from private.bank_transfer_refund_account_views where claim_id='" + uid('claim', 22) + "'") == '1'
    passed('raw-account-audit-committed-and-no-store', status)
    del account
    status, _, _ = request(view_rpc, view)
    assert status == 409
    passed('raw-account-never-replays-cached-payload', status)
    done = write(22, 4, 'complete_transfer', 2)
    status, completed, _ = request(write_rpc, done)
    assert status == 200 and completed['state'] == 'recorded'
    status, replay, _ = request(write_rpc, done)
    assert status == 200 and completed == replay
    passed('completion-exact-replay', status)
    status, context, _ = request(context_rpc, args(22))
    assert status == 200 and context['phase'] == 'completed'
    status, _, _ = request(view_rpc, view | {'p_view_id': uid('http-view', 2), 'p_expected_revision': completed['resultRevision']})
    assert status == 400
    passed('completed-account-view-denied', status)
    sealed = write(23, 5, 'confirm_cancellation', 0)
    status, data, _ = request(read_rpc, metadata(sealed, True))
    assert status == 200 and data['state'] == 'sealed'
    status, _, _ = request(write_rpc, sealed)
    assert status == 400
    passed('sealed-delayed-request-denied', status)
    sql("begin;select private.lock_operator_subjects(array['" + uid('user', 1) + "'::uuid]);update public.profiles set suspended_at=clock_timestamp(),suspension_reason='TEST revoke' where id='" + uid('user', 1) + "';commit;")
    status, _, _ = request(read_rpc, metadata(done))
    assert status == 403
    sql("update public.profiles set suspended_at=null,suspension_reason=null where id='" + uid('user', 1) + "';")
    passed('receipt-read-checks-current-capability', status)
    sql("delete from auth.sessions where id='" + uid('session', 1) + "';")
    status, _, _ = request(context_rpc, args(22))
    assert status == 403
    sql("insert into auth.sessions(id,user_id,created_at,updated_at) values('" + uid('session', 1) + "','" + uid('user', 1) + "',clock_timestamp(),clock_timestamp());")
    passed('revoked-session-denied', status)
    report = {'status': 'PASS', 'postgrestImage': image, 'cases': cases, 'externalProviderCalls': 0, 'rawAccountPersistedToArtifact': False}
    (out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
finally:
    if rest_id:
        subprocess.run(['docker', 'rm', '-f', rest_id], capture_output=True, check=True)

"""Exercise member consent races using only a named disposable local runtime.

Usage: python3 supabase/tests/member_activity_concurrency.py --runtime-json PATH
The runtime must contain the synthetic `other` account provisioned for this QA.
No credential or token is printed. The account ends declined with no raw events.
"""
import argparse
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid

parser = argparse.ArgumentParser()
parser.add_argument('--runtime-json', required=True)
args = parser.parse_args()
runtime = json.loads(Path(args.runtime_json).read_text())
assert runtime['projectId'].startswith('icons-ip-full-admin-')
container = runtime['databaseContainerId']
inspection = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
assert inspection['Name'] == '/supabase_db_' + runtime['projectId'] and inspection['State']['Running']
base = runtime['apiUrl']
assert urllib.parse.urlparse(base).hostname in ('127.0.0.1', '::1')
private = Path(runtime['workdir'])
config = json.loads((private / 'status.private.json').read_text())
account = next(row for row in json.loads((private / 'accounts.private.json').read_text()) if row['kind'] == 'other')
assert account['email'].startswith('full-other-') and account['email'].endswith('@example.test')

def request(path, payload=None, token=None):
    headers = {'apikey': config['ANON_KEY'], 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(base + path, headers=headers, data=body)
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

code, login = request('/auth/v1/token?grant_type=password', {'email': account['email'], 'password': account['password']})
assert code == 200 and login['user']['id'] == account['id'], 'Synthetic login failed'
token = login['access_token']

def rpc(name, payload):
    return request('/rest/v1/rpc/' + name, payload, token)

def state():
    code, value = rpc('member_activity_state', {})
    assert code == 200 and value['actorId'] == account['id'] and value['enabled'], 'Test collection must be enabled explicitly'
    return value

def choice(value, current):
    return rpc('set_member_activity_consent', {'p_choice': value, 'p_expected_revision': current['revision'],
        'p_expected_actor': current['actorId'], 'p_expected_session': current['sessionId'], 'p_notice_version': 'member-activity-v1'})

def count():
    sql = "select count(*) from private.member_activity_events where user_id='%s'::uuid" % str(uuid.UUID(account['id']))
    return int(subprocess.check_output(['docker', 'exec', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAtc', sql]))

results = []
try:
    for run in range(5):
        current = state()
        if current['choice'] == 'accepted':
            assert choice('declined', current)[0] == 200
            current = state()
        code, accepted = choice('accepted', current)
        assert code == 200
        barrier = threading.Barrier(13)
        def collect():
            barrier.wait(timeout=20)
            return rpc('record_member_activity_event', {'p_event_id': str(uuid.uuid4()), 'p_kind': 'visit', 'p_page_kind': 'home',
                'p_target_id': 'home', 'p_asset_id': None, 'p_expected_revision': accepted['revision'],
                'p_expected_actor': accepted['actorId'], 'p_expected_session': accepted['sessionId']})
        def withdraw():
            barrier.wait(timeout=20)
            return choice('declined', accepted)
        with concurrent.futures.ThreadPoolExecutor(max_workers=13) as pool:
            events = [pool.submit(collect) for _ in range(12)]
            revoked = pool.submit(withdraw)
            assert revoked.result()[0] == 200, 'Withdrawal failed'
            statuses = [event.result()[0] for event in events]
        assert all(status in (200, 403) for status in statuses), 'Unexpected collection response'
        assert count() == 0 and state()['choice'] == 'declined', 'Collection survived withdrawal'
        results.append({'round': run + 1, 'recordedBeforeWithdrawal': statuses.count(200), 'rejectedAfterWithdrawal': statuses.count(403), 'remainingEvents': 0})
finally:
    current = state()
    if current['choice'] != 'declined':
        assert choice('declined', current)[0] == 200
assert count() == 0
print(json.dumps({'passed': True, 'rounds': results, 'finalChoice': 'declined', 'remainingEvents': 0}, indent=2))

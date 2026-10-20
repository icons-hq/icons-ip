"""Use the named disposable QA runtime to test coupon issuance over real HTTP.
No credential is printed. Every coupon code and recipient is synthetic.
"""
import argparse
import base64
import concurrent.futures
import json
from pathlib import Path
import subprocess
import threading
import time
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
assert urllib.parse.urlparse(runtime['apiUrl']).hostname == '127.0.0.1'
private = Path(runtime['workdir'])
config = json.loads((private / 'status.private.json').read_text())
accounts = {row['kind']: row for row in json.loads((private / 'accounts.private.json').read_text())}

def sql(statement):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-qAt', '-v', 'ON_ERROR_STOP=1'], input=statement.encode(), capture_output=True, timeout=30)
    if result.returncode:
        raise RuntimeError(result.stderr.decode()[-1200:])
    return result.stdout.decode().strip()

def request(path, body, token=None):
    headers = {'apikey': config['ANON_KEY'], 'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    req = urllib.request.Request(runtime['apiUrl'] + path, headers=headers, data=json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)

tokens = {}
for kind in ['admin', 'other']:
    account = accounts[kind]
    assert account['email'].startswith('full-') and account['email'].endswith('@example.test')
    status, login = request('/auth/v1/token?grant_type=password', {'email': account['email'], 'password': account['password']})
    assert status == 200 and login['user']['id'] == account['id']
    tokens[kind] = login['access_token']
claims = json.loads(base64.urlsafe_b64decode(tokens['admin'].split('.')[1] + '=='))
identity = {'p_expected_actor': accounts['admin']['id'], 'p_expected_session': claims['session_id']}

def rpc(name, payload, kind='admin'):
    return request('/rest/v1/rpc/' + name, payload, tokens[kind])

def coupon(suffix, seconds=None):
    code = 'TARGET-' + uuid.uuid4().hex[:8].upper() + '-' + suffix
    end = "now()+interval '%s seconds'" % seconds if seconds else "now()+interval '1 day'"
    sql("insert into public.coupons(code,name,discount_type,discount_value,min_subtotal,starts_at,issue_starts_at,issue_ends_at,ends_at,status,issue_limit) values('%s','TEST HTTP 경쟁','fixed',1000,10000,now()-interval '1 day',now()-interval '1 day',%s,now()+interval '2 days','active',1)" % (code,end))
    return code

def prepare(code):
    batch = str(uuid.uuid4())
    status, result = rpc('admin_preview_coupon_issue', {'p_id': batch, 'p_coupon_code': code, 'p_targets': {'kind': 'customers', 'userIds': [accounts['buyer']['id']]}, **identity})
    assert status == 200 and result['status'] == 'prepared', (status,result)
    return batch

def execute(batch):
    return rpc('admin_execute_coupon_issue', {'p_id': batch, **identity})

def counts(code):
    return json.loads(sql("select jsonb_build_object('issued',c.issued_count,'held',(select count(*) from public.user_coupons where coupon_code=c.code)) from public.coupons c where code='%s'" % code))

first = coupon('ONCE'); batch = prepare(first)
barrier = threading.Barrier(10)
def concurrent_execute(_):
    barrier.wait(timeout=10)
    return execute(batch)
with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
    outcomes = list(pool.map(concurrent_execute, range(10)))
assert all(status == 200 and value['status'] == 'completed' and value['issuedCount'] == 1 for status,value in outcomes), outcomes
assert counts(first) == {'issued': 1, 'held': 1}
second = coupon('QUOTA'); batch2 = prepare(second); barrier = threading.Barrier(2)
def competing(kind):
    barrier.wait(timeout=10)
    return execute(batch2) if kind == 'batch' else rpc('claim_coupon_code', {'p_code': second}, 'other')
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
    quota = list(pool.map(competing, ['batch','claim']))
assert counts(second) == {'issued': 1, 'held': 1}, quota
assert quota[0][0] == 200 and ((quota[0][1]['status'] == 'completed' and quota[1][0] != 200) or (quota[0][1]['status'] == 'failed' and quota[0][1]['error'] == 'coupon_exhausted' and quota[1][0] == 200)), quota
third = coupon('CLOCK', 2); batch3 = prepare(third)
holder = subprocess.Popen(['docker','exec','-i',container,'psql','-X','-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
holder.stdin.write("begin; select 1 from public.coupons where code='%s' for update; select pg_backend_pid(); select pg_sleep(3); commit;\n" % third); holder.stdin.close()
assert holder.stdout.readline().strip() == '1'; pid = int(holder.stdout.readline().strip())
observed_wait = False
with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
    future = pool.submit(execute,batch3)
    for _ in range(30):
        observed_wait = sql("select exists(select 1 from pg_stat_activity where %s=any(pg_blocking_pids(pid)))" % pid) == 't'
        if observed_wait:
            break
        time.sleep(.05)
    expired = future.result(timeout=15)
holder.wait(timeout=5)
assert observed_wait and holder.returncode == 0
assert expired[0] == 200 and expired[1]['status'] == 'failed' and expired[1]['error'] in ['coupon_issue_ended','coupon_expired'], expired
assert counts(third) == {'issued': 0, 'held': 0}
print(json.dumps({'duplicateExecutionCalls':10,'duplicateExecution':counts(first),'batchVersusCodeEntry':counts(second),'batchOutcome':quota[0][1]['status'],'expiryAfterObservedRowLock':{'waitObserved':observed_wait,'outcome':expired[1]['status'],'error':expired[1]['error'],**counts(third)},'codes':[first,second,third]},indent=2))

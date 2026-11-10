"""Fulfillment-template races, restricted to this task's disposable admin runtime."""
import argparse
import concurrent.futures
import json
import re
import subprocess
import time
import uuid
from pathlib import Path

if not __debug__:
    raise SystemExit('Optimized Python is not allowed for database fixture tools')
parser = argparse.ArgumentParser()
parser.add_argument('--runtime-json', required=True)
parser.add_argument('--output', required=True)
args = parser.parse_args()
runtime = json.loads(Path(args.runtime_json).read_text())
assert runtime['existingDatabaseReset'] is False
assert re.fullmatch(r'icons-ip-full-admin-[a-f0-9]{8}', runtime['projectId'])
cid = runtime['databaseContainerId']
meta = json.loads(subprocess.check_output(['docker', 'inspect', cid]))[0]
assert meta['Id'] == cid and meta['Name'] == '/supabase_db_' + runtime['projectId'] and meta['State']['Running']
assert meta['Config']['Labels']['com.supabase.cli.project'] == runtime['projectId']
actor = next(a['id'] for a in runtime['accounts'] if a['kind'] == 'admin')
quote = lambda s: "'" + s.replace("'", "''") + "'"
js = lambda v: quote(json.dumps(v, ensure_ascii=False)) + '::jsonb'
command = ['docker', 'exec', '-i', cid, 'psql', '-XqAt', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1']

def execute(sql):
    return subprocess.run(command, input=sql, text=True, capture_output=True, timeout=20)

def sql(query):
    result = execute(query)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def read(query):
    return json.loads(sql(query).splitlines()[-1])

session = sql(f"select id from auth.sessions where user_id={quote(actor)} and (not_after is null or not_after>clock_timestamp()) order by created_at desc limit 1")
assert re.fullmatch(r'[a-f0-9-]{36}', session)
auth = 'set local role authenticated;set local request.jwt.claim.sub=' + quote(actor) + ';set local request.jwt.claims=' + js({'sub': actor, 'role': 'authenticated', 'session_id': session}).removesuffix('::jsonb') + ';'
run = uuid.uuid4().hex[:8]
prefix = 'stfc-' + run
ids = [prefix + '-a', prefix + '-b']
origin, template = str(uuid.uuid4()), str(uuid.uuid4())
policy = {'mode': 'no_delivery', 'methods': [{'method': 'none', 'feeAmount': 0, 'feeBasis': 'per_order', 'installationFee': 0}], 'publicNote': 'TEST 직접전달', 'evidence': 'TEST 동시 요청', 'confirmed': True}
settings = {'originId': origin, 'feeType': 'free', 'individualFee': 0, 'claimPolicy': dict.fromkeys(['returnAllowed', 'exchangeAllowed', 'restrictionReason', 'returnFee', 'returnFreeShippingFee', 'exchangeFee']), 'delivery': {'mode': 'preserve'}, 'chargeGroup': {'mode': 'preserve'}, 'fulfillment': {'mode': 'replace', 'policy': policy}}
identity = {'expectedActorId': actor, 'expectedSessionId': session}
save = {**identity, 'operationId': str(uuid.uuid4()), 'templateId': template, 'expectedRevision': 0, 'command': 'save', 'name': 'TEST 수령 경합 ' + run, 'enabled': True, 'settings': settings}
sql('begin;' + f"insert into public.ips(id,title,vertical_key) values({quote(prefix)},'TEST 수령 경합','character');insert into public.fulfillment_origins(id,code,name,base_fee,return_address,is_active) values({quote(origin)},{quote(prefix)},'TEST 수령 경합 출고지',0,'TEST 합성 주소',true);" + auth + ''.join('select public.admin_save_good(' + js({'id': good, 'ip_id': prefix, 'name': 'TEST ' + good, 'type': '문구', 'price': 10000, 'origin_id': origin}) + ');' for good in ids) + 'select public.admin_save_shipping_settings_template_v3(' + js(save) + ');commit;')

def request():
    p = read('begin;' + auth + f"select public.admin_preview_shipping_settings_template_v3({quote(template)},array[{','.join(quote(x) for x in ids)}],{quote(actor)},{quote(session)});commit;")
    omitted = {'name', 'code', 'editable', 'blocker', 'before', 'after', 'effectiveBefore', 'effectiveAfter'}
    return {**identity, 'operationId': str(uuid.uuid4()), 'templateId': template, 'expectedRevision': 1, 'command': 'apply', 'originUpdatedAt': p['origin']['updatedAt'], 'collectRevision': p['origin']['collectRevision'], 'collectVersionId': p['origin']['collectVersionId'], 'targetGroup': None, 'goods': [{k: v for k, v in row.items() if k not in omitted} for row in p['goods']]}

def apply(value):
    return execute('begin;' + auth + 'select public.admin_apply_shipping_settings_template_v3(' + js(value) + ');commit;')

def receipt(result):
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout.strip().splitlines()[-1])

def revisions():
    return read(f"select jsonb_agg(revision order by good_id) from private.goods_fulfillment_settings where good_id in ({','.join(quote(x) for x in ids)})")

checks = []
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
    same = request()
    results = list(pool.map(apply, [same] * 12))
    values = [receipt(r) for r in results]
    assert all(value == values[0] for value in values) and revisions() == [1, 1]
    checks.append({'name': 'same-operation-12', 'receipts': 12, 'revisions': [1, 1]})
    competing = request()
    results = list(pool.map(apply, [{**competing, 'operationId': str(uuid.uuid4())} for _ in range(8)]))
    assert sum(r.returncode == 0 for r in results) == 1 and revisions() == [2, 2]
    assert all(r.returncode == 0 or any(x in r.stderr for x in ['shipping_settings_goods_changed', 'shipping_settings_retry']) for r in results)
    checks.append({'name': 'competing-operation-8', 'applied': 1, 'rejected': 7})
    stale = request()
    name = prefix + '-manual-writer'
    manual = 'set application_name=' + quote(name) + ';begin;' + auth + 'select public.admin_save_goods_fulfillment(' + quote(ids[1]) + ',' + js({**policy, 'assetIds': [], 'publicNote': 'TEST 수동 변경'}) + ',2,' + quote(str(uuid.uuid4())) + ',' + quote(actor) + ',' + quote(session) + ');select pg_sleep(1.5);commit;'
    writer = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    try:
        writer.stdin.write(manual)
        writer.stdin.close()
        writer.stdin = None
        deadline = time.monotonic() + 5
        while sql('select coalesce(wait_event_type,\'\') from pg_stat_activity where application_name=' + quote(name)) != 'Timeout':
            assert writer.poll() is None and time.monotonic() < deadline
            time.sleep(.02)
        blocked = apply(stale)
        # A replacement-template detach also acquires the shared topology lock.
        # Waiting there then rejecting the stale revision is equally safe.
        assert blocked.returncode and any(code in blocked.stderr for code in ['shipping_settings_retry', 'shipping_settings_goods_changed']), (blocked.returncode, blocked.stderr)
        assert 'deadlock' not in blocked.stderr.lower()
        _, error = writer.communicate(timeout=5)
        assert writer.returncode == 0, error
        stale_result = apply(stale)
        assert stale_result.returncode and 'shipping_settings_goods_changed' in stale_result.stderr and revisions() == [2, 3]
        checks.append({'name': 'manual-editor-versus-template', 'partialWrite': False, 'revisions': [2, 3]})
    finally:
        if writer.poll() is None:
            writer.terminate()
            writer.communicate(timeout=5)
    sealed = request()
    context = {k: sealed[k] for k in ['operationId', 'command', 'templateId', 'expectedRevision', 'expectedActorId', 'expectedSessionId']}
    def race(index):
        return apply(sealed) if index % 2 else execute('begin;' + auth + 'select public.admin_seal_shipping_settings_operation(' + js(context) + ');commit;')
    values = [receipt(r) for r in pool.map(race, range(12))]
    assert all(v == values[0] for v in values)
    assert revisions() == ([2, 3] if values[0]['state'] == 'sealed' else [3, 4])
    checks.append({'name': 'seal-versus-apply-12', 'state': values[0]['state'], 'revisions': revisions()})
result = {'status': 'pass', 'projectId': runtime['projectId'], 'containerId': cid, 'run': run, 'goods': ids, 'templateId': template, 'checks': checks}
Path(args.output).write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps(result))

"""Exercise the actual group RPCs through PostgREST in a leased local clone."""
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

container, database, destination = sys.argv[1:]
assert re.fullmatch(r'[0-9a-f]{64}', container)
assert re.fullmatch(r'icons_(?:group_edges|goods_transaction)_[0-9a-f]{32}', database)
out = Path(destination)
out.mkdir(parents=True, exist_ok=True)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1']
def sql(query):
    result = subprocess.run(command, input=query, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
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
def uid(n):
    return 'a6150000-0000-4000-8000-' + str(n).zfill(12)
def token(actor, session, role):
    encode = lambda value: base64.urlsafe_b64encode(json.dumps(value, separators=(',', ':')).encode()).rstrip(b'=')
    body = encode({'alg': 'HS256', 'typ': 'JWT'}) + b'.' + encode({'role': role, 'sub': uid(actor), 'session_id': uid(100 + session), 'exp': int(time.time()) + 600})
    return (body + b'.' + base64.urlsafe_b64encode(hmac.new(secret.encode(), body, hashlib.sha256).digest()).rstrip(b'=')).decode()
def request(rpc, payload, actor=1, session=1, role='authenticated', method='POST'):
    headers = {'Content-Type': 'application/json'}
    if actor is not None:
        headers['Authorization'] = 'Bearer ' + token(actor, session, role)
    params = {key: json.dumps(value) if isinstance(value, (dict, list)) else value for key, value in payload.items()}
    path = '/rpc/' + rpc + ('?' + urllib.parse.urlencode(params) if method == 'GET' else '')
    req = urllib.request.Request(origin + path, data=json.dumps(payload).encode() if method == 'POST' else None, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())
def identity_args(actor=1):
    return {'p_expected_actor_id': uid(actor), 'p_expected_session_id': uid(100 + actor)}
def passed(name):
    cases.append({'case': name, 'status': 'PASS'})
    print('PASS ' + name, flush=True)
def ok(rpc, payload, **options):
    status, result = request(rpc, payload, **options)
    assert status == 200, (rpc, status, result)
    return result
preview_rpc = 'admin_preview_goods_group_conversion'
confirm_rpc = 'admin_confirm_goods_group_conversion'
read_rpc = 'admin_read_goods_group_conversion'
try:
    sql('select goods_group_edge_test.make_source(20);select goods_group_edge_test.make_source(21);')
    source_request = json.loads(sql('select goods_group_edge_test.request(20);'))
    command_args = ['docker', 'run', '-d', '--name', 'icons-group-http-' + uuid.uuid4().hex, '--network', network, '-p', '127.0.0.1::3000']
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
        result = ok('admin_get_goods_group_source', {'p_good_id': 'group-edge-20'}, method=method)
        assert result['goodId'] == 'group-edge-20' and len(result['variants']) == 3
        passed('source-reader-' + method)
    for label, options, expected in [('anonymous', {'actor': None}, (401, 403)), ('service-role', {'role': 'service_role'}, (403,)), ('customer', {'actor': 3, 'session': 3}, (403,))]:
        status, _ = request('admin_get_goods_group_source', {'p_good_id': 'group-edge-20'}, **options)
        assert status in expected, (label, status)
        passed(label + '-denied')
    payload = identity_args() | {'p_request': source_request}
    for label, body, options in [('mismatched-session', payload, {'session': 2}), ('mismatched-actor', payload | identity_args(2), {})]:
        status, _ = request(preview_rpc, body, **options)
        assert status == 403, (label, status)
        passed(label + '-denied')
    status, _ = request(preview_rpc, payload, method='GET')
    assert status == 405, status
    passed('preview-GET-cannot-write')
    preview = ok(preview_rpc, payload)
    assert preview['state'] == 'ready' and len(preview['plan']['unselectedOptions']) == 1
    passed('preview-real-HTTP')
    confirm = identity_args() | {'p_preview_id': preview['previewId'], 'p_operation_id': uid(8020)}
    assert ok(read_rpc, confirm | {'p_seal': False})['state'] == 'unresolved'
    receipt = ok(confirm_rpc, confirm)
    assert receipt['state'] == 'completed'
    assert ok(confirm_rpc, confirm) == receipt
    assert ok(read_rpc, confirm | {'p_seal': False}) == receipt
    assert sql("select count(*) from private.goods_group_operations where operation_id='" + uid(8020) + "'") == '1'
    passed('confirm-one-effect-exact-replay-and-metadata-recovery')
    status, _ = request(confirm_rpc, confirm | {'p_operation_id': uid(8021)})
    assert status == 409
    passed('different-operation-same-preview-does-not-convert-again')
    status, _ = request(read_rpc, confirm | identity_args(2) | {'p_seal': False}, actor=2, session=2)
    assert status == 409
    passed('other-operator-cannot-read-receipt')
    second_payload = identity_args() | {'p_request': json.loads(sql('select goods_group_edge_test.request(21);'))}
    second_preview = ok(preview_rpc, second_payload)
    sealed_args = identity_args() | {'p_preview_id': second_preview['previewId'], 'p_operation_id': uid(8022)}
    sealed = ok(read_rpc, sealed_args | {'p_seal': True})
    assert sealed['state'] == 'sealed' and ok(confirm_rpc, sealed_args) == sealed
    assert sql("select count(*) from private.goods_group_members where good_id='group-edge-21'") == '0'
    passed('seal-prevents-delayed-conversion')
    group = receipt['group']
    values = {'name': 'TEST HTTP 그룹 변경', 'optionNames': group['optionNames'], 'members': [{'goodId': m['goodId'], 'values': m['values']} for m in reversed(group['members'])]}
    change = identity_args() | {'p_group_id': group['id'], 'p_expected_revision': group['revision'], 'p_operation_id': uid(8030), 'p_values': values}
    changed = ok('admin_save_goods_group', change)
    assert changed['group']['revision'] == 2 and changed['group']['members'][0]['goodId'] == values['members'][0]['goodId']
    metadata = {key: value for key, value in change.items() if key != 'p_values'} | {'p_command': 'update', 'p_seal': False}
    assert ok('admin_read_goods_group_change', metadata) == changed
    assert ok('admin_save_goods_group', change) == changed
    status, _ = request('admin_save_goods_group', change | {'p_operation_id': uid(8031)})
    assert status == 409
    passed('structure-update-CAS-exact-replay-recovery')
    archived = ok('admin_archive_goods_group', identity_args() | {'p_group_id': group['id'], 'p_expected_revision': 2, 'p_operation_id': uid(8032)})
    assert archived['group']['archivedAt'] is not None and archived['group']['members'] == []
    create = identity_args() | {'p_group_id': uid(8033), 'p_expected_revision': 0, 'p_operation_id': uid(8034), 'p_values': values}
    created = ok('admin_save_goods_group', create)
    assert created['group']['revision'] == 1 and len(created['group']['members']) == 2
    assert ok('admin_get_goods_group', {'p_group_id': uid(8033)}, method='GET') == created['group']
    assert any(g['id'] == uid(8033) for g in ok('admin_search_goods_groups', {'p_query': 'TEST HTTP', 'p_page': 1, 'p_page_size': 30}, method='GET')['rows'])
    passed('archive-create-detail-list-HTTP-roundtrip')
    create_seal = identity_args() | {'p_group_id': uid(8035), 'p_expected_revision': 0, 'p_operation_id': uid(8036), 'p_command': 'create', 'p_seal': True}
    sealed = ok('admin_read_goods_group_change', create_seal)
    assert sealed['state'] == 'sealed'
    assert ok('admin_save_goods_group', {key: value for key, value in create_seal.items() if key not in ('p_command', 'p_seal')} | {'p_values': values}) == sealed
    passed('structure-seal-prevents-late-write')
    deputy_preview = ok(preview_rpc, second_payload | identity_args(2), actor=2, session=2)
    deputy_confirm = identity_args(2) | {'p_preview_id': deputy_preview['previewId'], 'p_operation_id': uid(8040)}
    assert ok(confirm_rpc, deputy_confirm, actor=2, session=2)['state'] == 'completed'
    def change_deputy_role(role, operation):
        revisions = json.loads(sql("select jsonb_build_array((select revision from private.operator_memberships where profile_id='" + uid(2) + "'),(select revision from private.operator_access_state where id));"))
        return ok('admin_change_operator_role', {'p_profile_id': uid(2), 'p_manager_role': role, 'p_expected_revision': revisions[0], 'p_expected_access_revision': revisions[1], 'p_operation_id': uid(operation)})
    change_deputy_role('logistics', 8041)
    status, _ = request(read_rpc, deputy_confirm | {'p_seal': False}, actor=2, session=2)
    assert status == 403
    change_deputy_role('deputy', 8042)
    passed('receipt-read-rechecks-current-capability')
    sql("update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='" + uid(101) + "';")
    status, _ = request(preview_rpc, payload)
    assert status == 403
    sql("update auth.sessions set not_after=clock_timestamp()+interval '2 hours' where id='" + uid(101) + "';")
    passed('expired-session-denied')
    sql("delete from auth.sessions where id='" + uid(101) + "';")
    status, _ = request(read_rpc, confirm | {'p_seal': False})
    assert status == 403
    sql("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('" + uid(101) + "','" + uid(1) + "',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '2 hours');")
    passed('revoked-session-denied')
    (out / 'result.json').write_text(json.dumps({'status': 'PASS', 'postgrestImage': image, 'cases': cases, 'externalCalls': 0}, ensure_ascii=False, indent=2) + '\n')
finally:
    if rest_id:
        subprocess.run(['docker', 'rm', '-f', rest_id], capture_output=True, check=True)

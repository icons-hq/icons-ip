"""Real concurrent address-book writers, restricted to disposable clones.

This intentionally commits synthetic fixtures. The caller must destroy the
disposable database afterwards; postgres and every normal local DB are refused.

Each case holds the first transaction open (pg_sleep) after its write, starts the
second writer, observes that the second one waits on a lock, and then checks the
committed result: one default address per member, the 10-entry limit, and that a
withdrawal fence (account_action_fences) and an address save never interleave.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import time

container, database, directory = sys.argv[1:]
assert os.environ.get('ADDRESS_BOOK_TEST_SCOPE') in ('ci', 'isolated-local'), 'Use the explicit CI/local wrapper scope'
assert re.fullmatch(r'icons_address_book_concurrency_[0-9]+_[0-9]+', database)
assert re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+', container)
identity = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .}}', container], text=True))
assert identity['State']['Running'] and identity['Config']['Labels']['com.supabase.cli.project'] == container.removeprefix('supabase_db_')
out = Path(directory)
out.mkdir(parents=True, exist_ok=True)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
members = {name: f'a7573000-0000-4000-8000-0000000000{index:02d}' for index, name in enumerate(
    ['switch', 'first', 'promote', 'limit', 'fence_after', 'fence_before'], start=1)}
results = []
pause = 'select pg_sleep(1.5);'


def run(sql, name):
    """One autocommit psql call. SET LOCAL needs a transaction, so callers wrap member writes with tx()."""
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=30)
    (out / (name + '.log')).write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(name + ': ' + result.stderr[-3000:])
    return result.stdout.strip()


def tx(body):
    return 'begin;' + body + 'commit;'


def as_member(member):
    return f"select set_config('request.jwt.claim.sub','{members[member]}',true);set local role authenticated;"


def address(n):
    return json.dumps({'recipientName': '동시성 회원', 'phone': f'0101234{n:04d}', 'postalCode': '04524', 'address1': f'서울 중구 세종대로 {n}'})


def save(member, label, n, make_default, entry_id='null'):
    assert "'" not in label
    return as_member(member) + f"select public.save_my_address_book_entry({entry_id},'{label}','{address(n)}'::jsonb,{str(make_default).lower()});reset role;"


def set_default(member, entry_id):
    return as_member(member) + f"select public.set_my_default_address_book_entry('{entry_id}');reset role;"


def entry_id(member, label):
    return run(f"select id from public.address_book_entries where user_id='{members[member]}' and label='{label}';", 'entry-id')


def book(member):
    raw = run(f"select coalesce(json_agg(json_build_object('label',label,'default',is_default) order by created_at,id),'[]') from public.address_book_entries where user_id='{members[member]}';", 'book')
    return json.loads(raw)


def start(body, name):
    log = (out / (name + '.log')).open('w')
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=log, text=True)
    process.stdin.write("begin;set local statement_timeout='12s';set local lock_timeout='8s';" + f"set local application_name='{name}';" + body + 'commit;')
    process.stdin.close()
    return process, log


def wait_state(name, expected, process):
    deadline = time.monotonic() + 7
    while time.monotonic() < deadline:
        state = run(f"select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') from pg_stat_activity where application_name='{name}';", 'state')
        if expected in state:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} finished before observed {expected}: ' + (out / (name + '.log')).read_text()[-3000:])
        time.sleep(0.025)
    raise RuntimeError(name + ' did not enter ' + expected)


def pair(name, first_body, second_body, expected_second):
    first_name, second_name = 'ab-race-' + name + '-a', 'ab-race-' + name + '-b'
    first, first_log = start(first_body, first_name)
    second = second_log = None
    try:
        wait_state(first_name, 'PgSleep', first)
        second, second_log = start(second_body, second_name)
        wait_state(second_name, 'Lock:', second)
        assert first.wait(timeout=15) == 0, (out / (first_name + '.log')).read_text()
        second_status = second.wait(timeout=15)
        second_text = (out / (second_name + '.log')).read_text()
        if expected_second is None:
            assert second_status == 0, second_text
        else:
            assert second_status != 0 and expected_second in second_text and '40P01' not in second_text, second_text
        results.append({'case': name, 'blockedSecondWriterObserved': True, 'secondError': expected_second, 'status': 'PASS'})
        print('PASS ' + name, flush=True)
    finally:
        for process, stream in ((first, first_log), (second, second_log)):
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=3)
            if stream:
                stream.close()


run('\n'.join(
    f"insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data) values('{uid}','authenticated','authenticated','l7-concurrency-{key.replace('_', '-')}@example.test','{{}}','{{}}');"
    for key, uid in members.items()), 'fixture')

# 1. 서로 다른 주소를 동시에 기본으로 지정 — 나중 요청이 앞 요청의 커밋을 기다리고, 끝나면 기본은 1개(나중 것)다.
run(tx(save('switch', 'A', 1, False) + save('switch', 'B', 2, False)), 'switch-fixture')
switch_a, switch_b = entry_id('switch', 'A'), entry_id('switch', 'B')
pair('default-switch', set_default('switch', switch_b) + pause, set_default('switch', switch_a), None)
assert book('switch') == [{'label': 'A', 'default': True}, {'label': 'B', 'default': False}], book('switch')

# 2. 빈 주소록에 동시에 두 개를 추가 — 둘 다 저장되고 기본은 먼저 커밋한 첫 주소 하나다.
pair('first-entries', save('first', 'A', 1, False) + pause, save('first', 'B', 2, False), None)
assert book('first') == [{'label': 'A', 'default': True}, {'label': 'B', 'default': False}], book('first')

# 3. 기본으로 지정하며 동시에 추가 — 기본은 나중에 커밋한 주소 하나다.
run(tx(save('promote', 'base', 1, False)), 'promote-fixture')
pair('default-inserts', save('promote', 'A', 2, True) + pause, save('promote', 'B', 3, True), None)
assert book('promote') == [{'label': 'base', 'default': False}, {'label': 'A', 'default': False}, {'label': 'B', 'default': True}], book('promote')

# 4. 9개에서 동시에 두 개 추가 — 하나만 들어가고 나머지는 상한으로 거절된다.
run(tx(''.join(save('limit', f'L{n}', n, False) for n in range(1, 10))), 'limit-fixture')
pair('limit', save('limit', 'tenth', 10, False) + pause, save('limit', 'eleventh', 11, False), 'address_book_full')
limit_book = book('limit')
assert len(limit_book) == 10 and sum(entry['default'] for entry in limit_book) == 1 and limit_book[-1]['label'] == 'tenth', limit_book


def fence(member, event):
    return (f"insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) "
            f"values('{event}','{members[member]}',gen_random_uuid(),'awaiting_email_intent');"
            f"insert into private.account_action_fences(subject_user_id,deletion_event_id) values('{members[member]}','{event}');")


# 5. 저장이 진행 중일 때 탈퇴 봉인이 들어온다 — 봉인 트리거가 저장 커밋을 기다렸다가 그 주소까지 지운다.
run(tx(save('fence_after', 'home', 1, False)), 'fence-after-fixture')
pair('fence-after-save', save('fence_after', 'office', 2, True) + pause, fence('fence_after', 'a7573000-0000-4000-8000-000000000101'), None)
assert book('fence_after') == [], book('fence_after')

# 6. 봉인이 먼저 잡힌 뒤의 저장 — 봉인 커밋을 기다렸다가 거절되고 아무것도 남지 않는다.
run(tx(save('fence_before', 'home', 1, False)), 'fence-before-fixture')
pair('save-after-fence', fence('fence_before', 'a7573000-0000-4000-8000-000000000102') + pause, save('fence_before', 'office', 2, False), 'account_deletion_write_fenced')
assert book('fence_before') == [], book('fence_before')

# 어느 회원도 기본 배송지가 2개 이상이 아니다(부분 유니크 인덱스와 RPC 잠금이 함께 지킨다).
assert run("select count(*) from (select user_id from public.address_book_entries where is_default group by user_id having count(*)>1) twice;", 'invariant') == '0'
(out / 'result.json').write_text(json.dumps({'status': 'PASS', 'disposableDatabase': database, 'tests': results}, indent=2))
print(json.dumps({'status': 'PASS', 'cases': [result['case'] for result in results]}), flush=True)

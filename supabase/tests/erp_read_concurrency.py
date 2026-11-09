"""ERP 읽기 안전 경계 — 먼저 시작해 늦게 커밋한 줄이 이어 읽기 커서 뒤로 영영 사라지지 않는다.

트리거 `set_updated_at` 은 트랜잭션 시작 시각(`now()`)을 쓰므로, 늦게 커밋한 줄의 시각이 이미 지나간 커서보다
앞에 놓일 수 있다. AX 처럼 마지막 줄을 커서로 저장하며 읽어도 두 번의 읽기를 합치면 몰의 최종 상태와 같아야 한다.
격리된 CI·로컬 DB 전용이다(픽스처를 커밋하고 끝에 지운다).
"""
import json
import os
import re
import subprocess
import time
import uuid

CONTAINER = os.environ['SUPABASE_DB_CONTAINER']
DATABASE = os.environ.get('PGDATABASE', 'postgres')
SCOPE = os.environ['ERP_READ_TEST_SCOPE']
if SCOPE == 'ci':
    assert os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
    assert CONTAINER == 'supabase_db_icons-ip' and DATABASE == 'postgres'
else:
    assert SCOPE == 'isolated-local'
    assert re.fullmatch(r'supabase_db_icons-ip-[a-z0-9-]+', CONTAINER), CONTAINER

PSQL = ['docker', 'exec', '-i', CONTAINER, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', DATABASE,
        '-At', '-v', 'ON_ERROR_STOP=1']
# 몰이 진행 중 트랜잭션 시작 시각에서 빼는 여유(마이그레이션의 erp_read_settled_before 와 같은 값) + 1초.
SETTLE_SECONDS = 6
SLOW_APP = 'erp-read-slow-writer-' + uuid.uuid4().hex[:8]


def sql(statement):
    return subprocess.check_output(PSQL + ['-c', statement], text=True).strip()


def read(after, where=None):
    """AX 쪽 서버 경로와 같은 권한으로, 이어 읽기를 그대로 부른다(5개 위치 인자는 수정 전 함수와도 호환된다)."""
    payload = json.dumps(after).replace("'", "''")
    filters = 'null' if where is None else "'" + json.dumps(where).replace("'", "''") + "'::jsonb"
    text = sql(
        "set role service_role; "
        f"select public.service_erp_read('public.orders', array['updated_at'], '{payload}'::jsonb, {filters}, 1000)"
    )
    return json.loads(text.splitlines()[-1])


def apply_page(mirror, page):
    """AX pullTable 처럼 줄을 PK 로 덮어쓰고, 마지막 줄 위치를 커서로 돌려준다."""
    for row in page['rows']:
        mirror[row['id']] = row['updated_at']
    last = page['rows'][-1] if page['rows'] else None
    return {'at': last['updated_at'], 'key': {'id': last['id']}} if last else None


buyer = str(uuid.uuid4())
slow_order = str(uuid.uuid4())
fast_order = str(uuid.uuid4())
start_at = '2026-01-01T00:00:00+00:00'
ids_literal = f"('{slow_order}','{fast_order}')"
sql(
    f"insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,encrypted_password)"
    f" values('{buyer}','authenticated','authenticated','erp-read-race@example.test',now(),'{{}}','{{}}','x');"
    f"insert into public.orders(id,user_id,status,total,address,created_at,updated_at,payment_method)"
    f" select id::uuid,'{buyer}','paid',1000,'{{}}'::jsonb,'{start_at}','{start_at}','card'"
    f" from (values ('{slow_order}'),('{fast_order}')) as fixture(id);"
)

slow = subprocess.Popen(
    ['docker', 'exec', '-i', '-e', f'PGAPPNAME={SLOW_APP}', CONTAINER, 'psql', '-X', '-q', '-U', 'supabase_admin', '-d', DATABASE,
     '-v', 'ON_ERROR_STOP=1'],
    stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
)
try:
    # 1) 느린 쓰기가 먼저 시작한다(이 줄의 updated_at 은 지금 시각으로 굳는다).
    slow.stdin.write(f"begin; update public.orders set total = total where id = '{slow_order}';\n")
    slow.stdin.flush()
    for _ in range(100):
        if sql(f"select count(*) from pg_stat_activity where application_name='{SLOW_APP}' and backend_xid is not null") == '1':
            break
        time.sleep(0.1)
    else:
        raise AssertionError('slow writer did not open its transaction')
    time.sleep(1.2)

    # 2) 뒤늦게 시작한 쓰기가 먼저 커밋한다.
    sql(f"update public.orders set total = total where id = '{fast_order}'")

    # 값으로 거른 읽기(바뀐 주문 다시 읽기)는 경계를 걸지 않고 지금 보이는 것을 돌려준다.
    filtered = read({'at': start_at, 'key': {'id': '00000000-0000-0000-0000-000000000000'}}, {'id': [fast_order]})
    assert [r['id'] for r in filtered['rows']] == [fast_order], filtered

    # 3) 첫 이어 읽기 — AX 는 돌려받은 마지막 줄의 위치를 저장한다.
    mirror = {}
    first_after = {'at': start_at, 'key': {'id': '00000000-0000-0000-0000-000000000000'}}
    cursor = apply_page(mirror, read(first_after)) or first_after

    # 4) 느린 쓰기가 커밋한다. 이 줄의 시각은 위 커서보다 앞에 놓일 수 있다.
    slow.stdin.write('commit;\n\\q\n')
    slow.stdin.flush()
    slow.stdin.close()
    slow.wait(timeout=20)
    assert slow.returncode == 0, slow.stderr.read()

    # 5) 몰이 진행 중 트랜잭션이 끝났음을 알 수 있을 때까지 기다린 뒤 이어 읽는다.
    time.sleep(SETTLE_SECONDS)
    while True:
        page = read(cursor)
        next_cursor = apply_page(mirror, page)
        if page.get('next') is None or next_cursor is None:
            break
        cursor = next_cursor

    final = dict(line.split('|') for line in sql(
        f"select id, to_jsonb(updated_at)#>>'{{}}' from public.orders where id in {ids_literal}"
    ).splitlines())
    assert mirror.get(fast_order) == final[fast_order], (mirror, final)
    assert mirror.get(slow_order) == final[slow_order], (
        'row committed late stayed behind the cursor forever', mirror, final)
    print('late-committing transaction: mirror matches the mall after two cursor reads')
finally:
    if slow.poll() is None:
        slow.kill()
    sql(
        f"delete from public.orders where id in {ids_literal};"
        f"delete from auth.users where id = '{buyer}';"
    )

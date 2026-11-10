"""Real PostgreSQL lock races for operational after-sales content in a disposable clone."""
import atexit
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_goods_after_sales_concurrency_'):
    raise SystemExit('Use the disposable goods after-sales wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'as-race-{os.getpid()}'
running = []
results = []


def cleanup_processes():
    for process in running:
        if process.poll() is None:
            process.terminate()


atexit.register(cleanup_processes)


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(number, kind=0):
    return f'94100000-0000-4000-{8000 + kind:04d}-{number:012d}'


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def actor(number=2):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"


def new_good(label):
    good = 'after-sales-race-' + label
    sql(f"insert into public.goods(id,ip_id,name,type,price) values('{good}','after-sales-race-ip','TEST-ONLY {label}','문구',1000);")
    return good


def save(good, operation, revision=0, text='최초 A/S 안내', operator=2, clear=False):
    values = json.dumps({'phone': '' if clear else '02-123', 'guide': '' if clear else text, 'sellerSpecialNotes': '' if clear else '합성 판매자 특이사항'}, ensure_ascii=False)
    return actor(operator) + f"select public.admin_save_goods_after_sales_content('{good}',{revision},'{uid(operation)}',{literal(values)}::jsonb);"


def clone(source, target, operation):
    return actor(3) + f"select public.admin_clone_good('{uid(operation)}','{source}','{target}',null,'TEST-ONLY 복제');"


def role_change(manager_role, operation):
    revision = sql(f"select revision from private.operator_memberships where profile_id='{uid(2)}';")
    access_revision = sql('select revision from private.operator_access_state where id;')
    return actor(1) + f"select public.admin_change_operator_role('{uid(2)}','{manager_role}',{revision},{access_revision},'{uid(operation)}');"


def template(template_id, operation, revision=0, text='동시 템플릿 안내', archived=False):
    values = json.dumps({'phone': '02-123', 'guide': text, 'sellerSpecialNotes': '합성 템플릿 특이사항'}, ensure_ascii=False)
    return actor() + f"select public.admin_save_goods_after_sales_template('{uid(template_id, 3)}',{literal(values)}::jsonb,{str(archived).lower()},{revision},'{uid(operation)}');"


def start(label, statements, delay=0):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    running.append(process)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local statement_timeout='12s';set local lock_timeout='8s';{statements}" + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close()
    process.stdin = None
    return process


def wait_state(label, expected, process, blocker=None):
    for _ in range(150):
        condition = f"application_name='{prefix}-{label}' and wait_event_type='{expected}'"
        if blocker:
            condition += f" and (select pid from pg_stat_activity where application_name='{prefix}-{blocker}')=any(pg_blocking_pids(pid))"
        if sql(f'select exists(select 1 from pg_stat_activity where {condition});') == 't':
            return
        if process.poll() is not None:
            raise RuntimeError(f'{label} exited before {expected}: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{label} never reached {expected} blocked by {blocker}')


def finish(process, expected_error=None):
    output, error = process.communicate(timeout=15)
    if expected_error:
        if not process.returncode or expected_error not in error:
            raise RuntimeError(f'Expected {expected_error}: {output} {error}')
    elif process.returncode:
        raise RuntimeError(error)
    return output


def race(label, first, second, expected_error=None):
    first_label, second_label = label + '-first', label + '-second'
    one = start(first_label, first, 1.5)
    wait_state(first_label, 'Timeout', one)
    two = start(second_label, second)
    wait_state(second_label, 'Lock', two, first_label)
    output_one = finish(one)
    output_two = finish(two, expected_error)
    results.append({'case': label, 'actualBlockingObserved': True, 'secondResult': expected_error or 'committed'})
    print(f'PASS {label}: observed first session blocking second; {expected_error or "committed"}', flush=True)
    return output_one, output_two


def assert_scalar(statement):
    if sql(statement) != 't':
        raise AssertionError(statement)


def assert_denied(statements, expected):
    process = start('denied-replay', statements)
    finish(process, expected)


# The wrapper restores the real schema and isolates every fixture and mutation.
sql(f"""begin;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('94100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','after-sales-race-'||n||'@example.test',now(),'{{"testFixture":"goods-after-sales-race"}}','{{}}' from generate_series(1,3)n;
 update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id::text like '94100000-0000-4000-8000-%';
 insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','deputy'),('{uid(3)}','deputy');
 update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}'
  and not exists(select 1 from private.operator_memberships where manager_role='owner');
 update private.operator_access_state set configured=true where id;
 insert into public.ips(id,title,vertical_key) values('after-sales-race-ip','TEST-ONLY 혜택 경합 IP','character');commit;
""")

good = new_good('same-operation')
one, two = race('same-operation', save(good, 1001), save(good, 1001))
assert [line for line in one.splitlines() if line.startswith('{')] == [line for line in two.splitlines() if line.startswith('{')]
assert_scalar(f"select (select revision=1 from private.goods_after_sales_content where good_id='{good}') and (select count(*)=1 from public.audit_log where id='{uid(1001)}');")

good = new_good('different-operation')
race('different-operation-cas', save(good, 1002), save(good, 2002, operator=3), 'goods_after_sales_changed')
assert_scalar(f"select (select revision=1 from private.goods_after_sales_content where good_id='{good}') and not exists(select 1 from public.audit_log where id='{uid(2002)}');")

source = new_good('clone-first')
sql('begin;' + save(source, 1105) + 'commit;')
race('clone-before-source-edit', clone(source, 'after-sales-race-clone-old', 1005), save(source, 2005, 1, '변경 뒤 안내'))
assert_scalar(f"select (select guide='최초 A/S 안내' and revision=1 from private.goods_after_sales_content where good_id='after-sales-race-clone-old') and (select guide='변경 뒤 안내' and revision=2 from private.goods_after_sales_content where good_id='{source}');")

source = new_good('edit-first')
sql('begin;' + save(source, 1106) + 'commit;')
race('source-edit-before-clone', save(source, 1006, 1, '복제 전 새 안내'), clone(source, 'after-sales-race-clone-new', 2006))
assert_scalar("select guide='복제 전 새 안내' and revision=1 from private.goods_after_sales_content where good_id='after-sales-race-clone-new';")

good = new_good('revoked-first')
race('role-revoked-before-save', role_change('logistics', 1007), save(good, 2007), 'operator_capability_required')
assert_scalar(f"select not exists(select 1 from private.goods_after_sales_content where good_id='{good}');")
sql('begin;' + role_change('deputy', 3007) + 'commit;')

good = new_good('save-before-revoked')
race('save-before-role-revoked', save(good, 1008), role_change('logistics', 2008))
assert_scalar(f"select revision=1 from private.goods_after_sales_content where good_id='{good}';")
assert_denied(save(good, 1008), 'operator_capability_required')
sql('begin;' + role_change('deputy', 3008) + 'commit;')

# A completed exact operation is still gated by the current authority after waiting.
race('role-revoked-before-exact-replay', role_change('logistics', 1009), save(good, 1008), 'operator_capability_required')
assert_scalar(f"select (select revision=1 from private.goods_after_sales_content where good_id='{good}') and (select count(*)=1 from public.audit_log where id='{uid(1008)}');")
sql('begin;' + role_change('deputy', 3009) + 'commit;')

one, two = race('template-same-operation', template(110, 1010), template(110, 1010))
assert [line for line in one.splitlines() if line.startswith('{')] == [line for line in two.splitlines() if line.startswith('{')]
assert_scalar(f"select revision=1 from private.goods_after_sales_templates where id='{uid(110,3)}';")
race('template-different-operation-cas', template(111, 1011), template(111, 2011), 'goods_after_sales_template_changed')
assert_scalar(f"select revision=1 from private.goods_after_sales_templates where id='{uid(111,3)}';")
race('template-archive-before-stale-edit', template(111, 1012, 1, archived=True), template(111, 2012, 1, '충돌 문구'), 'goods_after_sales_template_changed')
assert_scalar(f"select archived_at is not null and guide='동시 템플릿 안내' and revision=2 from private.goods_after_sales_templates where id='{uid(111,3)}';")

good = new_good('clear-before-stale-edit')
sql('begin;' + save(good, 1113) + 'commit;')
race('clear-before-stale-edit', save(good, 1013, 1, clear=True), save(good, 2013, 1, '옛 문구 수정', operator=3), 'goods_after_sales_changed')
assert_scalar(f"select phone='' and guide='' and revision=2 from private.goods_after_sales_content where good_id='{good}';")
race('cleared-content-versus-old-exact-replay', save(good, 1014, 2, clear=True), save(good, 1113))
assert_scalar(f"select (select phone='' and guide='' and revision=3 from private.goods_after_sales_content where good_id='{good}') and (select count(*)=1 from public.audit_log where id='{uid(1113)}');")

print(json.dumps({'cases': len(results), 'database': database, 'fixtures': 'disposable clone only; no Storage objects or payments', 'results': results}, ensure_ascii=False), flush=True)

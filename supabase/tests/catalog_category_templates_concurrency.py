"""Actual catalog-tree, operator and idempotency races in a disposable local clone."""
import atexit
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_category_templates_concurrency_'):
    raise SystemExit('Use the disposable category templates wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'category-template-{os.getpid()}'
processes, results = [], []


def cleanup():
    for process in processes:
        if process.poll() is None:
            process.terminate()


atexit.register(cleanup)


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(n):
    return f'94800000-0000-4000-8000-{n:012d}'


def actor(n=2):
    return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"


def start(label, statement, delay=0):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    processes.append(process)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local statement_timeout='12s';set local lock_timeout='8s';" + statement + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close()
    process.stdin = None
    return process


def wait_state(label, state, process, blocker=None):
    for _ in range(150):
        condition = f"application_name='{prefix}-{label}' and wait_event_type='{state}'"
        if blocker:
            condition += f" and (select pid from pg_stat_activity where application_name='{prefix}-{blocker}')=any(pg_blocking_pids(pid))"
        if sql(f'select exists(select 1 from pg_stat_activity where {condition})') == 't':
            return
        if process.poll() is not None:
            raise RuntimeError(f'{label} ended before blocking: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{label} did not reach {state}')


def finish(process, expected=None):
    output, error = process.communicate(timeout=15)
    if expected:
        if not process.returncode or expected not in error:
            raise RuntimeError(f'Expected {expected}: {output} {error}')
    elif process.returncode:
        raise RuntimeError(error)
    return output


def race(label, first, second, expected=None):
    first_label, second_label = label + '-first', label + '-second'
    one = start(first_label, first, 1.5)
    wait_state(first_label, 'Timeout', one)
    two = start(second_label, second)
    wait_state(second_label, 'Lock', two, first_label)
    first_result, second_result = finish(one), finish(two, expected)
    results.append({'case': label, 'actualBlockingObserved': True, 'secondResult': expected or 'committed'})
    print('PASS ' + label, flush=True)
    return first_result, second_result


def assert_true(statement):
    if sql(statement) != 't':
        raise AssertionError(statement)


def category(n):
    sql(f"insert into public.catalog_categories(id,code,name,depth,sort_order) values('{uid(n)}','qa-category-race-{n}','TEST-ONLY category {n}',1,0);")


def save(ids, operation, revision=0, archived=False, operator=2):
    items = json.dumps([{'categoryId': uid(n), 'revision': revision} for n in ids])
    return actor(operator) + f"select public.admin_save_catalog_category_templates('{items}'::jsonb,{str(archived).lower()},'{uid(operation)}');"


def child(parent, operation):
    return actor(3) + f"select public.admin_upsert_category('{uid(operation)}',null,'qa-category-race-child-{parent}','TEST-ONLY child','{uid(parent)}',0,null);"


def archive(n, operation):
    timestamp = sql(f"select updated_at from public.catalog_categories where id='{uid(n)}'")
    return actor(3) + f"select public.admin_archive_category('{uid(operation)}','{uid(n)}','{timestamp}');"


def change_role(role, operation):
    revision = sql(f"select revision from private.operator_memberships where profile_id='{uid(2)}'")
    access = sql('select revision from private.operator_access_state where id')
    return actor(1) + f"select public.admin_change_operator_role('{uid(2)}','{role}',{revision},{access},'{uid(operation)}');"


sql(f"""begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
select ('94800000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','category-race-'||n||'@example.test',now(),'{{"testFixture":"category-template-race"}}','{{}}' from generate_series(1,3)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id::text like '94800000-%';
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','deputy'),('{uid(3)}','deputy');
update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}' and not exists(select 1 from private.operator_memberships where manager_role='owner');
update private.operator_access_state set configured=true where id;
commit;""")
for number in list(range(101, 109)) + [110, 111, 112]:
    category(number)

one, two = race('same-operation', save([101], 1001), save([101], 1001))
assert [line for line in one.splitlines() if line.startswith('{')] == [line for line in two.splitlines() if line.startswith('{')]
assert_true(f"select revision=1 from private.catalog_category_templates where category_id='{uid(101)}'")
race('different-operation-cas', save([102], 1002), save([102], 2002, operator=3), 'category_templates_changed')
race('child-before-template', child(103, 1003), save([103], 2003), 'category_not_usable')
assert_true(f"select not exists(select 1 from private.catalog_category_templates where category_id='{uid(103)}')")
race('template-before-child', save([104], 1004), child(104, 2004))
assert_true(f"select (private.catalog_category_template_document('{uid(104)}')->>'usable')::boolean=false")
race('archive-before-template', archive(105, 1005), save([105], 2005), 'category_not_usable')
race('template-before-archive', save([106], 1006), archive(106, 2006))
assert_true(f"select (private.catalog_category_template_document('{uid(106)}')->>'usable')::boolean=false")
race('role-revoked-before-save', change_role('logistics', 1007), save([107], 2007), 'operator_capability_required')
sql('begin;' + change_role('deputy', 3007) + 'commit;')
race('save-before-role-revoked', save([108], 1008), change_role('logistics', 2008))
finish(start('revoked-replay', save([108], 1008)), 'operator_capability_required')
sql('begin;' + change_role('deputy', 3008) + 'commit;')
race('revoked-before-replay', change_role('logistics', 1009), save([108], 1008), 'operator_capability_required')
sql('begin;' + change_role('deputy', 3009) + 'commit;')
race('overlapping-batch-rolls-back', save([111, 112], 1010), save([110, 112], 2010, operator=3), 'category_templates_changed')
assert_true(f"select not exists(select 1 from private.catalog_category_templates where category_id='{uid(110)}') and not exists(select 1 from public.audit_log where id='{uid(2010)}')")
print(json.dumps({'cases': len(results), 'database': database, 'scope': 'disposable clone only', 'results': results}, ensure_ascii=False), flush=True)

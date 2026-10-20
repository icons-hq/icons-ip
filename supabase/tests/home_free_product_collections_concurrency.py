"""Real free-product save/capability/cross-kind cap races, confined to a disposable database."""
import atexit
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_home_products_concurrency_'):
    raise SystemExit('Use the disposable free-product wrapper')
command = ['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-qAt']
prefix = f'free-race-{os.getpid()}'
running, results = [], []

def cleanup_processes():
    for process in running:
        if process.poll() is None:
            process.terminate()
atexit.register(cleanup_processes)

def sql(statement):
    result = subprocess.run(command,input="load 'safeupdate';"+statement,text=True,capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(number, kind=0):
    return f'96400000-0000-4000-{8000+kind:04d}-{number:012d}'

def literal(value):
    return 'null' if value is None else "'"+str(value).replace("'","''")+"'"

def actor(number=2):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"

def payload(ids=None,layout='list',count=3):
    return {'layout':layout,'image_shape':'square','item_count':count,'good_ids':ids or []}


def save(number,operation,version=None,title='자유상품 원본',content=None,operator=2,kind='product_collection'):
    if content is None:
        content = payload(['kept-candidate','hidden-candidate']) if kind=='product_collection' else {'mosaic_title':'','mosaic_subtitle':'','slots':[{'good_id':None,'image_path':None} for _ in range(8)]}
    link = None if kind=='product_collection' else '/shop'
    return actor(operator)+f"select public.admin_save_home_curation('{uid(operation,3)}','{uid(number,2)}','{kind}',null,{literal(title)},null,{literal(link)},0,'2020-01-01',null,false,null,{literal(json.dumps(content,ensure_ascii=False))}::jsonb,{literal(version)});"


def role_change(role,operation):
    revision=sql(f"select revision from private.operator_memberships where profile_id='{uid(2)}';")
    access=sql('select revision from private.operator_access_state where id;')
    return actor(1)+f"select public.admin_change_operator_role('{uid(2)}','{role}',{revision},{access},'{uid(operation,3)}');"

def version(number):
    return sql(f"select updated_at from public.home_curations where id='{uid(number,2)}';")

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



# Only the disposable clone is emptied for deterministic global-cap scenarios.
sql(f"""begin;
 delete from public.home_curations where kind in ('product_collection','product_mosaic');
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('96400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','free-race-'||n||'@example.test',now(),'{{"testFixture":"home-free-products-race"}}','{{}}' from generate_series(1,3)n;
 update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id::text like '96400000-0000-4000-8000-%';
 insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','deputy'),('{uid(3)}','deputy');
 update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}'
 and not exists(select 1 from private.operator_memberships where manager_role='owner');
 update private.operator_access_state set configured=true where id;
 commit;""")

one,two=race('same-operation',save(1,1001),save(1,1001))
assert [line for line in one.splitlines() if line.strip()][-1]==[line for line in two.splitlines() if line.strip()][-1]
assert_scalar(f"select (select count(*)=1 from public.home_curations where id='{uid(1,2)}') and (select count(*)=1 from public.audit_log where id='{uid(1001,3)}');")
race('create-cas',save(2,1002),save(2,2002,operator=3),'curation_conflict')
assert_scalar(f"select not exists(select 1 from public.audit_log where id='{uid(2002,3)}');")
prior=version(1)
race('layout-change-cas',save(1,1003,prior,'풀이미지',payload(['hidden','candidate-a','candidate-b'],'full_image',1)),save(1,2003,prior,'뒤늦은 목록',operator=3),'curation_conflict')
assert_scalar(f"select title='풀이미지' and payload->>'layout'='full_image' and payload->'good_ids'='[\"hidden\",\"candidate-a\",\"candidate-b\"]'::jsonb from public.home_curations where id='{uid(1,2)}';")
prior=version(1)
race('empty-vs-stale',save(1,1004,prior,'빈 목록',payload()),save(1,2004,prior,'옛 후보',operator=3),'curation_conflict')
sql('begin;'+save(1,1001)+'commit;')
assert_scalar(f"select title='빈 목록' and payload->'good_ids'='[]'::jsonb from public.home_curations where id='{uid(1,2)}';")

layout_revision=sql('select revision from public.home_layout_settings where singleton;')
layout_blocks=[{'key':key,'enabled':True} for key in ['hero','editor_picks','category_best','popular','benefits',f'products:{uid(1,2)}']]
def save_layout(operation,blocks):
    return actor()+f"select public.admin_save_home_layout('{uid(operation,3)}',{layout_revision},{literal(json.dumps(blocks))}::jsonb);"
race('global-layout-cas',save_layout(1008,layout_blocks),save_layout(2008,list(reversed(layout_blocks))),'home_layout_conflict')

race('revoke-before-save',role_change('logistics',1005),save(3,2005),'operator_capability_required')
assert_scalar(f"select not exists(select 1 from public.home_curations where id='{uid(3,2)}');")
sql('begin;'+role_change('deputy',3005)+'commit;')
race('save-before-revoke',save(4,1006),role_change('logistics',2006))
assert_scalar(f"select exists(select 1 from public.home_curations where id='{uid(4,2)}');")
assert_denied(save(4,1006),'operator_capability_required')
sql('begin;'+role_change('deputy',3006)+'commit;')
race('revoke-before-replay',role_change('logistics',1007),save(4,1006),'operator_capability_required')
sql('begin;'+role_change('deputy',3007)+'commit;')

for offset,first_kind,second_kind in [(20,'product_collection','product_mosaic'),(40,'product_mosaic','product_collection')]:
    sql("delete from public.home_curations where kind in ('product_collection','product_mosaic');")
    for number in range(offset,offset+4):
        sql('begin;'+save(number,1100+number,kind='product_collection' if number%2 else 'product_mosaic')+'commit;')
    loser=offset+11
    race('cap-collection-first' if first_kind=='product_collection' else 'cap-mosaic-first',save(offset+10,2000+offset,kind=first_kind),save(loser,3000+offset,kind=second_kind),'home_free_product_limit')
    assert_scalar(f"select (select count(*)=5 from public.home_curations where kind in ('product_collection','product_mosaic')) and not exists(select 1 from public.audit_log where id='{uid(3000+offset,3)}');")

sql("delete from public.home_curations where kind in ('product_collection','product_mosaic');")
for number in range(60,64):
    sql('begin;'+save(number,1100+number)+'commit;')
privileged=f"insert into public.home_curations(id,kind,title,link_path,active_from,enabled,payload) values('{uid(71,2)}','product_collection','직접 추가',null,'2020-01-01',false,{literal(json.dumps(payload()))}::jsonb);"
race('cap-direct-writer',save(70,2070),privileged,'home_free_product_limit')
assert_scalar("select count(*)=5 from public.home_curations where kind in ('product_collection','product_mosaic');")

print(json.dumps({'cases':len(results),'database':database,'fixtures':'disposable clone only; no Storage or source DB writes','results':results},ensure_ascii=False),flush=True)

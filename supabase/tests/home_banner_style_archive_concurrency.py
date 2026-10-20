"""Real banner save/capability/cap races, confined to a disposable database."""
import atexit
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_home_banner_archive_race_'):
    raise SystemExit('Use the disposable banner wrapper')
command = ['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-qAt']
prefix = f'banner-archive-race-{os.getpid()}'
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
    return f'96600000-0000-4000-{8000+kind:04d}-{number:012d}'

def literal(value):
    return 'null' if value is None else "'"+str(value).replace("'","''")+"'"

def actor(number=2):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"

def image(number):
    return 'public-media/catalog/curation/'+uid(number,1)+'.webp'

def save(number,operation,version=None,title='배너 원본',payload=None,operator=2,link='/shop'):
    content = 'null' if payload is None else literal(json.dumps(payload,ensure_ascii=False))+'::jsonb'
    return actor(operator)+f"select public.admin_save_home_curation('{uid(operation,3)}','{uid(number,2)}','hero',null,{literal(title)},'{image(number)}',{literal(link)},0,'2026-01-01',null,true,null,{content},{literal(version)});"

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
 delete from public.home_curations where kind='hero';
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('96600000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','banner-archive-race-'||n||'@example.test',now(),'{{"testFixture":"home-banner-race"}}','{{}}' from generate_series(1,3)n;
 update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id::text like '96600000-0000-4000-8000-%';
 insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','deputy'),('{uid(3)}','deputy');
 update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}'
 and not exists(select 1 from private.operator_memberships where manager_role='owner');
 update private.operator_access_state set configured=true where id;
 insert into public.admin_artwork_upload_claims(path,actor_id,kind,mime_type,source_size,final_size,status,expires_at,processing_started_at,verified_at)
 select 'catalog/curation/96600000-0000-4000-8001-'||lpad(n::text,12,'0')||'.webp','{uid(2)}','curation','image/webp',1024,1024,'verified',now()+interval '1 hour',now(),now() from generate_series(1,100)n;
 commit;""")


def archive(number,operation,stamp,archived=True,operator=2):
    return actor(operator)+f"select public.admin_set_home_banner_archived('{uid(operation,3)}','{uid(number,2)}',{literal(stamp)},{str(archived).lower()});"

def run(statements):
    return sql('begin;'+statements+'commit;')

run(save(1,101))
initial=version(1)
race('save-before-archive',save(1,102,initial,title='먼저 저장'),archive(1,103,initial), 'curation_conflict')
current=version(1)
race('archive-before-save',archive(1,104,current),save(1,105,current,title='뒤늦은 저장'), 'curation_archived')
assert_scalar(f"select archived_at is not null and title='먼저 저장' from public.home_curations where id='{uid(1,2)}';")
race('same-archive-receipt',archive(1,104,current),archive(1,104,current))
assert_scalar(f"select count(*)=1 from public.audit_log where id='{uid(104,3)}';")
archived=version(1)
race('restore-before-edit',archive(1,106,archived,False),save(1,107,archived,title='오래된 복구 편집'), 'curation_conflict')
restored=version(1)
run(archive(1,108,restored))
run(save(2,202))
for n in range(3,11):run(save(n,n+200))
# Nine registered banners; both restore and create compete for slot ten.
race('restore-before-add',archive(1,109,version(1),False),save(11,211),'home_hero_limit')
assert_scalar("select count(*)=10 from public.home_curations where kind='hero' and archived_at is null;")
# Exiting the count pool releases one slot before a waiting new registration.
race('archive-before-add',archive(2,220,version(2)),save(11,211))
run(archive(3,230,version(3)))
race('add-before-restore',save(12,212),archive(2,221,version(2),False),'home_hero_limit')
# Both entry and exit hold the same pool, yet no pool holder locks another row.
run(archive(4,240,version(4)))
race('add-before-archive',save(13,213),archive(5,250,version(5)))
assert_scalar("select count(*)=9 from public.home_curations where kind='hero' and archived_at is null;")
race('restore-before-archive',archive(2,222,version(2),False),archive(6,260,version(6)))
race('archive-before-restore',archive(7,270,version(7)),archive(3,231,version(3),False))
# Current authority still wins before an old exact archive receipt is returned.
race('revoke-before-restore',role_change('logistics',301),archive(4,241,version(4),False),'operator_capability_required')
assert_denied(archive(1,108,restored),'operator_capability_required')
run(role_change('deputy',302))
race('restore-before-revoke',archive(4,241,version(4),False),role_change('logistics',303))
run(role_change('deputy',304))
# A pre-existing installation over the new cap remains editable without pruning.
# Only this disposable clone simulates old rows by disabling the count trigger.
sql(f"begin;alter table public.home_curations disable trigger trg_home_curations_updated;{save(14,214)}reset role;alter table public.home_curations enable trigger trg_home_curations_updated;commit;")
assert_scalar("select count(*)=11 from public.home_curations where kind='hero' and archived_at is null;")
run(save(14,314,version(14),title='기존 초과 배너 편집'))
run(archive(14,315,version(14)))
assert_denied(archive(14,316,version(14),False),'home_hero_limit')
assert_scalar("select count(*)=10 from public.home_curations where kind='hero' and archived_at is null;")
results.append({'case':'legacy-over-cap-edit-archive-preservation','passed':True})
print(json.dumps({'status':'PASS','cases':results},ensure_ascii=False,indent=2),flush=True)

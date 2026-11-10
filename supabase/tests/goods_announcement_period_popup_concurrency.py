"""Real announcement CAS, selection, receipt and authority races in a disposable database."""
import atexit
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_notice_popup_race_'):
    raise SystemExit('Use the disposable announcement popup wrapper')
command = ['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-qAt']
prefix = f'notice-popup-race-{os.getpid()}'
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
    return f'97100000-0000-4000-{8000+kind:04d}-{number:012d}'

def literal(value):
    return 'null' if value is None else "'"+str(value).replace("'","''")+"'"

def actor(number=2):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"

def values(title='공지 원본',intent='preserve'):
    return {'title':title,'body':'합성 공지 본문','format':'plain','category':'general','device':'all','enabled':True,
      'important':True,'allGoods':True,'goodIds':[],'startsAt':None,'endsAt':None,'importantStartsAt':None,'importantEndsAt':None,
      'popupStartsAt':'2020-01-01T00:00:00Z' if intent=='set' else None,'popupEndsAt':'2099-01-01T00:00:00Z' if intent=='set' else None}

def save(number,operation,expected=0,intent='preserve',global_revision=None,title='공지 원본',operator=2):
    content=literal(json.dumps(values(title,intent),ensure_ascii=False))+'::jsonb'
    return actor(operator)+f"select public.admin_save_goods_announcement_v2('{uid(operation,3)}','{uid(number,2)}',{expected},{content},{literal(intent)},{literal(global_revision)});"

def legacy(number,expected,title,operator=2):
    content=values(title);[content.pop(key) for key in ['importantStartsAt','importantEndsAt','popupStartsAt','popupEndsAt']]
    return actor(operator)+f"select public.admin_save_goods_announcement('{uid(number,2)}',{expected},{literal(json.dumps(content,ensure_ascii=False))}::jsonb);"

def result(operation,operator=2):
    return actor(operator)+f"select coalesce(public.admin_get_goods_announcement_save_result('{uid(operation,3)}')::text,'NULL');"

def revision(number):
    return int(sql(f"select revision from public.goods_announcements where id='{uid(number,2)}';"))

def global_revision():
    return int(sql('select revision from private.home_announcement_popup where singleton;'))

def role_change(role,operation):
    revision=sql(f"select revision from private.operator_memberships where profile_id='{uid(2)}';")
    access=sql('select revision from private.operator_access_state where id;')
    return actor(1)+f"select public.admin_change_operator_role('{uid(2)}',{literal(role)},{revision},{access},'{uid(operation,3)}');"

def start(label, statements, delay=0, commit=True):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    running.append(process)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local statement_timeout='12s';set local lock_timeout='8s';{statements}" + (f'select pg_sleep({delay});' if delay else '') + ('commit;' if commit else 'rollback;'))
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


# No source database is changed. This synthetic scope exists only in the clone.
sql(f"""begin;
 update private.home_announcement_popup set announcement_id=null,starts_at=null,ends_at=null,dismiss_key=null,revision=0 where singleton;
 delete from public.goods_announcements where id is not null;
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 select ('97100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','notice-popup-race-'||n||'@example.test',now(),'{{"testFixture":"notice-popup-race"}}','{{}}' from generate_series(1,3)n;
 update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id::text like '97100000-0000-4000-8000-%';
 insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','deputy'),('{uid(3)}','deputy');
 update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}'
 and not exists(select 1 from private.operator_memberships where manager_role='owner');
 update private.operator_access_state set configured=true where id;
 commit;""")

def run(statement):return sql('begin;'+statement+'commit;')

def unblocked(label,first,second):
    one=start(label+'-first',first,3)
    wait_state(label+'-first','Timeout',one)
    two=start(label+'-second',second)
    finish(two)
    if one.poll() is not None:raise RuntimeError('First transaction no longer owns its lock during independence proof')
    finish(one)
    results.append({'case':label,'secondCommittedWhileFirstStillOpen':True})
    print('PASS '+label+': independent second committed while first transaction still held its locks',flush=True)

race('same-operation',save(1,101,0,'set',0),save(1,101,0,'set',0))
assert_scalar(f"select count(*)=1 from public.audit_log where id='{uid(101,3)}';")
race('same-notice-cas',save(1,102,1,title='첫 수정'),save(1,103,1,title='오래된 수정',operator=3),'goods_announcement_changed')
g=global_revision()
race('two-notice-set-cas',save(1,104,revision(1),'set',g),save(2,201,0,'set',g,operator=3),'goods_announcement_popup_changed')
assert_scalar(f"select not exists(select 1 from public.goods_announcements where id='{uid(2,2)}');")
# Both directions demonstrate the preserve intent does not acquire the singleton.
unblocked('set-before-preserve',save(2,201,0,'set',global_revision()),save(1,105,revision(1),title='B 선택 중 A 수정',operator=3))
assert_scalar(f"select announcement_id='{uid(2,2)}'::uuid from private.home_announcement_popup where singleton;")
unblocked('preserve-before-set',save(1,106,revision(1),title='A 별도 편집'),save(2,202,revision(2),'set',global_revision(),operator=3))
g=global_revision()
race('set-before-old-clear',save(2,203,revision(2),'set',g),save(1,107,revision(1),'clear',g,operator=3),'goods_announcement_popup_changed')
assert_scalar(f"select title='A 별도 편집' from public.goods_announcements where id='{uid(1,2)}';")
g=global_revision()
race('clear-before-old-set',save(2,204,revision(2),'clear',g),save(1,108,revision(1),'set',g,operator=3),'goods_announcement_popup_changed')
assert_scalar('select announcement_id is null from private.home_announcement_popup where singleton;')
r=revision(1)
race('legacy-before-v2',legacy(1,r,'구 API 먼저'),save(1,109,r,title='새 API 늦게',operator=3),'goods_announcement_changed')
r=revision(1)
race('v2-before-legacy',save(1,110,r,title='새 API 먼저'),legacy(1,r,'구 API 늦게',operator=3),'goods_announcement_changed')
# Result lookup waits for a committed receipt and does not race its owner.
one,two=race('result-after-commit',save(3,301,0),result(301))
assert uid(3,2) in two
# The same read lock also waits for rollback, then returns no committed result.
one=start('result-rollback-first',save(4,401,0),1.5,False)
wait_state('result-rollback-first','Timeout',one)
two=start('result-rollback-second',result(401));wait_state('result-rollback-second','Lock',two,'result-rollback-first')
finish(one);output=finish(two);assert output.strip().endswith('NULL')
assert_scalar(f"select not exists(select 1 from public.goods_announcements where id='{uid(4,2)}');")
results.append({'case':'result-after-rollback','actualBlockingObserved':True,'result':None})
print('PASS result-after-rollback: observed blocker and null only after rollback',flush=True)
# An early null result is not a terminal cancellation: a later original request
# can still commit. The client must retain the fixed request when a read is null.
assert run(result(501)).endswith('NULL')
run(save(5,501,0));assert uid(5,2) in run(result(501))
results.append({'case':'null-before-delayed-original','nullIsNotTerminal':True})
r=revision(3)
race('same-op-different-payload',save(3,302,r,title='원 요청'),save(3,302,r,title='변조 요청'),'operation_conflict')
race('revoke-before-write',role_change(None,901),save(6,601,0),'operator_capability_required')
assert_denied(result(101),'operator_capability_required')
sql(f"begin;update public.profiles set role='staff' where id='{uid(2)}';insert into private.operator_memberships(profile_id,manager_role) values('{uid(2)}','deputy');commit;")
race('write-before-revoke',save(6,601,0),role_change(None,903))
assert_denied(result(601),'operator_capability_required')
print(json.dumps({'status':'PASS','cases':results},ensure_ascii=False,indent=2),flush=True)

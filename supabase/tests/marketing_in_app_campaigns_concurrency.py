"""Actual SQL lock waits in the wrapper's isolated clone; no provider or external messages."""
import json
import os
import subprocess
import time
container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_marketing_messages_concurrency_'):
    raise SystemExit('Use the disposable marketing concurrency database')
command = ['docker','exec','-i',container,'psql','-X','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-qAt']
prefix = f'marketing-race-{os.getpid()}'
def sql(statement):
    result = subprocess.run(command,input=statement,text=True,capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr)
    return result.stdout.strip()
def uid(n): return f'bfc02000-0000-4000-8000-{n:012d}'
def actor(n=2): return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"
def values():
    return "jsonb_build_object('name','메시지 경합','segmentId','"+uid(100)+"','segmentRevision',1,'content','{\"template\":\"text\",\"title\":\"경합 안내\",\"body\":\"합성 알림\",\"imagePath\":null,\"goodIds\":[],\"buttons\":[]}'::jsonb,'schedule',jsonb_build_object('kind','once','at',(((statement_timestamp() at time zone 'Asia/Seoul')::date+1)+time '10:00') at time zone 'Asia/Seoul'),'exclusion','none')"
def save(n,op,publish=True,rev=0,who=2): return actor(who)+f"select public.admin_save_marketing_campaign('{uid(n)}',{rev},'{uid(op)}',{values()},{str(publish).lower()},'{uid(102)}');"
def worker(n,actual=False): return f"select private.process_marketing_run(id,{('null' if actual else 'scheduled_at')}) from private.marketing_runs where campaign_id='{uid(n)}';"
def prepare(n):
    sql('begin;'+save(n,n+1000)+'commit;')
    sql(worker(n))
def count(n,state): return sql(f"select count(*) from private.marketing_recipients rec join private.marketing_runs runs on runs.id=rec.run_id where runs.campaign_id='{uid(n)}' and rec.state='{state}';")
def wait_state(name, expected, process):
    for _ in range(120):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None, expected_wait=True):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.8);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    if expected_wait: wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: ' + ('actual lock wait; ' if expected_wait else 'locked run skipped; ') + ('rejected safely' if expected_error else 'committed'))

sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('bfc02000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','marketing-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,3)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role when id='{uid(2)}' then 'staff'::public.user_role else 'user'::public.user_role end,nickname='mkt_race_'||right(id::text,2),birth_date='1990-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true,"marketing":true}}' where id::text like 'bfc02000-%';
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) select 'marketing-race-ip','마케팅 경합 IP',key from public.verticals limit 1;
insert into public.ip_follows(user_id,ip_id) values('{uid(3)}','marketing-race-ip');
{actor()}select public.admin_estimate_customer_segment('{{"version":1,"target":"ip_notifications","ipId":"marketing-race-ip"}}','{uid(102)}');
select public.admin_save_customer_segment('{uid(100)}',0,'{uid(103)}','경합 고객','{{"version":1,"target":"ip_notifications","ipId":"marketing-race-ip"}}','{uid(102)}');reset role;commit;""")
race('same-publication',save(201,301),save(201,301))
assert sql(f"select count(*) from private.marketing_runs where campaign_id='{uid(201)}';")=='1'
sql('begin;'+save(202,302,False)+'commit;')
race('same-draft-revision',save(202,303,False,1),save(202,304,False,1,1),'marketing_campaign_changed')
prepare(203)
race('duplicate-worker',worker(203),worker(203))
assert count(203,'sent')=='1'
prepare(204)
race('consent-before-send',f"update public.profiles set consents=consents||'{{\"marketing\":false}}' where id='{uid(3)}';",worker(204))
assert count(204,'sent')=='0' and count(204,'excluded')=='1'
sql(f"update public.profiles set consents=consents||'{{\"marketing\":true}}' where id='{uid(3)}';")
prepare(205)
race('send-before-consent-withdrawal',worker(205),f"update public.profiles set consents=consents||'{{\"marketing\":false}}' where id='{uid(3)}';")
assert count(205,'sent')=='1'
sql(f"update public.profiles set consents=consents||'{{\"marketing\":true}}' where id='{uid(3)}';")
prepare(206)
race('revoke-before-send',actor(1)+f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(305)}');",worker(206))
assert count(206,'sent')=='0' and sql(f"select state from private.marketing_runs where campaign_id='{uid(206)}';")=='blocked'
sql(f"update public.profiles set role='staff' where id='{uid(2)}';insert into private.operator_memberships(profile_id,manager_role) values('{uid(2)}','primary');")
prepare(207)
race('segment-change-before-send',f"update private.customer_segments set revision=revision+1 where id='{uid(100)}';",worker(207))
assert count(207,'sent')=='0'
sql(f"update private.customer_segments set revision=1 where id='{uid(100)}';")
sql('begin;'+save(208,308)+'commit;')
race('cancel-before-start',actor(1)+f"select public.admin_change_marketing_campaign('{uid(208)}',1,'{uid(309)}','cancel');",worker(208),expected_wait=False)
assert sql(f"select state from private.marketing_runs where campaign_id='{uid(208)}';")=='canceled'
sql('begin;'+save(209,310)+'commit;')
race('start-before-cancel',worker(209),actor(1)+f"select public.admin_change_marketing_campaign('{uid(209)}',1,'{uid(311)}','cancel');",'marketing_nothing_to_cancel')
assert sql(f"select state from private.marketing_runs where campaign_id='{uid(209)}';")=='processing'
sql('begin;'+save(210,312)+'commit;')
sql(f"update private.marketing_runs set scheduled_at=clock_timestamp()-interval '59 minutes 59 seconds' where campaign_id='{uid(210)}';")
race('deadline-during-actor-lock',f"select private.lock_operator_subjects(array['{uid(2)}'::uuid]);",worker(210,True))
assert sql(f"select state from private.marketing_runs where campaign_id='{uid(210)}';")=='expired'
assert count(210,'sent')=='0'
print('PASS ten lock races: unique sends, consent order, revoked sender, definition changes, cancellation, and actual elapsed deadline')

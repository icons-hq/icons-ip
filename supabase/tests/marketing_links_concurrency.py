"""Exercise real competing transactions only in the wrapper's disposable clone."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_marketing_links_concurrency_'):
    raise SystemExit('Use a dedicated icons_marketing_links_concurrency_ database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'marketing-links-{os.getpid()}'

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(n):
    return f'87000000-0000-4000-8000-{n:012d}'

def actor(n):
    return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"

def issue(target, op, who=1):
    return actor(who) + f"select public.admin_issue_marketing_links('good',array['{target}'],'{uid(op)}');"

def wait_state(name, expected, process):
    for _ in range(100):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')

def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: lock wait observed; ' + ('denied safely' if expected_error else 'committed'))

sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('87000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','marketing-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','deputy');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key)select 'marketing-race-ip','동시성 합성 IP',key from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) select 'marketing-race-'||n,'marketing-race-ip','동시성 합성 상품 '||n,'문구',1000 from generate_series(1,5)n;
commit;""")
race('same-target', issue('marketing-race-1', 101), issue('marketing-race-1', 102, 2))
assert sql("select count(*) from private.marketing_links where good_id='marketing-race-1';") == '1'
race('same-operation', issue('marketing-race-2', 103), issue('marketing-race-2', 103))
assert sql(f"select count(*) from public.audit_log where id='{uid(103)}';") == '1'
race('operation-conflict', issue('marketing-race-3', 104), issue('marketing-race-4', 104), 'operation_conflict')
assert sql("select count(*) from private.marketing_links where good_id='marketing-race-4';") == '0'
race('issue-before-draft-rename', issue('marketing-race-4', 105), "update public.goods set id='marketing-race-renamed' where id='marketing-race-4';")
assert sql("select good_id from private.marketing_links where original_target_id='marketing-race-4';") == 'marketing-race-renamed'
race('revoke-before-issue', actor(1) + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(107)}');", issue('marketing-race-5', 106, 2), 'operator_capability_required')
assert sql("select count(*) from private.marketing_links where good_id='marketing-race-5';") == '0'
assert sql("select count(*) from private.marketing_links where original_target_id like 'marketing-race-%';") == '4'
print('PASS final readback: four immutable links, one audit per operation, no unauthorized link')

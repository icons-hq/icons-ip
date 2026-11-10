"""Exercise real competing transactions only in the wrapper's disposable clone."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_product_experience_concurrency_'):
    raise SystemExit('Use a dedicated icons_product_experience_concurrency_ database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'product-experience-{os.getpid()}'

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(n):
    return f'92300000-0000-4000-8000-{n:012d}'

def actor(n):
    return f"load 'safeupdate';select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"

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

def save(section, revision, operation, who=1):
    values = f"(public.admin_get_product_detail_experiences()->'values'->'{section}')"
    return actor(who) + f"select public.admin_save_product_detail_experiences('{section}',{values},{revision},'{uid(operation)}');"

sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('92300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','experience-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','deputy');
update private.operator_access_state set configured=true where id;
update private.product_detail_experience_settings set revision=0 where section in('messages','discovery');
commit;""")
sql('begin read only;' + actor(1) + 'select public.admin_get_product_detail_experiences();commit;')
print('PASS read-only-admin-get: current capability check works in a REST-style read transaction')
race('same-section-cas', save('messages', 0, 101), save('messages', 0, 102, 2), 'product_detail_experience_conflict')
race('same-operation-replay', save('messages', 1, 103), save('messages', 1, 103))
assert sql(f"select count(*) from public.audit_log where id='{uid(103)}';") == '1'

name = f'{prefix}-independent-section'
one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
one.stdin.write(f"set application_name='{name}';begin;{save('messages', 2, 104)}select pg_sleep(3);commit;")
one.stdin.close(); one.stdin = None
wait_state(name, 'Timeout', one)
sql("begin;set local lock_timeout='500ms';" + save('discovery', 0, 105, 2) + 'commit;')
assert one.poll() is None
result = one.communicate(timeout=8)
assert one.returncode == 0, result
print('PASS independent-section: discovery committed while messages row stayed locked')
race('operation-conflict', save('discovery', 1, 108), save('messages', 3, 108), 'operation_conflict')
race('revoke-before-save', actor(1) + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(301)}');", save('messages', 3, 109, 2), 'operator_capability_required')
assert sql("select revision from private.product_detail_experience_settings where section='messages';") == '3'
assert sql("select revision from private.product_detail_experience_settings where section='discovery';") == '2'
assert sql("select count(*) from public.audit_log where id::text like '92300000-0000-4000-8000-%' and action='admin.product_detail_experience.updated';") == '5'
print('PASS final readback: section revisions 3/2, five audit receipts, no stale or revoked save')

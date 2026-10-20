"""Verify release idempotency and competing operations in a disposable DB."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_restriction_release_concurrency_'):
    raise SystemExit('Use the disposable restriction release wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'restriction-release-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(number):
    return f'89100000-0000-7000-8000-{number:012d}'


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"


def release(ids, operation, who=1):
    targets = ','.join(f"'{uid(n)}'::uuid" for n in ids)
    return actor(who) + f"select public.admin_release_purchase_restrictions('{uid(operation)}',array[{targets}],'동시성 검수 해제');"


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
    print(f'PASS {label}: real lock wait observed; ' + ('rejected safely' if expected_error else 'committed'))


sql(f"""begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('89100000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','restriction-race-'||n||'@example.test','{{}}','{{}}',now(),now() from generate_series(1,12)n;
update public.profiles set role='staff' where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','primary'),('{uid(2)}','primary');
insert into public.goods_purchase_restrictions(id,user_id,reason_code,reason_detail,created_by)
select ('89100000-0000-7000-8000-'||lpad((n+100)::text,12,'0'))::uuid,('89100000-0000-7000-8000-'||lpad(n::text,12,'0'))::uuid,'other','합성 제한','{uid(1)}' from generate_series(3,12)n;
commit;""")
race('same-operation', release([103], 201), release([103], 201))
assert sql(f"select count(*) from public.audit_log where id='{uid(201)}';") == '1'
race('overlapping-reversed-targets', release([104, 105], 202), release([105, 104], 203, 2))
assert sql(f"select count(*) from jsonb_array_elements((select diff->'result'->'rows' from public.audit_log where id='{uid(203)}'))r where r->>'outcome'='already_released';") == '2'
race('single-before-bulk', actor(2)+f"select public.admin_release_purchase_restriction('{uid(106)}','단일 해제');", release([106],204))
assert sql(f"select diff->'result'->'rows'->0->>'outcome' from public.audit_log where id='{uid(204)}';") == 'already_released'
race('release-before-register', release([107],205), actor(2)+f"select public.admin_register_purchase_restriction('{uid(307)}','{uid(7)}','other','새 합성 제한',null);")
sql('begin;'+release([107],205)+'commit;')
assert sql(f"select count(*) from public.goods_purchase_restrictions where user_id='{uid(7)}' and released_at is null;") == '1'
race('dispatch-before-read', release([108],206), actor()+f"select public.admin_get_purchase_restriction_release('{uid(206)}');")
race('cross-actor-operation', release([109],207), release([109],207,2),'operation_conflict')
race('revoke-before-release', f"update private.operator_memberships set manager_role='logistics' where profile_id='{uid(1)}';", release([110],208),'operator_capability_required')
assert sql(f"select released_at is null from public.goods_purchase_restrictions where id='{uid(110)}';") == 't'
assert sql(f"select count(*) from public.audit_log where id='{uid(208)}';") == '0'
print('PASS final receipts, unchanged new restriction, revoked operator and single audits')

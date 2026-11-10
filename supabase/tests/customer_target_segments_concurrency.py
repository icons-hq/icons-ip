"""Real lock waits and committed-state assertions in the wrapper's disposable DB."""
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_customer_segments_concurrency_'):
    raise SystemExit('Use the dedicated disposable customer segment database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'customer-segments-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(n):
    return f'bfc01700-0000-4000-8000-{n:012d}'


def actor(n=1):
    return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"


def favorite(segment, who=2):
    return actor(who) + f"select public.admin_set_customer_segment_favorite('{uid(segment)}',true);"


def archive(segment, operation, revision=1):
    payload = json.dumps([dict(id=uid(segment), revision=revision)])
    return actor() + f"select public.admin_archive_customer_segments('{payload}','{uid(operation)}');"


def save(segment, operation, who=1, revision=0):
    return actor(who) + f"select public.admin_save_customer_segment('{uid(segment)}',{revision},'{uid(operation)}','세그먼트 경합 {operation}','{{\"version\":1,\"target\":\"first_purchase\"}}','{uid(300+who)}');"


def wait_state(name, expected, process):
    for _ in range(120):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None):
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
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: actual lock wait; ' + ('rejected safely' if expected_error else 'committed'))


sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('bfc01700-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','segment-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','primary');
update private.operator_access_state set configured=true where id;
{actor(1)}select public.admin_estimate_customer_segment('{{"version":1,"target":"first_purchase"}}','{uid(301)}');reset role;
{actor(2)}select public.admin_estimate_customer_segment('{{"version":1,"target":"first_purchase"}}','{uid(302)}');reset role;
commit;""")
for n in range(101, 107):
    sql('begin;' + save(n, n+100) + 'commit;')
sql('begin;' + favorite(101) + favorite(102) + 'commit;')
race('favorite-limit', favorite(103), favorite(104), 'customer_segment_favorite_limit')
assert sql(f"select count(*) from private.customer_segment_favorites where actor_id='{uid(2)}';") == '3'
sql(f"delete from private.customer_segment_favorites where actor_id='{uid(2)}';")
race('favorite-before-archive', favorite(101), archive(101, 401))
assert sql(f"select count(*) from private.customer_segment_favorites where segment_id='{uid(101)}';") == '0'
race('archive-before-favorite', archive(102, 402), favorite(102), 'customer_segment_not_found')
assert sql(f"select count(*) from private.customer_segment_favorites where segment_id='{uid(102)}';") == '0'
race('same-operation', save(107, 403), save(107, 403))
assert sql(f"select revision from private.customer_segments where id='{uid(107)}';") == '1'
assert sql(f"select count(*) from public.audit_log where id='{uid(403)}';") == '1'
race('same-revision', save(103, 404, revision=1), save(103, 405, who=2, revision=1), 'customer_segment_changed')
assert sql(f"select revision from private.customer_segments where id='{uid(103)}';") == '2'
race('revoke-before-favorite', actor() + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(406)}');", favorite(106), 'operator_capability_required')
assert sql(f"select count(*) from private.customer_segment_favorites where segment_id='{uid(106)}';") == '0'
assert sql(f"select count(*) from public.audit_log where id='{uid(405)}';") == '0'
print('PASS committed readback: max three, archived favorites absent, exactly one version winner, revoked actor blocked')

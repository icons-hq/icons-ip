"""Observe real PostgreSQL lock waits in the wrapper's disposable clone."""
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_shopping_stories_concurrency_'):
    raise SystemExit('Use a dedicated icons_shopping_stories_concurrency_ database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'shopping-stories-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(n):
    return f'88000000-0000-4000-8000-{n:012d}'


def actor(n=1):
    return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"


def values(title='동시성 검수', images=None):
    return json.dumps(dict(title=title, bodyHtml='<p>동시성 검수 본문</p>', imagePaths=images or [], startsAt=None, endsAt=None, sections=[]), ensure_ascii=False)


def save(story, revision, operation, title='동시성 검수', who=1, images=None):
    payload = values(title, images).replace("'", "''")
    return actor(who) + f"select public.admin_save_shopping_story('{uid(story)}',{revision},'{uid(operation)}','{payload}');"


def delete(story, revision, operation):
    payload = json.dumps([dict(id=uid(story), revision=revision)])
    return actor() + f"select public.admin_delete_shopping_stories('{uid(operation)}','{payload}');"


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
    print(f'PASS {label}: lock wait observed; ' + ('rejected safely' if expected_error else 'committed'))


sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('88000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','story-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','deputy');
update private.operator_access_state set configured=true where id;
commit;""")
race('same-operation', save(101, 0, 201), save(101, 0, 201))
assert sql(f"select revision from public.shopping_stories where id='{uid(101)}';") == '1'
assert sql(f"select count(*) from public.audit_log where id='{uid(201)}';") == '1'
race('same-revision', save(101, 1, 202, '먼저 저장'), save(101, 1, 203, '늦은 저장', 2), 'shopping_story_conflict')
assert sql(f"select title||':'||revision from public.shopping_stories where id='{uid(101)}';") == '먼저 저장:2'
race('save-before-delete', save(101, 2, 204), delete(101, 2, 205), 'shopping_story_conflict')
assert sql(f"select deleted_at is null from public.shopping_stories where id='{uid(101)}';") == 't'
race('delete-before-save', delete(101, 3, 206), save(101, 3, 207), 'shopping_story_not_found')
assert sql(f"select revision||':'||(deleted_at is not null)::text from public.shopping_stories where id='{uid(101)}';") == '4:true'
image_path = f'catalog/curation/{uid(301)}.webp'
sql(f"""begin;set local role service_role;
select public.service_prepare_admin_artwork_upload('{uid(1)}','{image_path}','curation','image/webp',100,now()+interval '10 minutes');
select * from public.service_begin_admin_artwork_verification('{uid(1)}','{image_path}');
select public.service_verify_admin_artwork_upload('{uid(1)}','{image_path}',100);
commit;""")
race('single-use-image', save(102, 0, 208, images=['public-media/' + image_path]), save(103, 0, 209, images=['public-media/' + image_path]), 'unverified_artwork')
assert sql(f"select count(*) from public.shopping_stories where id='{uid(103)}';") == '0'
race('revoke-before-save', actor() + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(210)}');", save(104, 0, 211, who=2), 'operator_capability_required')
assert sql(f"select count(*) from public.shopping_stories where id='{uid(104)}';") == '0'
assert sql(f"select count(*) from public.audit_log where id in('{uid(203)}','{uid(205)}','{uid(207)}','{uid(209)}','{uid(211)}');") == '0'
print('PASS final readback: one audited winner, stale operations absent, deleted story never resurrected')

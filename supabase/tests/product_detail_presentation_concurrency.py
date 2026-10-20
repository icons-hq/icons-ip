"""Exercise real competing transactions only in the wrapper's disposable clone."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_product_detail_concurrency_'):
    raise SystemExit('Use a dedicated icons_product_detail_concurrency_ database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'product-detail-{os.getpid()}'

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(n):
    return f'92000000-0000-4000-8000-{n:012d}'

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

def save(section, revision, operation, who=1, good=None):
    values = f"(public.admin_get_product_detail_presentation()->'values'->'{section}')"
    if good:
        values += f"||jsonb_build_object('targetType','goods','goodIds',jsonb_build_array('{good}'),'categoryIds','[]'::jsonb)"
    return actor(who) + f"select public.admin_save_product_detail_presentation('{section}',{values},{revision},'{uid(operation)}');"

sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('92000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','detail-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','deputy');
update private.operator_access_state set configured=true where id;
update private.product_detail_settings set revision=0;
delete from private.product_detail_banner_goods;delete from private.product_detail_banner_categories;
update private.product_detail_settings set values='{{"enabled":false,"style":"light","title":"","text":"","periodEnabled":false,"startsOn":null,"endsOn":null,"targetType":"all"}}' where section='banner';
insert into public.ips(id,title,vertical_key) select 'detail-race-ip','동시성 합성 IP',key from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) select 'detail-race-'||n,'detail-race-ip','동시성 합성 상품 '||n,'문구',1000 from generate_series(1,2)n;
commit;""")
race('same-section-cas', save('modules', 0, 101), save('modules', 0, 102, 2), 'product_detail_conflict')
race('same-operation-replay', save('modules', 1, 103), save('modules', 1, 103))
assert sql(f"select count(*) from public.audit_log where id='{uid(103)}';") == '1'

name = f'{prefix}-independent-section'
one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
one.stdin.write(f"set application_name='{name}';begin;{save('modules', 2, 104)}select pg_sleep(3);commit;")
one.stdin.close(); one.stdin = None
wait_state(name, 'Timeout', one)
sql("begin;set local lock_timeout='500ms';" + save('banner', 0, 105, 2) + 'commit;')
assert one.poll() is None
result = one.communicate(timeout=8)
assert one.returncode == 0, result
print('PASS independent-section: banner committed while modules row stayed locked')

race('save-before-draft-rename', save('banner', 1, 106, good='detail-race-1'), "update public.goods set id='detail-race-renamed' where id='detail-race-1';")
assert sql("select good_id from private.product_detail_banner_goods;") == 'detail-race-renamed'
race('rename-before-save', "update public.goods set id='detail-race-other' where id='detail-race-2';", save('banner', 2, 107, 2, 'detail-race-2'), 'banner_good_missing')
assert sql("select revision from private.product_detail_settings where section='banner';") == '2'
race('operation-conflict', save('banner', 2, 108), save('modules', 3, 108), 'operation_conflict')
race('revoke-before-save', actor(1) + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(301)}');", save('modules', 3, 109, 2), 'operator_capability_required')
assert sql("select revision from private.product_detail_settings where section='modules';") == '3'
assert sql("select revision from private.product_detail_settings where section='banner';") == '3'
assert sql("select good_id from private.product_detail_banner_goods;") == 'detail-race-renamed'
assert sql("select count(*) from public.audit_log where id::text like '92000000-0000-4000-8000-%' and action='admin.product_detail.updated';") == '6'
print('PASS final readback: section revisions 3/3, renamed FK preserved, six audit receipts, no stale or revoked save')

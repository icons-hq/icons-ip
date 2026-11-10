"""Exercise real competing transactions only in the wrapper's disposable clone."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_goods_media_concurrency_'):
    raise SystemExit('Use a dedicated icons_goods_media_concurrency_ database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'goods-media-{os.getpid()}'

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(n):
    return f'92900000-0000-4000-8000-{n:012d}'

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

def save(revision, operation, who=1, asset=None):
    values = '{"video":null,"shortclip":null}' if not asset else '{"video":{"id":"' + uid(asset) + '","title":"경합 영상"},"shortclip":null}'
    return actor(who) + f"select public.admin_save_good_media('media-race-good','{values}',{revision},'{uid(operation)}');"

sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('92900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','media-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,2)n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in('{uid(1)}','{uid(2)}');
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','deputy');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) select 'media-race-ip','미디어 경합',key from public.verticals limit 1;
insert into public.goods(id,ip_id,name,type,price) values('media-race-good','media-race-ip','미디어 경합 상품','문구',1000);
insert into private.goods_media_assets(id,actor_id,kind,path,source_size,status,expires_at,metadata,verified_at,staging_cleaned_at)
select ('92900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'{uid(1)}','video','video/92900000-0000-4000-8000-'||lpad(n::text,12,'0')||'.mp4',4001,'verified',clock_timestamp()+interval '1 hour',
jsonb_build_object('width',160,'height',120,'durationMs',2000,'byteSize',4001,'sha256',repeat('a',64),'videoCodec','avc1.64000a','audioCodec',null),clock_timestamp(),clock_timestamp() from generate_series(201,203)n;
insert into storage.objects(bucket_id,name,metadata) select 'goods-videos',path,'{{"mimetype":"video/mp4","size":4001}}' from private.goods_media_assets where id in('{uid(201)}','{uid(202)}','{uid(203)}');
commit;""")
sql('begin read only;' + actor(1) + "select public.admin_get_good_media('media-race-good');select public.admin_get_goods_media_settings();commit;")
print('PASS read-only-admin-get: both admin getters work in REST-style read-only transactions')
race('same-good-cas', save(0,101), save(0,102,2), 'revision_conflict')
race('same-operation-replay', save(1,103), save(1,103))
assert sql(f"select count(*) from public.audit_log where id='{uid(103)}';") == '1'
race('operation-conflict', save(2,104), save(2,104,asset=201), 'operation_conflict')
race('cancel-before-attach', f"select public.service_cancel_goods_media_upload('{uid(1)}','{uid(201)}');", save(3,105,asset=201), 'goods_media_asset_unavailable')
race('attach-before-cancel', save(3,106,asset=202), f"select public.service_cancel_goods_media_upload('{uid(1)}','{uid(202)}');")
assert sql(f"select status from private.goods_media_assets where id='{uid(202)}';") == 'attached'
assert sql(f"select not exists(select 1 from jsonb_array_elements(public.service_claim_goods_media_cleanup(50)) a where a->>'id'='{uid(202)}');") == 't'
sql(f"update private.goods_media_assets set expires_at=clock_timestamp()-interval '1 minute' where id='{uid(203)}';")
race('cleanup-before-attach', 'select public.service_claim_goods_media_cleanup(50);', save(4,107,asset=203), 'goods_media_asset_unavailable')
race('revoke-before-save', actor(1) + f"select public.admin_change_operator_role('{uid(2)}',null,1,1,'{uid(301)}');", save(4,108,2), 'operator_capability_required')
assert sql("select revision from private.goods_media_bindings where good_id='media-race-good';") == '4'
assert sql(f"select video_asset_id from private.goods_media_bindings where good_id='media-race-good';") == uid(202)
assert sql("select count(*) from public.audit_log where id::text like '92900000-0000-4000-8000-%' and action='admin.goods_media.updated';") == '4'
print('PASS final readback: one attached asset, revision four, four audit receipts, no stale/revoked/cleanup attachment')

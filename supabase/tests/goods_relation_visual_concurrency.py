#!/usr/bin/env python3
"""Isolated committed fixtures prove operation, revision and upload-claim races."""
import json
import os
import re
import subprocess
import time
import uuid

container = os.environ.get('SUPABASE_DB_CONTAINER', '')
database = os.environ.get('PGDATABASE', '')
if not container.startswith('supabase_db_') or not re.fullmatch(r'icons_relation_visual_concurrency_[0-9_]+', database):
    raise SystemExit('Use the wrapper with a dedicated icons_relation_visual_concurrency_ database.')


def quote(value):
    return "'" + str(value).replace("'", "''") + "'"


def sql(statement, check=True):
    result = subprocess.run(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
    if check and result.returncode:
        raise RuntimeError(result.stderr.strip())
    return result


actor = str(uuid.uuid4())
run = uuid.uuid4().hex[:10]
ip = 'relation-race-' + run
goods = [ip + '-a', ip + '-b']
relations = [str(uuid.uuid4()) for _ in range(3)]
operations = [str(uuid.uuid4()) for _ in range(5)]
paths = ['catalog/curation/' + str(uuid.uuid4()) + '.webp' for _ in range(2)]


def values(path, title='동시 편성 검수'):
    return {'kind': 'codi', 'title': title, 'representativeGoodId': goods[0], 'enabled': False, 'startsAt': None, 'endsAt': None, 'goodIds': goods,
            'visual': {'imagePath': 'public-media/' + path, 'alt': '격리 동시성 검수', 'description': '', 'hotspots': [{'goodId': goods[0], 'x': 5000, 'y': 5000}]}}


def save_statement(relation, revision, operation, body):
    return f"set local role authenticated;select set_config('request.jwt.claim.sub',{quote(actor)},true);select public.admin_save_goods_relation_composition({quote(relation)},{revision},{quote(operation)},{quote(json.dumps(body))}::jsonb);"


def race(left, right):
    names = ['relation-race-' + uuid.uuid4().hex for _ in range(2)]
    processes = []

    def start(name, request, hold):
        process = subprocess.Popen(['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        processes.append(process)
        process.stdin.write(f"set application_name={quote(name)};begin;set local lock_timeout='8s';" + save_statement(*request) + ("select pg_sleep(1.5);" if hold else '') + 'commit;')
        process.stdin.close()
        process.stdin = None
        return process

    def wait_for(name, event, process):
        for _ in range(100):
            if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name={quote(name)};").stdout.strip() == event:
                return
            if process.poll() is not None:
                raise RuntimeError('Writer exited before observed lock wait: ' + str(process.communicate()))
            time.sleep(0.025)
        raise RuntimeError('Expected PostgreSQL wait event was not observed: ' + event)

    try:
        one = start(names[0], left, True)
        wait_for(names[0], 'Timeout', one)
        two = start(names[1], right, False)
        wait_for(names[1], 'Lock', two)
        result = []
        for process in [one, two]:
            out, err = process.communicate(timeout=12)
            result.append(subprocess.CompletedProcess([], process.returncode, out, err))
        return result
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.communicate()


try:
    sql(f"""begin;
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values({quote(actor)},'authenticated','authenticated',{quote(ip+'@example.test')},now(),'{{"testFixture":"relation-visual-race"}}','{{}}');
    update public.profiles set role='staff' where id={quote(actor)};
    insert into private.operator_memberships(profile_id,manager_role) values({quote(actor)},'primary');
    insert into public.ips(id,title,vertical_key) select {quote(ip)},'동시성 검수',key from public.verticals limit 1;
    insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values({quote(goods[0])},{quote(ip)},'동시성 상품 A','문구',1000,'ok',0),({quote(goods[1])},{quote(ip)},'동시성 상품 B','문구',1000,'ok',0);
    commit;""")
    for path in paths:
        sql(f"begin;set local role service_role;select public.service_prepare_admin_artwork_upload({quote(actor)},{quote(path)},'curation','image/webp',100,now()+interval '10 minutes');select * from public.service_begin_admin_artwork_verification({quote(actor)},{quote(path)});select public.service_verify_admin_artwork_upload({quote(actor)},{quote(path)},100);commit;")
    request = (relations[0], 0, operations[0], values(paths[0]))
    replies = race(request, request)
    assert all(reply.returncode == 0 for reply in replies), [reply.stderr for reply in replies]
    assert sql(f"select revision from public.goods_relations where id={quote(relations[0])};select count(*) from public.audit_log where id={quote(operations[0])};").stdout.split() == ['1', '1']
    print('PASS same operation commits one relation/revision/audit')
    replies = race((relations[0], 1, operations[1], values(paths[0], '수정 A')), (relations[0], 1, operations[2], values(paths[0], '수정 B')))
    assert sum(reply.returncode == 0 for reply in replies) == 1
    assert any('goods_relation_changed' in reply.stderr for reply in replies)
    assert sql(f"select revision from public.goods_relations where id={quote(relations[0])};").stdout.strip() == '2'
    print('PASS two revision writers preserve exactly one winner')
    replies = race((relations[1], 0, operations[3], values(paths[1])), (relations[2], 0, operations[4], values(paths[1])))
    assert sum(reply.returncode == 0 for reply in replies) == 1
    assert any('unverified_artwork' in reply.stderr for reply in replies)
    assert sql(f"select count(*) from public.goods_relations where id in ({quote(relations[1])},{quote(relations[2])});select count(*) from public.goods_relation_hotspots where relation_id in ({quote(relations[1])},{quote(relations[2])});").stdout.split() == ['1', '1']
    print('PASS verified image claim attaches to exactly one competing relation')
finally:
    sql(f"""begin;
    delete from public.goods_relations where id in ({','.join(map(quote,relations))});
    delete from public.audit_log where id in ({','.join(map(quote,operations))});
    delete from public.admin_artwork_upload_claims where actor_id={quote(actor)} and path in ({','.join(map(quote,paths))});
    delete from public.goods where id in ({','.join(map(quote,goods))});
    delete from public.ips where id={quote(ip)};
    delete from auth.users where id={quote(actor)} and raw_app_meta_data->>'testFixture'='relation-visual-race';
    commit;""")
    print('PASS targeted synthetic fixture cleanup')

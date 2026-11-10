"""Real concurrent writers, restricted to disposable category-display clones.

This intentionally commits synthetic fixtures. The caller must destroy the
disposable database afterwards; postgres and every normal local DB are refused.
"""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import time

container, database, directory = sys.argv[1:]
wrapper_scope = os.environ.get('CATEGORY_DISPLAY_TEST_SCOPE')
if re.fullmatch(r'icons_category_display_concurrency_[0-9]+_[0-9]+', database):
    assert wrapper_scope in ('ci', 'isolated-local'), 'Use the explicit CI/local wrapper scope'
    assert re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+', container)
    identity = json.loads(subprocess.check_output(['docker', 'inspect', '--format', '{{json .}}', container], text=True))
    assert identity['State']['Running'] and identity['Config']['Labels']['com.supabase.cli.project'] == container.removeprefix('supabase_db_')
else:
    assert container in ('supabase_db_icons-ip-chain-20261014-feb855bd', 'supabase_db_icons-ip-smartstore-20261012')
    assert re.fullmatch(r'icons_category_display_(canonical|own)_[0-9a-f]{10}', database)
out = Path(directory)
out.mkdir(parents=True, exist_ok=True)
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
actor = '93932000-0000-4000-8000-000000000001'
other_actor = '93932000-0000-4000-8000-000000000002'
category = '93932000-0000-4000-8000-000000000011'
good = 'cd-concurrency-good'
auth = f"set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);"
other_auth = auth.replace(actor, other_actor)
results = []


def run(sql, name):
    result = subprocess.run(command, input=sql, text=True, capture_output=True, timeout=30)
    (out / (name + '.log')).write_text(result.stdout + result.stderr)
    if result.returncode:
        raise RuntimeError(name + ': ' + result.stderr[-3000:])
    return result.stdout.strip()


def read_revision():
    return int(run(f"select revision from private.category_display_compositions where category_id='{category}';", 'revision'))


def save(values, revision, operation):
    assert "'" not in json.dumps(values)
    return f"select public.admin_save_category_display('{category}','{json.dumps(values)}',{revision},'93932000-0000-4000-8000-{operation:012}');"


def start(body, name):
    log = (out / (name + '.log')).open('w')
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=log, text=True)
    process.stdin.write("begin;set local statement_timeout='12s';set local lock_timeout='8s';" + f"set local application_name='{name}';" + body + 'commit;')
    process.stdin.close()
    return process, log


def wait_state(name, expected, process):
    deadline = time.monotonic() + 7
    while time.monotonic() < deadline:
        state = run(f"select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') from pg_stat_activity where application_name='{name}';", 'state')
        if expected in state:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} finished before observed {expected}: ' + (out / (name + '.log')).read_text()[-3000:])
        time.sleep(0.025)
    raise RuntimeError(name + ' did not enter ' + expected)


def pair(name, first_body, second_body, expected_second, revision):
    first_name, second_name = 'cd-race-' + name + '-a', 'cd-race-' + name + '-b'
    first, first_log = start(first_body, first_name)
    second = second_log = None
    try:
        wait_state(first_name, 'PgSleep', first)
        second, second_log = start(second_body, second_name)
        wait_state(second_name, 'Lock:', second)
        assert first.wait(timeout=15) == 0, (out / (first_name + '.log')).read_text()
        second_status = second.wait(timeout=15)
        second_text = (out / (second_name + '.log')).read_text()
        if expected_second is None:
            assert second_status == 0, second_text
        else:
            assert second_status != 0 and expected_second in second_text and '40P01' not in second_text, second_text
        assert read_revision() == revision
        if name == 'same-operation':
            saved = [next(json.loads(line) for line in (out / (n + '.log')).read_text().splitlines() if line.startswith('{')) for n in (first_name, second_name)]
            assert saved[0] == saved[1]
        results.append({'case': name, 'blockedSecondWriterObserved': True, 'secondSqlstate': expected_second, 'revision': revision, 'status': 'PASS'})
        print('PASS ' + name, flush=True)
    finally:
        for process, stream in ((first, first_log), (second, second_log)):
            if process is not None and process.poll() is None:
                process.terminate()
                process.wait(timeout=3)
            if stream:
                stream.close()


run(f"""
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('{actor}','authenticated','authenticated','category-concurrency@example.test',now(),'{{"testFixture":"category-concurrency"}}','{{}}'),
('{other_actor}','authenticated','authenticated','category-concurrency-other@example.test',now(),'{{"testFixture":"category-concurrency"}}','{{}}');
update public.profiles set role=case when id='{actor}' then 'admin'::public.user_role else 'staff'::public.user_role end where id in ('{actor}','{other_actor}');
insert into private.operator_memberships(profile_id,manager_role) values('{actor}','owner'),('{other_actor}','primary');
update private.operator_access_state set configured=true where id;
insert into public.catalog_categories(id,code,name,parent_id,sort_order) values('{category}','cd-concurrency-root','동시성 검증',null,0);
insert into private.category_display_nodes(id,name,sort_order,legacy_category_id) values('{category}','동시성 검증',0,'{category}');
insert into public.ips(id,title,vertical_key) values('cd-concurrency-ip','동시성 검증 IP','character');
insert into public.goods(id,ip_id,name,type,price,category_id) values('{good}','cd-concurrency-ip','비공개 동시성 검증','문구',1000,'{category}');
""", 'fixture')
raw = run(f"begin;{auth}select public.admin_get_category_display('{category}')->'values';rollback;", 'default')
values = next(json.loads(line) for line in raw.splitlines() if line.startswith('{'))
values.update(mode='manual', goodIds=[good])
pause = 'select pg_sleep(1.5);'
pair('first-save', auth + save(values, 0, 101) + pause, other_auth + save(values, 0, 102), 'PT409', 1)
pair('cas-save', auth + save(values, 1, 103) + pause, other_auth + save(values, 1, 104), 'PT409', 2)
pair('same-operation', auth + save(values, 2, 105) + pause, auth + save(values, 2, 105), None, 3)
payload = run(f"""begin;{auth}
select jsonb_build_object('previous_id',g.id,'id','cd-concurrency-renamed','ip_id',g.ip_id,'name',g.name,'price',g.price,
 'variant_baseline',(select jsonb_agg(id) from public.goods_variants where good_id=g.id and archived_at is null),
 'variants',(select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,
 'extraPrice',v.price-g.price,'stockQty',v.stock_qty,'expectedStockQty',v.stock_qty)) from public.goods_variants v where v.good_id=g.id))
from public.goods g where g.id='{good}';rollback;""", 'rename-payload')
payload = next(json.loads(line) for line in payload.splitlines() if line.startswith('{'))
# Use the real catalog editor for rename. Its category-tree lock is held before
# the contender starts, and its FK cascade must invalidate the display CAS.
rename = f"select set_config('request.jwt.claim.sub','{actor}',true);select private.require_operator_capability('catalog.manage',false);select private.lock_catalog_category_tree();{pause}{auth}select public.admin_save_good('{json.dumps(payload)}');"
pair('catalog-rename', rename, other_auth + save(values, 3, 106), '23514', 4)
assert run(f"select good_id from private.category_display_goods where category_id='{category}';", 'rename-readback') == 'cd-concurrency-renamed'
values['goodIds'] = ['cd-concurrency-renamed']
# The ordinary UI archives goods; this explicit owner DELETE probes the physical
# FK lifecycle and its good-row -> composition order on a never-published draft.
pair('physical-delete', f"delete from public.goods where id='cd-concurrency-renamed';{pause}", other_auth + save(values, 4, 107), '23514', 5)
assert run(f"select count(*) from private.category_display_goods where category_id='{category}';", 'delete-readback') == '0'
(out / 'result.json').write_text(json.dumps({'status': 'PASS', 'disposableDatabase': database, 'tests': results}, indent=2))

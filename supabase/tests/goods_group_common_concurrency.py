"""Actual transaction races in a leased disposable group-common database only."""
import json, os, re, subprocess, time, uuid
from pathlib import Path

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
lease_id = uuid.UUID(os.environ['GOODS_GROUP_COMMON_LEASE'])
lease = str(lease_id)
assert os.environ['GOODS_GROUP_COMMON_LEASE'] == lease
assert re.fullmatch(r'[0-9a-f]{64}', container)
assert re.fullmatch(r'icons_goods_(?:transaction|aggregation|group_common)_[0-9a-f]{32}', database)
assert database.rsplit('_', 1)[-1] == lease_id.hex
cmd = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']

def sql(source):
    result = subprocess.run(cmd, input=source, text=True, capture_output=True, timeout=25)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

assert sql('select lease::text||\':\'||container_id from private.operator_fixture_clone_identity where singleton and source_database=\'postgres\';') == lease + ':' + container
prefix = 'group-common-race-' + str(os.getpid())
actor = 'a6140000-0000-4000-8000-000000000001'
session = 'a6140000-0000-4000-8000-000000000002'

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def auth():
    claims = json.dumps({'sub': actor, 'role': 'authenticated', 'session_id': session})
    return f"set local role authenticated;set local request.jwt.claim.sub={literal(actor)};set local request.jwt.claims={literal(claims)};"

def start(label, source, delay=0):
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{prefix}-{label}';begin;set local lock_timeout='8s';" + source + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close()
    process.stdin = None
    return process

def wait(label, event, process):
    for _ in range(180):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{prefix}-{label}';") == event:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{label} exited before {event}: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{label} never reached {event}')

def finish(process, error=None):
    output, diagnostic = process.communicate(timeout=12)
    if error:
        assert process.returncode and error in diagnostic, (output, diagnostic)
        assert '40P01' not in diagnostic and 'deadlock' not in diagnostic.lower(), diagnostic
        return diagnostic
    assert process.returncode == 0, diagnostic
    return [json.loads(line) for line in output.splitlines() if line.startswith('{')][-1] if '{' in output else output.strip()

fixture = (Path(__file__).parent / 'goods_group_common_information.sql').read_text().split('-- Category schemas')[0]
sql(fixture + '\ncommit;')
group = sql("select group_id from private.goods_group_members where good_id='group-conversion-source';")

def values():
    return sql("select jsonb_build_object('goods',(private.goods_group_common_identity('group-conversion-source')->'goods')||jsonb_build_object('additional_category_ids','[]'::jsonb),"
               "'attributes',jsonb_build_object('categoryId',null,'schemaRevision',0,'expectedRevision',coalesce((select revision from public.goods_attribute_values where good_id='group-conversion-source'),0),'values','{}'::jsonb,'removeIds','[]'::jsonb),"
               "'afterSales',(select jsonb_build_object('phone',phone,'guide',guide,'sellerSpecialNotes',seller_special_notes) from private.goods_after_sales_content where good_id='group-conversion-source'),"
               "'sizeChart',(select jsonb_build_object('enabled',enabled,'chart',chart) from private.goods_size_charts where good_id='group-conversion-source'));")

def save(operation, revision, payload):
    return auth() + f"select public.admin_save_goods_group_common('{group}',{revision},{literal(payload)},'{operation}','{actor}','{session}');"

payload = values()
operation = 'a6140000-0000-4000-8000-000000000801'
first = start('same-first', save(operation, 2, payload), 1.3)
wait('same-first', 'Timeout', first)
second = start('same-second', save(operation, 2, payload))
wait('same-second', 'Lock', second)
assert finish(first) == finish(second)
assert sql(f"select revision||':'||(select count(*) from private.goods_group_changes where operation_id='{operation}') from private.goods_groups where id='{group}';") == '3:1'
print('PASS same operation: observed Lock wait, one common revision and identical receipt', flush=True)

payload = values()
first = start('cas-first', save('a6140000-0000-4000-8000-000000000802', 3, payload), 1.3)
wait('cas-first', 'Timeout', first)
second = start('cas-second', save('a6140000-0000-4000-8000-000000000803', 3, payload))
wait('cas-second', 'Lock', second)
finish(first)
finish(second, 'goods_group_changed')
assert sql(f"select revision from private.goods_groups where id='{group}';") == '4'
print('PASS distinct operation CAS: observed Lock wait, exactly one winner', flush=True)

payload = values()
for name, held in [
    ('normal-editor-advisory', "select pg_advisory_xact_lock(hashtextextended('admin_good:group-conversion-source',0));"),
    ('member-row', "select id from public.goods where id='group-conversion-source' for update;"),
]:
    first = start(name, held, 1.3)
    wait(name, 'Timeout', first)
    second = start(name + '-common', save('a6140000-0000-4000-8000-000000000804', 4, payload))
    finish(second, 'goods_group_retry')
    # The contention returns while the opposing lock is still held, never waits
    # for an opposite-order editor and never leaves a partial operation behind.
    assert first.poll() is None
    finish(first)
    assert sql("select count(*) from private.goods_group_operations where operation_id='a6140000-0000-4000-8000-000000000804';") == '0'
    print('PASS ' + name + ': retry before opposing holder releases, no partial operation', flush=True)

operation = 'a6140000-0000-4000-8000-000000000805'
seal = auth() + f"select public.admin_read_goods_group_change('{group}',4,'common','{operation}','{actor}','{session}',true);"
first = start('seal-first', seal, 1.3)
wait('seal-first', 'Timeout', first)
second = start('late-save', save(operation, 4, payload))
wait('late-save', 'Lock', second)
assert finish(first) == finish(second) == {'state': 'sealed', 'operationId': operation}
assert sql(f"select revision from private.goods_groups where id='{group}';") == '4'
print('PASS seal/late dispatch: observed Lock wait, identical sealed receipt and no new revision', flush=True)
print(json.dumps({'cases': 5, 'database': database, 'sourceDatabaseWrites': 0}), flush=True)

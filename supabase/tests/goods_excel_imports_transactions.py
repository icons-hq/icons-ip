#!/usr/bin/env python3
"""Exercise preview and stock writes in separate transactions on a local test DB.

PSQL_BIN, PGHOST (localhost), PGPORT and PGPASSWORD are supplied by the test runner.
Only this test's fixed actor/catalog fixtures are created and removed.
"""
import concurrent.futures
import os
import subprocess

if os.environ.get('PGHOST') not in ('127.0.0.1', 'localhost') or not os.environ.get('PGPORT'):
    raise SystemExit('Explicit local PGHOST and PGPORT are required')
command = [os.environ.get('PSQL_BIN', 'psql'), '-X', '-U', os.environ.get('PGUSER', 'postgres'),
           '-d', os.environ.get('PGDATABASE', 'postgres'), '-vON_ERROR_STOP=1', '-At']

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(result.stdout + result.stderr)
    return result.stdout

actor = '00000000-0000-4000-8000-000000042531'
batch = '00000000-0000-4000-8000-000000042532'
claim = f"select set_config('request.jwt.claim.sub','{actor}',false);"
cleanup = f"""begin;
delete from public.admin_goods_imports where actor_id='{actor}';
delete from public.goods where ip_id='excel-transaction-test';
delete from public.ips where id='excel-transaction-test';
delete from public.verticals where key='excel-transaction-test';
delete from public.audit_log where actor_id='{actor}';
delete from auth.users where id='{actor}';
commit;"""
try:
    sql(f"""begin;
    insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
    values('{actor}','authenticated','authenticated','excel-transactions@example.test',now(),'{{}}','{{}}',now(),now());
    update public.profiles set role='staff' where id='{actor}';
    insert into public.verticals(key,label,color) values('excel-transaction-test','Excel test','#000000');
    insert into public.ips(id,title,vertical_key) values('excel-transaction-test','Excel test','excel-transaction-test');
    {claim}
    select public.admin_save_good('{{"ip_id":"excel-transaction-test","name":"Excel transaction test","code":"EXCEL-TX","publish":false,"origin_id":null,"variants":[{{"name":"기본 옵션","code":"EXCEL-TX-A","attributes":{{}},"extraPrice":0,"stockQty":4}}],"variant_baseline":[]}}');
    commit;""")
    sql(f"""insert into public.admin_goods_imports(id,actor_id,state,plan)
    select '{batch}','{actor}','ready',
    jsonb_build_array(jsonb_build_object('kind','update','rows','[5]'::jsonb,'fingerprint',private.goods_import_fingerprint(g.id),
    'target',to_jsonb(g)||jsonb_build_object('previous_id',g.id,'name','Metadata edit after sale','publish',false,'variant_baseline',jsonb_build_array(v.id),
    'variants',jsonb_build_array(jsonb_build_object('id',v.id,'name',v.name,'code',v.code,'attributes',v.attributes,'extraPrice',0,'stockQty',4,'expectedStockQty',4)))))
    from public.goods g join public.goods_variants v on v.good_id=g.id and v.is_default where g.code='EXCEL-TX';""")
    # A separate transaction changes the parent's updated_at as well as cached stock.
    sql("update public.goods_variants set stock_qty=3 where code='EXCEL-TX-A';")
    # Two confirmations of one stored group must both return its one durable result.
    commit = claim + f"select public.admin_commit_goods_import_group('{batch}',0);"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(sql, [commit, commit]))
    assert all('"status": "success"' in result for result in results), results
    assert results[0] == results[1], results
    assert sql("select stock_qty from public.goods_variants where code='EXCEL-TX-A';").strip() == '3'
    assert sql(f"select count(*) from public.audit_log where actor_id='{actor}' and action='admin.goods_import.applied';").strip() == '1'
    print('PASS: separate-transaction stock preservation and concurrent idempotent confirmation')
finally:
    sql(cleanup)

"""Guarded, synthetic packing and opposite-member dispatch races."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and meta['Id']==cid and meta['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-2000:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:8]
fixture=Path('supabase/tests/combined_packing.sql').read_text().split('select pg_temp.confirm_order(n)')[0].replace('bf160000',run).replace('combined-pack',f'pack-{run}').replace('TEST 합포장 회귀',f'TEST packing {run}')
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text()+fixture+'\nselect pg_temp.confirm_order(n) from generate_series(1,4)n;commit;')
actor=f'{run}-0000-4000-8000-000000000001';session=f'{run}-0000-4000-9000-000000000001'
jwt=json.dumps({'sub':actor,'session_id':session,'role':'authenticated'})
prefix=f"begin;set local lock_timeout='20s';select set_config('request.jwt.claims','{jwt}',true);set local role authenticated;"
ids=json.loads(sql(f"select jsonb_agg(id order by order_id) from public.order_shipments where order_id::text like '{run}-0000-4001-%';"))
def arr(values):return "array["+','.join("'"+v+"'::uuid" for v in values)+"]"
def preview(values):return json.loads(sql(prefix+f"select public.admin_get_shipment_packs({arr(values)});commit;").splitlines()[-1])
version=preview(ids[:2])['version'];operation=str(uuid.uuid4());barrier=threading.Barrier(12)
def create(_):
 barrier.wait(timeout=15);return sql(prefix+f"select public.admin_change_shipment_pack({arr(ids[:2])},'create','{version}','TEST parallel same request','{operation}','{actor}','{session}');commit;").splitlines()[-1]
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:receipts=list(pool.map(create,range(12)))
assert len(set(receipts))==1
version=preview(ids[2:])['version'];barrier=threading.Barrier(8)
def compete(_):
 barrier.wait(timeout=15)
 try:sql(prefix+f"select public.admin_change_shipment_pack({arr(ids[2:])},'create','{version}','TEST competing request','{uuid.uuid4()}','{actor}','{session}');commit;");return 'saved'
 except RuntimeError as error:
  assert 'shipment_pack_changed' in str(error),str(error);return 'stale'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:competing=list(pool.map(compete,range(8)))
assert competing.count('saved')==1
barrier=threading.Barrier(12)
def dispatch(n):
 barrier.wait(timeout=15);return sql(prefix+f"select public.admin_import_shipment_tracking('{ids[n%2]}','hanjin','TESTPACKRACE123');commit;")
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:list(pool.map(dispatch,range(12)))
barrier=threading.Barrier(8)
def correct(n):
 barrier.wait(timeout=15);return sql(prefix+f"select public.admin_update_shipment_tracking('{ids[n%2]}','hanjin','TESTPACKFIX{n:04}');commit;")
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:list(pool.map(correct,range(8)))
proof=json.loads(sql(f"select jsonb_build_object('packs',(select count(distinct pack_id) from private.shipment_pack_members where shipment_id=any({arr(ids)})),'events',(select count(*) from private.shipment_pack_events where actor_id='{actor}'),'shipping',(select count(*) from public.order_shipments where id=any({arr(ids[:2])}) and status='shipping'),'distinctTracking',(select count(distinct tracking_number) from public.order_shipments where id=any({arr(ids[:2])})),'total',(select sum(total) from public.orders where id::text like '{run}-0000-4001-%'),'notifications',(select count(*) from public.notifications where user_id='{run}-0000-4000-8000-000000000002'));"))
assert proof['packs']==2 and proof['events']==2 and proof['shipping']==2 and proof['distinctTracking']==1 and proof['total']==40000,proof
print(json.dumps({'run':run,'sameCreate':12,'competingCreate':competing,'oppositeMemberDispatch':12,'oppositeMemberCorrections':8,'readback':proof},indent=2))

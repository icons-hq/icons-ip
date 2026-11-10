"""Synthetic isolated local races: one start receipt, complete CAS, cancel/start."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and meta['Id']==cid and meta['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-1800:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:8]
fixture=Path('supabase/tests/order_production.sql').read_text().split("select public.admin_change_order_production(:'job_id','start'")[0].replace('c7160805',run).replace('production-check',f'production-{run}').replace('production-paid',f'production-paid-{run}').replace('production-attempt',f'production-attempt-{run}').replace('production-provider',f'production-provider-{run}').replace('production-code',f'production-code-{run}').replace('TEST 제작 회귀',f'TEST production {run}')
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text()+fixture+'\nreset role;commit;')
job=json.loads(sql(f"select jsonb_build_object('id',id,'order',order_id) from private.order_production_jobs where order_id in(select id from public.orders where user_id='{run}-0000-4000-8000-000000000002');"))
actor=f'{run}-0000-4000-8000-000000000001';session=f'{run}-0000-4000-9000-000000000001';jwt=json.dumps({'sub':actor,'role':'authenticated','session_id':session})
def prefix():return f"begin;set local lock_timeout='20s';select set_config('request.jwt.claims','{jwt}',true);set local role authenticated;"
def change(kind,revision,operation):return sql(prefix()+f"select public.admin_change_order_production('{job['id']}','{kind}',{revision},'{operation}','{actor}','{session}','TEST concurrent actual production');commit;").splitlines()[-1]
def race(size,fn):
 barrier=threading.Barrier(size)
 def task(n):barrier.wait(timeout=15);return fn(n)
 with concurrent.futures.ThreadPoolExecutor(max_workers=size) as pool:return list(pool.map(task,range(size)))
operation=str(uuid.uuid4());starts=race(12,lambda _:change('start',1,operation));assert len(set(starts))==1,starts
def complete(_):
 try:change('complete',2,str(uuid.uuid4()));return 'saved'
 except RuntimeError as e:assert 'production_changed' in str(e),str(e);return 'stale'
completions=race(8,complete);assert completions.count('saved')==1 and completions.count('stale')==7,completions
proof=json.loads(sql(f"select jsonb_build_object('state',state,'revision',revision,'chronological',completed_at>=started_at,'events',(select count(*) from private.order_production_events where job_id=j.id),'cancelEligible',private.order_cancel_eligible(order_id)) from private.order_production_jobs j where id='{job['id']}';"))
assert proof=={'state':'completed','revision':3,'chronological':True,'events':2,'cancelEligible':True},proof
# Cancellation after completion but before dispatch still enters review.
result=sql(f"begin;set local role service_role;select public.request_order_cancellation('{job['order']}','{run}-0000-4000-8000-000000000002','TEST concurrent cancel','change_of_mind');commit;").splitlines()[-1];assert result=='requested',result
proof['refunds']=int(sql(f"select count(*) from public.refunds where cancellation_request_id in(select id from public.order_cancellation_requests where order_id='{job['order']}');"));assert proof['refunds']==0
print(json.dumps({'run':run,'startRetries':len(starts),'completeRace':completions,'readback':proof},indent=2))

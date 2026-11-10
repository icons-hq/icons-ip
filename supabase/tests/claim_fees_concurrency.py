"""Synthetic fee issue/confirmation races against the owned disposable database."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and meta['Id']==cid and meta['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=45)
 if r.returncode: raise RuntimeError(r.stderr.decode()[-2000:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:10]
fixture=Path('supabase/tests/claim_fees.sql').read_text().split('-- Rollback-only policy')[0]
fixture=fixture.replace('claim-fees-sql',f'claim-fees-{run}').replace('cf-sql-',f'cf-{run}-')
sql(fixture+'\ncommit;')
ids=json.loads(sql("select jsonb_object_agg(n,md5('claim-fees-%s:'||n)::uuid) from unnest(array['user:1','session:1','claim:1','order:1'])n;"%run))
actor,session,claim,order=(ids[k] for k in ['user:1','session:1','claim:1','order:1'])
jwt=json.dumps({'sub':actor,'session_id':session,'role':'authenticated'})
prefix=f"begin;set local lock_timeout='20s';select set_config('request.jwt.claims','{jwt}',true);set local role authenticated;"
previous=json.loads(sql("select jsonb_build_object('policy',(select to_jsonb(p) from private.claim_fee_policy p where singleton),'account',(select bank_transfer from public.store_settings where singleton));"))
def literal(v):return 'null' if v is None else "'"+json.dumps(v).replace("'","''")+"'::jsonb"
try:
 sql("update private.claim_fee_policy set enabled=true where singleton;update public.store_settings set bank_transfer='{\"bank\":\"TEST BANK\",\"accountNumber\":\"TEST-0000\",\"holder\":\"TEST SHOP\"}' where singleton;")
 op=str(uuid.uuid4());values=json.dumps({'amount':3000,'payerRole':'buyer','customerNote':'TEST fee','evidence':'TEST customer agreement','confirmed':True});barrier=threading.Barrier(12)
 def same(_):
  barrier.wait(timeout=15);return sql(prefix+f"select public.admin_change_claim_fee('{claim}',null,'issue','{values}',0,0,'{op}','{actor}','{session}');commit;")
 with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:receipts=list(pool.map(same,range(12)))
 assert all(x==receipts[0] for x in receipts)
 barrier=threading.Barrier(8)
 def confirm(n):
  barrier.wait(timeout=15)
  try:sql(prefix+f"select public.admin_change_claim_fee('{claim}','{op}','confirm_payment',jsonb_build_object('amount',3000,'occurredAt',clock_timestamp(),'evidence','TEST bank reference {n}','confirmed',true),1,0,'{uuid.uuid4()}','{actor}','{session}');commit;");return 'saved'
  except RuntimeError as e:
   assert 'claim_fee_changed' in str(e),str(e);return 'stale'
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:results=list(pool.map(confirm,range(8)))
 assert results.count('saved')==1 and results.count('stale')==7
 proof=json.loads(sql(f"select jsonb_build_object('invoices',(select count(*) from private.claim_fee_invoices where claim_id='{claim}'),'events',(select count(*) from private.claim_fee_events where claim_id='{claim}'),'state',state,'amount',amount,'orderTotal',(select total from public.orders where id='{order}'),'orderStatus',(select status from public.orders where id='{order}'),'refunds',(select count(*) from public.refunds where cancellation_request_id='{claim}')) from private.claim_fee_invoices where id='{op}';"))
 assert proof=={'invoices':1,'events':2,'state':'paid','amount':3000,'orderTotal':1000,'orderStatus':'delivered','refunds':0},proof
 print(json.dumps({'run':run,'sameIssueRequests':12,'competingConfirmations':results,'readback':proof},indent=2))
finally:
 # Restore only the owned fixture's settings, preserving exact pre-test values.
 pol=previous['policy'];sql(f"update private.claim_fee_policy set enabled=({literal(pol)}->>'enabled')::boolean where singleton;update public.store_settings set bank_transfer={literal(previous['account'])} where singleton;")

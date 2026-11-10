"""Real concurrent correction/contact commands against the owned disposable DB."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];x=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and x['Id']==cid and x['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=40)
 if r.returncode: raise RuntimeError(r.stderr.decode()[-1700:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:10]
fixture=Path('supabase/tests/claim_full_address_collection.sql').read_text().split('update private.order_claim_contact_runtime set enabled=true')[0]
fixture=fixture.replace('claim-contact-full:',f'claim-race-{run}:').replace('claim-contact-full-',f'claim-race-{run}-').replace('cc-full-',f'cc-{run}-').replace("'TEST contact '",f"'TEST {run} '")
# Each connection owns its temp SQL helpers; persistent data are fresh synthetic identifiers.
sql(fixture+'\ncommit;')
ids=json.loads(sql("select jsonb_object_agg(n,md5('claim-race-%s:'||n)::uuid) from unnest(array['user:1','session:1','order:1','claim:1','shipment:1'])n;"%run))
actor,session,order,claim,shipment=(ids[k] for k in ['user:1','session:1','order:1','claim:1','shipment:1'])
claims=json.dumps({'sub':actor,'session_id':session,'role':'authenticated'})
prefix=f"begin;set local lock_timeout='15s';select set_config('request.jwt.claims','{claims}',true);select set_config('request.jwt.claim.sub','{actor}',true);set local role authenticated;"
values=json.dumps({'method':'customer_sent','carrier':'hanjin','trackingNumber':'COLLECTION12345','evidence':'TEST concurrent saved metadata','confirmed':True})
op=str(uuid.uuid4());barrier=threading.Barrier(12)
def same(_):
 barrier.wait(timeout=15);return sql(prefix+f"select public.admin_save_claim_collection_plan('{claim}','{shipment}',0,0,'{values}','{op}','{actor}','{session}');commit;")
with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:results=list(pool.map(same,range(12)))
assert all(value==results[0] for value in results)
# Competing different corrections both start from revision 1; exactly one may win.
revision=int(sql(f"select claim_revision from public.order_cancellation_requests where id='{claim}';"));barrier=threading.Barrier(8)
def different(n):
 barrier.wait(timeout=15)
 changed=json.dumps({'method':'customer_sent','carrier':'hanjin','trackingNumber':'CORRECTED1234'+str(n),'evidence':'TEST correction '+str(n),'confirmed':True})
 try:sql(prefix+f"select public.admin_save_claim_collection_plan('{claim}','{shipment}',1,{revision},'{changed}','{uuid.uuid4()}','{actor}','{session}');commit;");return 'saved'
 except RuntimeError as error:
  assert 'claim_collection_changed' in str(error),str(error);return 'stale'
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:competing=list(pool.map(different,range(8)))
assert competing.count('saved')==1 and competing.count('stale')==7
readback=json.loads(sql(f"select jsonb_build_object('events',(select count(*) from private.claim_collection_events where claim_id='{claim}'),'revision',revision,'requestedOnce',requested_once,'sentOnce',customer_sent_once,'originalCollectedAt',(select collected_at from public.order_cancellation_requests where id='{claim}')) from private.claim_collection_plans where claim_id='{claim}';"))
assert readback=={'events':2,'revision':2,'requestedOnce':True,'sentOnce':True,'originalCollectedAt':None},readback
print(json.dumps({'run':run,'sameOperationCalls':12,'competingCorrections':competing,'readback':readback},indent=2))

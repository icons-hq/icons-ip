#!/usr/bin/env python3
"""Exercise actual competing RPC transactions in a disposable local DB clone.

Usage:
  python3 supabase/tests/goods_import_guidance_concurrency.py \
    --container supabase_db_<local-project-id> --output-dir output/guidance-races

Requires Docker and the existing local Supabase database with the guidance and
reader-boundary migrations. Reads postgres with pg_dump, creates its own unique
clone, and removes that clone and temporary dump in finally. It never migrates,
resets or writes the source database, changes roles or installs dependencies.
"""
from pathlib import Path
import argparse
import json
import re
import shutil
import subprocess
import tempfile
import time
import uuid

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--container',required=True,help='Existing local Supabase Docker DB container')
parser.add_argument('--output-dir',type=Path,required=True,help='Write bounded SQL evidence and result JSON here')
args=parser.parse_args()
container=args.container
if not re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+',container):
 parser.error('Expected a local Supabase Docker database container name')
meta=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .}}',container],text=True))
if meta['Config']['Labels'].get('com.supabase.cli.project')!=container.removeprefix('supabase_db_'):
 parser.error('Container project label does not match the explicitly selected local DB')
source_port=meta['HostConfig'].get('PortBindings',{}).get('5432/tcp',[{}])[0].get('HostPort')
out=args.output_dir.resolve();out.mkdir(parents=True,exist_ok=True)
database='icons_guidance_race_'+uuid.uuid4().hex[:16]
assert database!='postgres' and re.fullmatch(r'icons_guidance_race_[0-9a-f]{16}',database)
temporary=Path(tempfile.mkdtemp(prefix='icons-guidance-race-'));created=False

def cleanup_clone():
 global created
 if created:
  subprocess.run(['docker','exec',container,'dropdb','-U','postgres','--force',database],check=True)
  created=False
 subprocess.run(['docker','exec',container,'rm','-f','/tmp/'+database+'.list'],check=True)
 shutil.rmtree(temporary,ignore_errors=True)

try:
 with (temporary/'source.dump').open('wb') as handle:
  subprocess.run(['docker','exec',container,'pg_dump','-U','postgres','-d','postgres','-Fc'],stdout=handle,check=True)
 with (temporary/'source.dump').open('rb') as handle:
  listing=subprocess.run(['docker','exec','-i',container,'pg_restore','-l'],stdin=handle,capture_output=True,check=True).stdout.decode()
 # pg_cron is bound to postgres; all application data/functions/ACLs are retained.
 listing='\n'.join(line for line in listing.splitlines() if not any(word in line.split() for word in ('cron','pg_cron')))+'\n'
 (temporary/'restore.list').write_text(listing)
 subprocess.run(['docker','exec',container,'createdb','-U','postgres',database],check=True);created=True
 subprocess.run(['docker','cp',str(temporary/'restore.list'),container+':/tmp/'+database+'.list'],check=True,capture_output=True)
 with (temporary/'source.dump').open('rb') as handle:
  restore=subprocess.run(['docker','exec','-i',container,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','-L','/tmp/'+database+'.list'],stdin=handle,capture_output=True)
 (out/'restore.log').write_bytes(restore.stdout+restore.stderr)
 if restore.returncode:raise RuntimeError('Disposable clone restore failed: '+restore.stderr.decode()[-2000:])
except Exception:
 cleanup_clone()
 raise

actor='a6c01490-0000-4000-8000-000000000001';good='guidance-race-good';code='GI-RACE';results=[]
def sql(value):
 r=subprocess.run(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],input=value,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def literal(value):return "'"+value.replace("'","''")+"'"
def as_json(value):return json.loads([line for line in value.splitlines() if line.startswith('{')][-1])
def auth():return "set local role authenticated;select set_config('request.jwt.claim.sub',"+literal(actor)+",true);"
values_as={'phone':'02-123-4567','guide':'동시성 안내','sellerSpecialNotes':''}
values_size={'enabled':True,'chart':{'unit':'cm','sizes':['단일'],'measurements':[{'name':'가로','values':['3.5']}],'note':''}}
def batch(number,guidance):
 batch_id=f'a6c01490-0000-4000-8000-{number:012d}'
 payload=json.dumps(guidance,ensure_ascii=False)
 sql("insert into public.admin_goods_imports(id,actor_id,state,plan) values("+literal(batch_id)+","+literal(actor)+",'ready',jsonb_build_array(jsonb_build_object('kind','update','rows','[1]'::jsonb,'guidanceOnly',true,'target',jsonb_build_object('previous_id',"+literal(good)+",'code',"+literal(code)+"),'fingerprint',private.goods_import_fingerprint("+literal(good)+"),'guidance',"+literal(payload)+"::jsonb)));" )
 return batch_id
def commit(b):return 'select public.admin_commit_goods_import_group('+literal(b)+',0);'
def race(label,first,second):
 application='guidance-race-'+uuid.uuid4().hex[:12]
 a=subprocess.Popen(['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 a.stdin.write('set application_name='+literal(application)+';begin;'+auth()+first+'select pg_sleep(2.5);commit;');a.stdin.close()
 try:
  deadline=time.monotonic()+10
  while True:
   sleeping=sql("select count(*) from pg_stat_activity where datname="+literal(database)+" and application_name="+literal(application)+" and wait_event='PgSleep';")
   if sleeping=='1':break
   if a.poll() is not None:raise RuntimeError('first writer exited before lock hold: '+a.stderr.read())
   if time.monotonic()>deadline:raise RuntimeError('first writer never reached lock hold')
   time.sleep(.05)
  start=time.monotonic();b=as_json(sql('begin;'+auth()+second+'commit;'));elapsed=time.monotonic()-start
  a.wait(timeout=10);stdout=a.stdout.read();stderr=a.stderr.read();assert a.returncode==0,stderr
  assert elapsed>=1.5,('expected real row/actor/batch lock wait',elapsed)
  (out/('race-'+label+'.log')).write_text(stdout+stderr+'\nB: '+json.dumps(b,ensure_ascii=False)+'\nblockedSeconds: '+str(elapsed)+'\n')
  result={'case':label,'blockedSeconds':round(elapsed,3),'result':b};results.append(result);print('PASS race '+label+' '+json.dumps(result,ensure_ascii=False),flush=True);return b
 finally:
  if a.poll() is None:a.terminate();a.wait(timeout=10)
try:
 assert sql("select count(*) from auth.users where id="+literal(actor)+";")=='0', 'Reserved concurrency actor already exists in source clone'
 assert sql("select count(*) from public.goods where id="+literal(good)+";")=='0', 'Reserved concurrency good already exists in source clone'
 sql("insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values("+literal(actor)+",'authenticated','authenticated','guidance-race@example.test',now(),'{}','{}');update public.profiles set role='staff' where id="+literal(actor)+";insert into private.operator_memberships(profile_id,manager_role) values("+literal(actor)+",'primary');insert into public.ips(id,title,vertical_key) values('guidance-race-ip','동시성 합성 IP','character');insert into public.goods(id,ip_id,name,type,price,code) values("+literal(good)+",'guidance-race-ip','동시성 상품','문구',1000,"+literal(code)+");")
 b1=batch(101,{'afterSales':{'expectedRevision':0,'values':values_as},'sizeChart':{'expectedRevision':0,'values':values_size}})
 first="select public.admin_save_goods_size_chart("+literal(good)+",0,'a6c01490-0000-4000-8000-000000000201',"+literal(json.dumps(values_size,ensure_ascii=False))+"::jsonb);"
 result=race('child-size-cas-and-earlier-as-rollback',first,commit(b1));assert result['status']=='failed' and result['error']=='goods_size_chart_changed'
 state=as_json(sql("select jsonb_build_object('asRevision',private.goods_after_sales_document("+literal(good)+")->'revision','sizeRevision',private.goods_size_chart_document("+literal(good)+")->'revision','childAudits',(select count(*) from public.audit_log where actor_id="+literal(actor)+"));"));assert state=={'asRevision':0,'sizeRevision':1,'childAudits':1},state
 b2=batch(102,{'afterSales':{'expectedRevision':0,'values':values_as}})
 result=race('same-batch-concurrent-retry',commit(b2),commit(b2));assert result['status']=='success'
 state=as_json(sql("select jsonb_build_object('asRevision',private.goods_after_sales_document("+literal(good)+")->'revision','auditCount',(select count(*) from public.audit_log where actor_id="+literal(actor)+"));"));assert state=={'asRevision':1,'auditCount':3},state
 b3=batch(103,{'afterSales':{'expectedRevision':1,'values':values_as}})
 result=race('parent-row-fingerprint-cas',"select public.admin_save_good(to_jsonb(g)||jsonb_build_object('previous_id',g.id,'publish',false,'name','동시 수정된 상품')) from public.goods g where g.id="+literal(good)+";",commit(b3));assert result['status']=='failed' and result['error']=='import_product_changed'
 state=as_json(sql("select jsonb_build_object('asRevision',private.goods_after_sales_document("+literal(good)+")->'revision','name',(select name from public.goods where id="+literal(good)+"));"));assert state=={'asRevision':1,'name':'동시 수정된 상품'},state
 summary={'status':'PASS','cases':results,'scope':'Committed fixtures only in disposable clone; clone deletion removes all fixtures.'}
except Exception as error:
 summary={'status':'FAILED','error':str(error),'cases':results}
 raise
finally:
 cleanup_clone()
 summary.update(cloneRemoved=True,temporaryDumpRemoved=True,container=container,sourcePort=source_port,database=database,sourceDatabaseModified=False)
 (out/'result.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')

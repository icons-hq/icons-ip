"""Exercise lock-order recovery only inside the caller's fresh, owned clone."""
import hashlib,json,os,re,subprocess,tempfile,time,uuid
from pathlib import Path

def verify(root,cid,database,lease,out,sql):
 assert re.fullmatch(r'[0-9a-f]{64}',cid)
 assert database=='icons_goods_transaction_'+lease.hex
 proof=sql("select current_database()<>'postgres' and exists(select 1 from private.operator_fixture_clone_identity where singleton and source_database='postgres' and lease='"+str(lease)+"' and container_id='"+cid+"');",'concurrency-lease')
 assert proof=='t'
 fixture=(root/'supabase/tests/group_claim_stock_successions.sql').read_text().split("select 1/case when good_id='gs-good-3'")[0]
 # The shared SQL chooses owner only for an unconfigured clone; do not rewrite
 # its role and collide with earlier committed financial/common fixtures.
 sql(fixture+'\ncommit;','concurrency-fixture')
 ident=lambda kind,n:str(uuid.UUID(hashlib.md5(f'group-stock:{kind}:{n}'.encode()).hexdigest()))
 command=['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
 def launch(name,body):
  process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
  process.stdin.write("set application_name='"+name+"';set statement_timeout='8s';"+body);process.stdin.close();process.stdin=None
  return process
 def observe(name,predicate):
  deadline=time.monotonic()+4
  while time.monotonic()<deadline:
   if sql("select exists(select 1 from pg_stat_activity where datname=current_database() and application_name='"+name+"' and ("+predicate+"));",'concurrency-observe')=='t':return
   time.sleep(.025)
  raise AssertionError('Concurrent state was not observed: '+name)
 def finish(name,process,expected=None):
  stdout,stderr=process.communicate(timeout=10);(out/(name+'.log')).write_text(stdout+stderr)
  if expected:assert process.returncode!=0 and expected in stderr,(name,stderr)
  else:assert process.returncode==0,(name,stderr)
 receipt_scope=" where order_item_id in("+','.join("'"+ident('item',n)+"'" for n in range(1,9))+")"
 def restore(n):return "select private.restore_order_item_supply('"+ident('item',n)+"','TEST 동시 반품');"
 topo="select pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));"
 # Order/source-row-first caller meets a converter that owns topology first.
 # TRY-SHARED must abort the return, releasing the row and allowing conversion.
 returner=launch('gs-return-row-first',"begin;select 1 from public.goods where id='gs-good-1' for update;select pg_sleep(1.3);"+restore(1)+"commit;")
 observe('gs-return-row-first',"wait_event='PgSleep'")
 converter=launch('gs-convert-topology-first',"begin;"+topo+"select 1 from public.goods where id='gs-good-1' for update;commit;")
 observe('gs-convert-topology-first','cardinality(pg_blocking_pids(pid))>0')
 finish('gs-return-row-first',returner,'goods_group_retry');finish('gs-convert-topology-first',converter)
 assert sql("select count(*) from private.group_stock_restorations"+receipt_scope+";",'try-shared-no-receipt')=='0'
 # A return owns shared topology until commit. The converter waits for it.
 returner=launch('gs-return-topology-first',"begin;"+restore(1)+"select pg_sleep(1.3);commit;")
 observe('gs-return-topology-first',"wait_event='PgSleep'")
 converter=launch('gs-convert-second',"begin;"+topo+"commit;")
 observe('gs-convert-second','cardinality(pg_blocking_pids(pid))>0')
 finish('gs-return-topology-first',returner);finish('gs-convert-second',converter)
 # Exact concurrent restore retries serialize on the same owning order and
 # produce one receipt and one +2 delta, even before any outer cancellation.
 first=launch('gs-restore-first',"begin;"+restore(2)+"select pg_sleep(1.3);commit;")
 observe('gs-restore-first',"wait_event='PgSleep'")
 second=launch('gs-restore-retry',"begin;"+restore(2)+"commit;")
 observe('gs-restore-retry','cardinality(pg_blocking_pids(pid))>0')
 finish('gs-restore-first',first);finish('gs-restore-retry',second)
 # An unrelated target metadata/stock writer cannot create a row-lock wait
 # beneath our shared topology. The return aborts atomically with PT409.
 holder=launch('gs-target-row-first',"begin;select 1 from public.goods where id='gs-good-3' for update;select pg_sleep(1.3);commit;")
 observe('gs-target-row-first',"wait_event='PgSleep'")
 returner=launch('gs-target-nowait',"begin;"+restore(3)+"commit;")
 finish('gs-target-nowait',returner,'goods_group_retry');finish('gs-target-row-first',holder)
 state=json.loads(sql("select json_build_object('terminalStock',(select stock_qty from public.goods where id='gs-good-3'),'restorations',(select count(*) from private.group_stock_restorations"+receipt_scope+"),'sourceStock',(select stock_qty from public.goods_variants where id='"+ident('old',1)+"'));",'concurrency-final'))
 assert state=={'terminalStock':14,'restorations':2,'sourceStock':0},state
 report={'status':'PASS','trySharedBreaksSourceRowTopologyCycle':True,'converterWaitsForReturnCommit':True,'concurrentGenerationRestoreIsOnce':True,'targetRowConflictFailsAtomically':True,'state':state}
 (out/'concurrency-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
 return report


if __name__ == '__main__':
 cid=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['PGDATABASE'];lease=uuid.UUID(os.environ['GROUP_CLAIM_STOCK_LEASE'])
 assert re.fullmatch(r'[0-9a-f]{64}',cid) and database=='icons_goods_transaction_'+lease.hex
 command=['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
 with tempfile.TemporaryDirectory(prefix='group-claim-stock-race-') as directory:
  out=Path(directory)
  def sql(body,name):
   result=subprocess.run(command,input=body,text=True,capture_output=True,timeout=20)
   (out/(name+'.log')).write_text(result.stdout+result.stderr)
   if result.returncode:raise RuntimeError(result.stderr)
   return result.stdout.strip()
  report=verify(Path(__file__).resolve().parents[2],cid,database,lease,out,sql)
  print(json.dumps(report,ensure_ascii=False),flush=True)

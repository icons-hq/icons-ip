"""Exercise category-tree/goods lock inversion only in this task's owned local DB."""
import argparse, concurrent.futures, json, subprocess, time, uuid
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('--runtime-json',required=True);parser.add_argument('--output',required=True);args=parser.parse_args()
runtime=json.loads(Path(args.runtime_json).read_text());cid=runtime['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert runtime['projectId']=='icons-ip-full-admin-f08f2f52' and meta['Id']==cid and meta['Name']=='/supabase_db_'+runtime['projectId'] and meta['State']['Running']
run=uuid.uuid4().hex[:8];category=str(uuid.uuid4());good='coupon-lock-'+run
base=['docker','exec','-i',cid,'psql','-XqAt','-U','postgres','-d','postgres']
def sql(statement):
 return subprocess.run(base+['-v','ON_ERROR_STOP=1'],input=statement,text=True,capture_output=True,timeout=8)
def send(process,statement):
 process.stdin.write(statement+'\n');process.stdin.flush()
def marker(process,expected):
 # psql flushes each SELECT result; all statements here have bounded lock timeouts.
 for line in process.stdout:
  if line.strip()==expected:return
 raise AssertionError('Session ended before '+expected)
seed=sql(f"begin;insert into public.catalog_categories(id,code,name) values('{category}','{good}','TEST 카테고리 잠금');insert into public.ips(id,title,vertical_key) values('{good}','TEST 잠금 IP','character');insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,category_id) values('{good}','{good}','TEST 잠금 상품','문구',10000,'ok',1,'{category}');commit;")
assert seed.returncode==0,seed.stderr
matcher=f"select private.coupon_good_matches('selected_categories','{{}}',array['{category}']::uuid[],'{good}');"
a=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
b=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
try:
 send(a,f"begin;set local lock_timeout='3s';select id from public.goods where id='{good}' for update;select 'A_READY';");marker(a,'A_READY')
 send(b,"begin;set local lock_timeout='3s';select pg_advisory_xact_lock(hashtextextended('catalog_category_tree',0));select 'B_READY';");marker(b,'B_READY')
 send(b,f"update public.goods set category_id=category_id where id='{good}';commit;select 'B_DONE';")
 started=time.monotonic();a_out,a_err=a.communicate(matcher+"rollback;\n",timeout=6);b_out,b_err=b.communicate(timeout=6);elapsed=time.monotonic()-started
 assert 'coupon_category_changed' in a_err and 'deadlock' not in a_err and 'B_DONE' in b_out and not b_err,(a_err,b_err)
 assert elapsed<3,'Readers must not wait on a tree writer blocked by the same goods row'
 holder=subprocess.Popen(base,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
 try:
  send(holder,"begin;select pg_advisory_xact_lock(hashtextextended('catalog_category_tree',0));select 'LOCKED';");marker(holder,'LOCKED')
  with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:results=list(pool.map(lambda _:sql(matcher),range(12)))
  assert all(result.returncode and 'coupon_category_changed' in result.stderr for result in results)
 finally:holder.communicate('rollback;\n',timeout=5)
 after=sql(matcher);assert after.returncode==0 and after.stdout.strip()=='t',after.stderr
 result={'status':'pass','run':run,'lockInversionSeconds':round(elapsed,3),'blockedReaders':len(results),'readAfterWriter':'eligible','deadlocks':0}
 Path(args.output).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
finally:
 for process in [a,b]:
  if process.poll() is None:process.communicate('rollback;\n',timeout=5)

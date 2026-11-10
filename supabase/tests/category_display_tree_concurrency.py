"""Real locks for tree CAS/content independence; only the disposable reviewed clone."""
from pathlib import Path
import json,os,re,subprocess,sys,time
container,database,directory=sys.argv[1:]
assert re.fullmatch(r'[0-9a-f]{64}',container), 'Use an immutable Docker container ID'
identity=json.loads(subprocess.check_output(['docker','inspect',container],text=True))[0]
assert identity['State']['Running'] and identity['Id']==container
assert identity['Name']=='/supabase_db_'+identity['Config']['Labels']['com.supabase.cli.project']
if re.fullmatch(r'icons_category_display_concurrency_[0-9]+_[0-9]+',database):
 scope=os.environ.get('CATEGORY_DISPLAY_TEST_SCOPE');assert scope in ('ci','isolated-local')
 if scope=='ci':assert os.environ.get('CI')=='true' and os.environ.get('GITHUB_ACTIONS')=='true' and identity['Config']['Labels']['com.supabase.cli.project']=='icons-ip'
else:
 assert container=='3178a8e2c320af8c1384b0c2089ec0ae007c7afd0408d45052b1cfc7112e1725'
 assert re.fullmatch(r'icons_category_display_canonical_[0-9a-f]{10}',database)
out=Path(directory);out.mkdir();command=['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
def uid(n):return '94932000-0000-4000-8000-'+str(n).zfill(12)
actor,other=uid(1),uid(2);results=[]
def run(body,name):
 r=subprocess.run(command,input=body,text=True,capture_output=True,timeout=25);(out/(name+'.log')).write_text(r.stdout+r.stderr)
 if r.returncode:raise RuntimeError(name+': '+r.stderr[-3000:])
 return r.stdout.strip()
def revision():return int(run('select revision from private.category_display_tree_control where singleton;','revision'))
def auth(who):return "set local role authenticated;select set_config('request.jwt.claim.sub','"+who+"',true);"
def mutation(change,expected,operation):
 payload=json.dumps(change,ensure_ascii=False).replace("'","''")
 return "select public.admin_update_category_display_tree('"+payload+"',"+str(expected)+",'"+uid(operation)+"');"
def change(action,n,name=None,parent=None,position=0):
 result={'action':action,'id':uid(n)}
 if action in('create','update'):result.update(name=name,parentId=uid(parent) if parent else None,position=position)
 return result
pause='select pg_sleep(1.2);'
def start(body,name):
 stream=(out/(name+'.log')).open('w');p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=stream,stderr=stream,text=True)
 p.stdin.write("begin;set local lock_timeout='7s';set local statement_timeout='12s';set local application_name='"+name+"';"+body+'commit;');p.stdin.close();return p,stream
def wait(name,condition,p):
 limit=time.monotonic()+6
 while time.monotonic()<limit:
  state=run("select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') from pg_stat_activity where application_name='"+name+"';",'wait-state')
  if condition in state:return
  if p.poll() is not None:raise RuntimeError(name+' exited before '+condition+': '+(out/(name+'.log')).read_text()[-1500:])
  time.sleep(.025)
 raise RuntimeError('Did not observe '+condition)
def pair(name,first,second,second_error,expected):
 names=['display-tree-'+name+'-a','display-tree-'+name+'-b'];a,alog=start(first,names[0]);b=blog=None
 try:
  wait(names[0],'PgSleep',a);b,blog=start(second,names[1]);wait(names[1],'Lock:',b)
  assert a.wait(timeout=15)==0,(out/(names[0]+'.log')).read_text()
  status=b.wait(timeout=15);output=(out/(names[1]+'.log')).read_text()
  assert (status==0 if second_error is None else status!=0 and second_error in output and '40P01' not in output),output
  assert revision()==expected
  if name=='same-operation':
   receipts=[next(json.loads(line) for line in (out/(key+'.log')).read_text().splitlines() if line.startswith('{')) for key in names];assert receipts[0]==receipts[1]
  results.append({'case':name,'blockedSecondObserved':True,'secondSqlstate':second_error,'revision':expected,'status':'PASS'});print('PASS '+name,flush=True)
 finally:
  for p,stream in [(a,alog),(b,blog)]:
   if p is not None and p.poll() is None:p.terminate();p.wait(timeout=3)
   if stream is not None:stream.close()
run("""insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
values('"""+actor+"','authenticated','authenticated','display-tree-race-a@example.test',now(),'{\"testFixture\":\"display-tree-race\"}','{}'),('"+other+"','authenticated','authenticated','display-tree-race-b@example.test',now(),'{\"testFixture\":\"display-tree-race\"}','{}');"+
"update public.profiles set role='staff' where id in('"+actor+"','"+other+"');insert into private.operator_memberships(profile_id,manager_role) values('"+actor+"','primary'),('"+other+"','primary');update private.operator_access_state set configured=true where id;update private.category_display_nodes set archived_at=clock_timestamp() where parent_id is null;",'fixture')
r=revision()
pair('create-cas',auth(actor)+mutation(change('create',10,'첫 전시'),r,100)+pause,auth(other)+mutation(change('create',11,'다른 전시'),r,101),'PT409',r+1)
r=revision();command_change=change('create',11,'둘째 전시',position=1)
pair('same-operation',auth(actor)+mutation(command_change,r,102)+pause,auth(actor)+mutation(command_change,r,102),None,r+1)
r=revision()
pair('cross-parent-cycle',auth(actor)+mutation(change('update',10,'첫 전시',11),r,103)+pause,auth(other)+mutation(change('update',11,'둘째 전시',10),r,104),'PT409',r+1)
# A fresh revision must still reject a cycle rather than relying on stale CAS.
r=revision();failed=subprocess.run(command,input='begin;'+auth(other)+mutation(change('update',11,'둘째 전시',10),r,105)+'rollback;',text=True,capture_output=True)
(out/'fresh-cycle.log').write_text(failed.stdout+failed.stderr);assert failed.returncode and '23514' in failed.stderr
values=json.loads(next(line for line in run('begin;'+auth(actor)+"select public.admin_get_category_display('"+uid(10)+"')->'values';rollback;",'values').splitlines() if line.startswith('{')));values.update(mode='manual')
def composition(op,rev=0):return "select public.admin_save_category_display('"+uid(10)+"','"+json.dumps(values)+"',"+str(rev)+",'"+uid(op)+"');"
r=revision();pair('rename-and-composition',auth(actor)+mutation(change('update',10,'이름만 변경',11),r,106)+pause,auth(other)+composition(107),None,r+1)
assert run("select name from private.category_display_nodes where id='"+uid(10)+"';",'renamed')=='이름만 변경'
r=revision();pair('archive-and-composition',auth(actor)+mutation(change('archive',11),r,108)+pause,auth(other)+composition(109,1),None,r+1)
assert run("select (private.category_display_category('"+uid(10)+"')->>'publicEnabled')::boolean=false and (select revision=2 from private.category_display_compositions where category_id='"+uid(10)+"');",'archive-content-preserved')=='t'
run("update private.category_display_nodes set archived_at=clock_timestamp() where parent_id is null;insert into private.category_display_nodes(id,name,sort_order) select ('94932000-0000-4000-8000-'||lpad((200+n)::text,12,'0'))::uuid,'한도 전시 '||n,n from generate_series(1,18)n;",'capacity-fixture')
r=revision();pair('root-capacity',auth(actor)+mutation(change('create',300,'19번째'),r,110)+pause,auth(other)+mutation(change('create',301,'20번째'),r,111),'PT409',r+1)
r=revision();failed=subprocess.run(command,input='begin;'+auth(other)+mutation(change('create',301,'20번째'),r,112)+'rollback;',text=True,capture_output=True)
(out/'fresh-capacity.log').write_text(failed.stdout+failed.stderr);assert failed.returncode and '23514' in failed.stderr
assert run('select count(*) from private.category_display_nodes where parent_id is null and archived_at is null;','capacity-readback')=='19'
(out/'result.json').write_text(json.dumps({'status':'PASS','tests':results,'freshRevisionCycleAndCapacityRejected':True},indent=2))

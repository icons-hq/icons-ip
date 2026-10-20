#!/usr/bin/env python3
# Real row-lock races; invoked only in the disposable database owned by the shell wrapper.
import subprocess,json,time,pathlib,os,re
container=os.environ['SUPABASE_DB_CONTAINER']
database=os.environ['PGDATABASE']
if os.environ.get('GOODS_SIZE_CHART_TEST_SCOPE') not in ('ci','isolated-local') or not re.fullmatch(r'icons_goods_size_charts_concurrency_[0-9_]+',database):
 raise SystemExit('Run through goods_size_charts_concurrency.sh against its disposable copied database')
cmd=['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-Atq','-v','ON_ERROR_STOP=1']
actor='98060000-0000-4000-8000-000000000001'
owner='98060000-0000-4000-8000-000000000002'
chart={'unit':'cm','sizes':['합성'],'measurements':[{'name':'둘레','values':['42.7']}],'note':''}
values={'enabled':True,'chart':chart}
def sql(x,check=True):
 p=subprocess.run(cmd,input=x,text=True,capture_output=True)
 if check and p.returncode: raise RuntimeError(p.stderr)
 return p
def quoted(x): return "'"+x.replace("'","''")+"'"
def save(rev,op,v):return "select public.admin_save_goods_size_chart('size-chart-race',%s,%s,%s::jsonb);"%(rev,quoted(op),quoted(json.dumps(v,ensure_ascii=False)))
def auth():return "select set_config('request.jwt.claim.sub',%s,true);set local role authenticated;"%quoted(actor)
def race(first,second):
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 p.stdin.write('begin;'+auth()+first+"select '__FIRST_WRITER_SAVED__';select pg_sleep(0.6);commit;");p.stdin.close()
 observed=[]
 for line in p.stdout:
  observed.append(line)
  if '__FIRST_WRITER_SAVED__' in line:break
 else: raise RuntimeError('First worker did not reach lock barrier: '+p.stderr.read())
 started=time.monotonic();result=sql('begin;'+auth()+second+'commit;',False);elapsed=time.monotonic()-started
 rest=p.stdout.read();errors=p.stderr.read();status=p.wait()
 if status:raise RuntimeError(errors)
 return {'firstExit':status,'secondExit':result.returncode,'secondElapsedSeconds':round(elapsed,3),'secondOutput':result.stdout,'secondError':result.stderr,'firstOutput':''.join(observed)+rest}
report={}
seeded=False
original_access=json.loads(sql("select jsonb_build_object('configured',configured,'ownerExists',exists(select 1 from private.operator_memberships where manager_role='owner')) from private.operator_access_state where id;").stdout)
owner_fixture="" if original_access['ownerExists'] else "insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values(%s,'authenticated','authenticated','size-race-owner@example.test',now(),'{}','{}');update public.profiles set role='admin' where id=%s;insert into private.operator_memberships(profile_id,manager_role) values(%s,'owner');"%(quoted(owner),quoted(owner),quoted(owner))
try:
 sql("begin;select set_config('request.jwt.claim.sub','',true);"+owner_fixture+"insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values(%s,'authenticated','authenticated','size-race@example.test',now(),'{}','{}');update public.profiles set role='staff' where id=%s;insert into private.operator_memberships(profile_id,manager_role) values(%s,'primary');update private.operator_access_state set configured=true where id;insert into public.ips(id,title,vertical_key) values('size-chart-race-ip','사이즈 경합 합성 IP','character');insert into public.goods(id,ip_id,name,type,price) values('size-chart-race','size-chart-race-ip','사이즈 경합 합성','문구',1700);commit;"%(quoted(actor),quoted(actor),quoted(actor)))
 seeded=True
 assert sql("select manager_role from private.operator_memberships where profile_id=%s;"%quoted(actor)).stdout.strip()=='primary'
 first='98060000-0000-4000-8000-000000000101';second='98060000-0000-4000-8000-000000000102'
 changed=json.loads(json.dumps(values));changed['chart']['note']='경합에서 거절돼야 할 값'
 report['casRace']=race(save(0,first,values),save(0,second,changed))
 assert report['casRace']['secondExit']!=0 and 'goods_size_chart_changed' in report['casRace']['secondError']
 state=json.loads(sql("select jsonb_build_object('revision',revision,'chart',chart,'auditCount',(select count(*) from public.audit_log where actor_id=%s)) from private.goods_size_charts where good_id='size-chart-race';"%quoted(actor)).stdout)
 assert state['revision']==1 and state['chart']==chart and state['auditCount']==1
 report['casReadback']=state
 op='98060000-0000-4000-8000-000000000103';disabled={**values,'enabled':False}
 report['sameOperationRace']=race(save(1,op,disabled),save(1,op,disabled))
 assert report['sameOperationRace']['secondExit']==0
 state=json.loads(sql("select jsonb_build_object('revision',revision,'enabled',enabled,'chart',chart,'auditCount',(select count(*) from public.audit_log where actor_id=%s)) from private.goods_size_charts where good_id='size-chart-race';"%quoted(actor)).stdout)
 assert state['revision']==2 and not state['enabled'] and state['chart']==chart and state['auditCount']==2
 report['sameOperationReadback']=state
finally:
 if seeded:
  fixture_users=quoted(actor) if original_access['ownerExists'] else quoted(actor)+','+quoted(owner)
  sql("begin;select set_config('request.jwt.claim.sub','',true);delete from private.goods_size_charts where good_id='size-chart-race';delete from public.goods where id='size-chart-race';delete from public.ips where id='size-chart-race-ip';delete from public.audit_log where actor_id=%s;update private.operator_access_state set configured=%s where id;delete from private.operator_memberships where profile_id in (%s);delete from auth.users where id in (%s);commit;"%(quoted(actor),str(original_access['configured']).lower(),fixture_users,fixture_users))
  report['cleanup']=json.loads(sql("select jsonb_build_object('goods',(select count(*) from public.goods where id='size-chart-race'),'users',(select count(*) from auth.users where id in (%s)),'audits',(select count(*) from public.audit_log where actor_id=%s));"%(fixture_users,quoted(actor))).stdout)
  assert all(v==0 for v in report['cleanup'].values())
  assert json.loads(sql("select jsonb_build_object('configured',configured,'ownerExists',exists(select 1 from private.operator_memberships where manager_role='owner')) from private.operator_access_state where id;").stdout)==original_access
  output=os.environ.get('GOODS_SIZE_CHART_TEST_OUTPUT')
  if output: pathlib.Path(output).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'cas':'passed','sameOperation':'passed','cleanup':report['cleanup']},ensure_ascii=False))

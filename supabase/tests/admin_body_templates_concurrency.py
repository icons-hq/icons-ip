"""Verify template CAS, replay and owner quota with two genuinely blocked sessions."""
from pathlib import Path
import concurrent.futures,json,os,re,subprocess,time
container=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['PGDATABASE'];label='body-template-'+str(os.getpid());out=Path(os.environ['BODY_TEMPLATE_TEST_OUTPUT_DIR']);out.mkdir(parents=True,exist_ok=True)
if os.environ.get('BODY_TEMPLATE_TEST_SCOPE') not in ['ci','isolated-local'] or not re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+',container) or not re.fullmatch(r'icons_body_templates_concurrency_[0-9_]+',database):
 raise SystemExit('Use the explicitly scoped disposable body-template wrapper')
actor='a7b31400-0000-4000-8000-000000000001'
def ident(kind,n):return f'a7b314{kind:02d}-0000-4000-8000-{n:012d}'
def command(app):return ['docker','exec','-i','-e','PGAPPNAME='+app,container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
def run(sql,name):
 r=subprocess.run(command('body-template-'+label+'-'+name),input=sql,text=True,capture_output=True,timeout=15);(out/(label+'-'+name+'.log')).write_text(r.stdout+r.stderr);return r
setup=f"""begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values('{actor}','authenticated','authenticated','body-template-race@example.test',now(),'{{"testFixture":"body-template-clone-race"}}','{{}}');
update public.profiles set role='staff',nickname='본문경합합성',birth_date='1990-01-01',onboarded_at=now() where id='{actor}';
insert into private.operator_memberships(profile_id,manager_role) values('{actor}',case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end);
update private.operator_access_state set configured=true where id;
set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);
do $$declare n integer;begin for n in 1..49 loop perform public.admin_save_goods_body_template('{actor}',('a7b31410-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,0,gen_random_uuid(),'경합 합성 '||n,'<p>경합 초기 본문</p>');end loop;end $$;
select public.admin_archive_story_body_template('{actor}','{ident(10,49)}',1,'{ident(20,49)}',true);commit;
"""
r=run(setup,'race-fixtures');assert r.returncode==0,r.stderr
prefix=f"begin;set local statement_timeout='8s';set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);\n"
results=[]
def compete(case,sql_a,sql_b,expected_b):
 app_a='body-template-'+label+'-'+case+'-a';app_b='body-template-'+label+'-'+case+'-b'
 first=subprocess.Popen(command(app_a),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);lines=[]
 try:
  first.stdin.write(prefix+sql_a+"\nselect 'BODY_TEMPLATE_LOCK_HELD';\n");first.stdin.flush()
  while True:
   line=first.stdout.readline()
   if not line:raise RuntimeError('first session failed: '+first.stderr.read())
   lines.append(line)
   if line.strip()=='BODY_TEMPLATE_LOCK_HELD':break
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(subprocess.run,command(app_b),input=prefix+sql_b+'\ncommit;\n',text=True,capture_output=True,timeout=15)
   blocked=False
   for _ in range(60):
    probe=run("select count(*) from pg_stat_activity where datname=current_database() and application_name='"+app_b+"' and wait_event_type='Lock';",case+'-lock-probe')
    if probe.stdout.strip()=='1':blocked=True;break
    if future.done():break
    time.sleep(0.025)
   assert blocked,'second transaction did not actually wait on the first: '+case
   first.stdin.write('commit;\n');first.stdin.flush();a_out,a_err=first.communicate(timeout=12);a_text=''.join(lines)+a_out
   second=future.result(timeout=12);(out/(label+'-'+case+'-a.log')).write_text(a_text+a_err);(out/(label+'-'+case+'-b.log')).write_text(second.stdout+second.stderr)
   assert first.returncode==0,a_err
   if expected_b is None:
    assert second.returncode==0,second.stderr
    a_json=[json.loads(s) for s in a_text.splitlines() if s.startswith('{')][-1];b_json=[json.loads(s) for s in second.stdout.splitlines() if s.startswith('{')][-1];assert a_json==b_json
   else:assert second.returncode!=0 and expected_b in second.stderr,second.stderr
   results.append({'case':case,'status':'PASS','twoSessionsActuallyBlocked':True,'secondOutcome':'same original receipt' if expected_b is None else expected_b});print(label+' PASS race '+case,flush=True)
 finally:
  if first.poll() is None:
   try:first.stdin.write('rollback;\n');first.stdin.flush();first.communicate(timeout=10)
   except Exception:first.kill();first.communicate()
cas_a=f"select public.admin_save_goods_body_template('{actor}','{ident(10,1)}',1,'{ident(20,1)}','경합 첫 저장','<p>첫 본문</p>');"
cas_b=f"select public.admin_save_story_body_template('{actor}','{ident(10,1)}',1,'{ident(20,2)}','경합 오래된 저장','<p>둘째 본문</p>');"
compete('same-revision',cas_a,cas_b,'body_template_conflict')
replay=f"select public.admin_save_goods_body_template('{actor}','{ident(10,2)}',1,'{ident(20,3)}','경합 중복 요청','<p>중복 본문</p>');"
compete('same-operation',replay,replay,None)
quota_a=f"select public.admin_save_goods_body_template('{actor}','{ident(10,50)}',0,'{ident(20,4)}','50번째','<p>50번째 본문</p>');"
quota_b=f"select public.admin_save_story_body_template('{actor}','{ident(10,51)}',0,'{ident(20,5)}','51번째','<p>51번째 본문</p>');"
compete('owner-quota',quota_a,quota_b,'body_template_limit')
q=f"""select jsonb_build_object('total',(select count(*) from private.admin_body_templates where owner_id='{actor}'),'archived',(select count(*) from private.admin_body_templates where owner_id='{actor}' and archived_at is not null),
'firstRevision',(select revision from private.admin_body_templates where id='{ident(10,1)}'),'replayRevision',(select revision from private.admin_body_templates where id='{ident(10,2)}'),
'replayAudit',(select count(*) from public.audit_log where id='{ident(20,3)}'),'loserAudits',(select count(*) from public.audit_log where id in('{ident(20,2)}','{ident(20,5)}')),
'lastAbsent',not exists(select 1 from private.admin_body_templates where id='{ident(10,51)}'));
"""
r=run(q,'race-final-readback');assert r.returncode==0,r.stderr;readback=json.loads(r.stdout);assert readback=={'total':50,'archived':1,'firstRevision':2,'replayRevision':2,'replayAudit':1,'loserAudits':0,'lastAbsent':True},readback
(out/(label+'-concurrency-result.json')).write_text(json.dumps({'status':'PASS','database':database,'cases':results,'readback':readback,'fixtureLifetime':'Disposable clone only; removed with the clone'},ensure_ascii=False,indent=2))

"""Synthetic local races: kind uniqueness and policy CAS versus review creation."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid]))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and meta['Id']==cid and meta['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-1700:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:8]
fixture=Path('supabase/tests/review_types.sql').read_text().split('create function pg_temp.policy_values')[0].replace('c7160750',run).replace('review-types',f'review-{run}').replace('TEST 리뷰유형 회귀',f'TEST review {run}')
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text()+fixture+'\ncommit;')
def prefix(actor):
 who=f'{run}-0000-4000-8000-{actor:012}';session=f'{run}-0000-4000-9000-{actor:012}';jwt=json.dumps({'sub':who,'session_id':session,'role':'authenticated'})
 return f"begin;set local lock_timeout='20s';select set_config('request.jwt.claims','{jwt}',true);set local role authenticated;"
old=json.loads(sql('select private.review_type_policy_document();'))
values={'enabled':True,'basis':'delivered','startDays':31,'endDays':90,'maxOrderDays':365,'rewardEligible':False,'evidence':'TEST concurrent review policy','confirmed':True}
def policy(values,revision):
 return sql(prefix(1)+f"select public.admin_save_review_type_policy('{json.dumps(values)}',{revision},'{uuid.uuid4()}','{run}-0000-4000-8000-000000000001','{run}-0000-4000-9000-000000000001');commit;").splitlines()[-1]
try:
 active=json.loads(policy(values,old['revision']))
 barrier=threading.Barrier(16)
 def create(n):
  barrier.wait(timeout=15);kind='ordinary' if n%2 else 'month'
  try:sql(prefix(2)+f"select public.create_good_review_v2('{run}-0000-4001-8000-000000000002','review-{run}-a',5,'TEST concurrent review','{{}}','{kind}');commit;");return kind+':saved'
  except RuntimeError as e:
   assert 'review_already_exists' in str(e),str(e);return kind+':duplicate'
 with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:created=list(pool.map(create,range(16)))
 assert created.count('ordinary:saved')==1 and created.count('month:saved')==1,created
 barrier=threading.Barrier(9);disabled={**values,'enabled':False}
 def change(n):
  barrier.wait(timeout=15)
  try:
   if n==0:sql(prefix(2)+f"select public.create_good_review_v2('{run}-0000-4001-8000-000000000003','review-{run}-a',4,'TEST policy race review','{{}}','month');commit;");return 'review:saved'
   policy(disabled,active['revision']);return 'policy:saved'
  except RuntimeError as e:
   expected='review_month_window_closed' if n==0 else 'review_type_policy_changed';assert expected in str(e),str(e);return 'review:disabled' if n==0 else 'policy:stale'
 with concurrent.futures.ThreadPoolExecutor(max_workers=9) as pool:raced=list(pool.map(change,range(9)))
 assert raced.count('policy:saved')==1 and raced.count('policy:stale')==7,raced
 proof=json.loads(sql(f"select jsonb_build_object('byKind',(select jsonb_object_agg(review_kind,n) from(select review_kind,count(*)n from public.reviews where order_id='{run}-0000-4001-8000-000000000002' group by review_kind)x),'monthlyRewards',(select count(*) from public.reviews where user_id='{run}-0000-4000-8000-000000000002' and month_reward_eligible),'policyEnabled',(select enabled from private.review_type_policy where singleton));"))
 assert proof['byKind']=={'month':1,'ordinary':1} and proof['monthlyRewards']==0 and proof['policyEnabled']==False,proof
 print(json.dumps({'run':run,'creationRace':created,'policyRace':raced,'readback':proof},indent=2))
finally:
 current=json.loads(sql('select private.review_type_policy_document();'))
 restored={k:old[k] for k in ['enabled','basis','startDays','endDays','maxOrderDays','rewardEligible']};restored.update(evidence='TEST restore pre-race local policy',confirmed=True)
 policy(restored,current['revision'])

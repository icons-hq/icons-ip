"""Actual shipping-template operation/CAS races in an owned disposable clone."""
if not __debug__:raise SystemExit('Optimized Python is not allowed for database fixture tools')
import json,os,re,subprocess,time,uuid
from pathlib import Path
cid=os.environ['SUPABASE_DB_CONTAINER'];db=os.environ['PGDATABASE'];lease=uuid.UUID(os.environ['SHIPPING_SETTINGS_LEASE'])
assert re.fullmatch(r'[0-9a-f]{64}',cid) and db=='icons_goods_transaction_'+lease.hex
metadata=json.loads(subprocess.check_output(['docker','inspect',cid],text=True))[0]
assert metadata['Id']==cid and metadata['State']['Running'] and re.fullmatch(r'/supabase_db_icons-ip(?:-[a-z0-9]+)*',metadata['Name'])
assert metadata['Config']['Labels']['com.supabase.cli.project']==metadata['Name'].removeprefix('/supabase_db_')
cmd=['docker','exec','-i',cid,'psql','-X','-qAt','-U','supabase_admin','-d',db,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
prefix='st-race-'+uuid.uuid4().hex[:8];processes=[];passed=[]
def quote(value):return "'"+value.replace("'","''")+"'"
def js(value):return quote(json.dumps(value,ensure_ascii=False,separators=(',',':')))+'::jsonb'
def ident(n):return 'a7150000-0000-4000-8000-'+str(n).zfill(12)
actor=ident(1);session=ident(11)
def sql(body):
 p=subprocess.run(cmd,input=body,text=True,capture_output=True,timeout=30)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
assert json.loads(sql('begin read only;select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;rollback;'))['lease']==str(lease)
assert sql('begin read only;select container_id||\':\'||source_database from private.operator_fixture_clone_identity where singleton;rollback;')==cid+':postgres'
def auth(actor_id=actor,session_id=session,role=True):
 return ('set local role authenticated;' if role else '')+'set local request.jwt.claim.sub='+quote(actor_id)+';set local request.jwt.claims='+quote(json.dumps({'sub':actor_id,'role':'authenticated','session_id':session_id}))+';'
def policy(mode='collect',kind='tier3'):
 terms={'kind':kind,'baseFee':3000,'firstLimit':2,'extra1':1000}
 if kind=='tier3':terms.update(secondLimit=5,extra2=2500)
 return {'status':'active','paymentMode':mode,'quantityTerms':terms,'draftValues':{}}
def settings():return {'originId':ident(102),'feeType':'free','individualFee':100,'claimPolicy':{'returnAllowed':True,'exchangeAllowed':True,'restrictionReason':None,'returnFee':0,'returnFreeShippingFee':None,'exchangeFee':6000},'delivery':{'mode':'replace','policy':policy()}}
def context(operation,command='apply',template=202,revision=1,actor_id=actor,session_id=session):
 return {'operationId':ident(operation),'command':command,'templateId':ident(template),'expectedRevision':revision,'expectedActorId':actor_id,'expectedSessionId':session_id}
def save(operation,template=202,revision=0,name='TEST 경합 템플릿',session_id=session,actor_id=actor):
 return {**context(operation,'save',template,revision,actor_id=actor_id,session_id=session_id),'name':name,'enabled':True,'settings':settings()}
def preview(ids,template=202,actor_id=actor,session_id=session):
 return json.loads(sql('begin;'+auth(actor_id,session_id)+'select public.admin_preview_shipping_settings_template_v2('+quote(ident(template))+',array['+','.join(quote(n) for n in ids)+']::text[],'+quote(actor_id)+','+quote(session_id)+');commit;'))
def apply_request(operation,p):
 keys=('id','updatedAt','ownerGoodId','ownerUpdatedAt','familyGoodIds','transactionRevision','deliveryVersionId')
 return {**context(operation,'apply',int(p['template']['id'][-12:]),p['template']['revision'],actor_id=p['actorId'],session_id=p['sessionId']),'originUpdatedAt':p['origin']['updatedAt'],
  'collectRevision':p['origin']['collectRevision'],'collectVersionId':p['origin']['collectVersionId'],'goods':[{k:v[k] for k in keys} for v in p['goods']]}
def operation_body(request):
 return auth(request['expectedActorId'],request['expectedSessionId'])+'select public.admin_'+('save_shipping_settings_template_v2' if request['command']=='save' else 'apply_shipping_settings_template_v2')+'('+js(request)+');'
def seal_body(request):return auth(request['expectedActorId'],request['expectedSessionId'])+'select public.admin_seal_shipping_settings_operation('+js({k:request[k] for k in ('operationId','command','templateId','expectedRevision','expectedActorId','expectedSessionId')})+');'
def start(label,body,delay=0):
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(p)
 p.stdin.write('set application_name='+quote(prefix+'-'+label)+";begin;set local lock_timeout='8s';"+body+(f'select pg_sleep({delay});' if delay else '')+'commit;')
 p.stdin.close();p.stdin=None;return p
def wait(label,event,p):
 for _ in range(200):
  if sql('select coalesce(wait_event_type,\'\') from pg_stat_activity where application_name='+quote(prefix+'-'+label)+';')==event:return
  if p.poll() is not None:raise RuntimeError(label+' ended before '+event+': '+str(p.communicate()))
  time.sleep(.02)
 raise RuntimeError(label+' never reached '+event)
def finish(p,error=None):
 out,err=p.communicate(timeout=15)
 if error:
  assert p.returncode and error in err,(out,err);assert '40P01' not in err and 'deadlock' not in err.lower(),err;return None
 assert p.returncode==0,err
 lines=[json.loads(line) for line in out.split('\n') if line.startswith('{')]
 return lines[-1] if lines else out.strip()
def done(name):passed.append(name);print('PASS '+name,flush=True)
def pair(name,left,right,error=None,equal=False):
 first=start(name+'-first',left,1.1);wait(name+'-first','Timeout',first)
 second=start(name+'-second',right);wait(name+'-second','Lock',second)
 a=finish(first);b=finish(second,error)
 if equal:assert a==b
 done(name);return a,b
def absent(operation):assert sql('select count(*) from private.shipping_settings_operations where operation_id='+quote(ident(operation))+';')=='0'
def contention(name,held,request,after_error=None):
 first=start(name+'-holder',held,1.1);wait(name+'-holder','Timeout',first)
 second=start(name+'-apply',operation_body(request));finish(second,'shipping_settings_retry');assert first.poll() is None
 finish(first);absent(int(request['operationId'][-12:]))
 if after_error:
  p=start(name+'-retry',operation_body(request));finish(p,after_error);absent(int(request['operationId'][-12:]))
 done(name)
try:
 fixture=(Path(__file__).parent/'shipping_settings_delivery_policies.sql').read_text().split('-- SHIPPING_TEMPLATE_FIXTURE_END')[0]
 sql(fixture+'\ncommit;');sql('update private.goods_transaction_runtime set enabled=true where singleton;')
 first_save=save(701)
 pair('same-save-one-revision',operation_body(first_save),operation_body(first_save),equal=True)
 assert sql('select revision from public.shipping_settings_templates where id='+quote(ident(202))+';')=='1'
 pair('distinct-save-cas',operation_body(save(702,revision=1,name='TEST 경합 변경')),operation_body(save(703,revision=1,name='TEST 늦은 변경',actor_id=ident(2),session_id=ident(12))),'shipping_settings_template_changed')
 absent(703)
 p=preview(['st-good-003','st-good-005']);request=apply_request(704,p)
 pair('same-apply-one-version',operation_body(request),operation_body(request),equal=True)
 assert sql("select count(*) from private.goods_delivery_versions where good_id in('st-good-003','st-good-005');")=='2'
 p=preview(['st-good-006','st-good-007'])
 deputy_preview=preview(['st-good-006','st-good-007'],actor_id=ident(2),session_id=ident(12))
 pair('distinct-apply-cas',operation_body(apply_request(705,p)),operation_body(apply_request(706,deputy_preview)),'shipping_settings_goods_changed')
 absent(706);assert sql("select count(*) from private.goods_delivery_versions where good_id in('st-good-006','st-good-007');")=='2'
 request=apply_request(707,preview(['st-good-008']))
 a,b=pair('apply-before-seal',operation_body(request),seal_body(request),equal=True);assert a['state']=='applied'
 request=apply_request(708,preview(['st-good-009']))
 a,b=pair('seal-before-late-apply',seal_body(request),operation_body(request),equal=True);assert a['state']=='sealed'
 assert sql("select count(*) from private.goods_transaction_configs where good_id='st-good-009';")=='0'
 request=save(709,template=203)
 a,b=pair('seal-before-late-save',seal_body(request),operation_body(request),equal=True);assert a['state']=='sealed'
 assert sql('select count(*) from public.shipping_settings_templates where id='+quote(ident(203))+';')=='0'
 request=save(710,template=204)
 pair('same-save-changed-payload',operation_body(request),operation_body({**request,'name':'TEST 다른 원문'}),'shipping_settings_operation_conflict')
 request=save(711,template=205)
 pair('same-operation-other-session',operation_body(request),operation_body({**request,'expectedSessionId':ident(13)}),'shipping_settings_operation_conflict')
 stale=preview(['st-good-010'],actor_id=ident(2),session_id=ident(12))
 pair('template-edit-versus-apply',operation_body(save(712,revision=2,name='TEST 최신 템플릿')),operation_body(apply_request(713,stale)),'shipping_settings_template_changed');absent(713)
 request=apply_request(714,preview(['st-good-011'],actor_id=ident(2),session_id=ident(12)))
 contract={'collectorName':'TEST 새 수납사','collectionMethod':'TEST 배송 시 지급','refundContact':'TEST 환급담당','customerInstructions':'TEST 합성 계약',
  'contractReference':'TEST 계약2','dispatchMappingReference':'TEST 인계','receiptReference':'TEST 영수증','disputeContact':'TEST 분쟁담당'}
 held=auth()+'select public.admin_save_shipping_collect_contract('+quote(ident(102))+",1,'active',"+js(contract)+','+quote(ident(750))+','+quote(actor)+');'
 contention('collector-version-race',held,request,'shipping_settings_origin_changed')
 new_origin_save=save(724,template=206);new_origin_save['settings']['originId']=ident(101);new_origin_save['settings']['delivery']['policy']['paymentMode']='prepaid'
 sql('begin;'+operation_body(new_origin_save)+'commit;')
 request=apply_request(725,preview(['st-good-017'],template=206,actor_id=ident(2),session_id=ident(12)))
 held=auth()+'select public.admin_save_shipping_collect_contract('+quote(ident(101))+",0,'active',"+js(contract)+','+quote(ident(753))+','+quote(actor)+');'
 contention('collector-first-version-race',held,request,'shipping_settings_origin_changed')
 request=apply_request(715,preview(['st-good-012']))
 contention('runtime-disable-race','update private.goods_transaction_runtime set enabled=false where singleton;',request,'checkout_contract_upgrade_required')
 sql('update private.goods_transaction_runtime set enabled=true where singleton;')
 for name,held,target,number in [
  ('normal-editor-advisory',"select pg_advisory_xact_lock(hashtextextended('admin_good:st-good-013',0));",'st-good-013',716),
  ('product-row',"select id from public.goods where id='st-good-014' for update;",'st-good-014',717),
  ('transaction-config-row',"select good_id from private.goods_transaction_configs where good_id='st-good-001' for update;",'st-good-001',718),
 ]:contention(name,held,apply_request(number,preview([target])))
 request=apply_request(719,preview(['st-family-owner']))
 held=auth(role=False)+"select pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));"
 held+="insert into public.goods(id,code,ip_id,name,type,price,stock,origin_id,shipping_fee_type,individual_fee) values('st-family-race-added','ST-FAMILY-RACE-ADDED','shipping-delivery-ip','TEST 추가 공유 상품','문구',1000,'ok',"+quote(ident(102))+",'individual',100);"
 held+="select private.bind_goods_aggregation('st-family-owner',array['st-family-race-added'],"+quote(ident(751))+','+quote(actor)+');'
 pair('family-membership-cas',held,operation_body(request),'shipping_settings_goods_changed');absent(719)
 request=apply_request(720,preview(['st-good-001']))
 terms=json.loads(sql('begin;'+auth()+"select public.admin_get_good_transaction_terms('st-good-001');commit;"))
 held=auth(ident(2),ident(12))+"select public.admin_save_good_transaction_terms('st-good-001',"+str(terms['revision'])+','+quote(terms['goodUpdatedAt'])+',null,'+js(policy('buyer_choice','tier2'))+','+quote(ident(752))+','+quote(ident(2))+');'
 contention('direct-delivery-editor-cas',held,request,'shipping_settings_goods_changed')
 legacy_save=auth()+'select public.admin_save_shipping_settings_template('+quote(ident(201))+",1,'TEST legacy 변경',true,"+js({k:v for k,v in settings().items() if k!='delivery'})+');'
 pair('legacy-save-versus-v2-save',legacy_save,operation_body(save(721,template=201,revision=1,actor_id=ident(2),session_id=ident(12))),'shipping_settings_template_changed');absent(721)
 request=apply_request(722,preview(['st-good-015']))
 pair('account-suspension-race',"update public.profiles set suspended_at=clock_timestamp(),suspension_reason='TEST 경합 정지' where id="+quote(actor)+';',operation_body(request),'operator_capability_required');absent(722)
 sql('update public.profiles set suspended_at=null,suspension_reason=null where id='+quote(actor)+';')
 request=apply_request(723,preview(['st-good-016']))
 pair('session-revocation-race','delete from auth.sessions where id='+quote(session)+';',operation_body(request),'shipping_settings_auth_changed');absent(723)
 result={'status':'PASS','database':db,'lease':str(lease),'sourceDatabaseWrites':0,'actualRaces':passed,'count':len(passed),'noDeadlocks':True}
 destination=Path(os.environ.get('SHIPPING_SETTINGS_QA_OUTPUT','.'))/'concurrency-result.json';destination.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
 print(json.dumps({'status':'PASS','actualRaces':len(passed),'result':str(destination)}),flush=True)
finally:
 for p in processes:
  if p.poll() is None:
   p.terminate()
   try:p.communicate(timeout=5)
   except subprocess.TimeoutExpired:p.kill();p.communicate(timeout=5)

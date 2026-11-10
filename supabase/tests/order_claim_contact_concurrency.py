"""Actual lock waits for contact PII on an explicitly leased local clone only."""
if not __debug__:
 raise SystemExit('Optimized Python is not allowed for database fixture tools')
import hashlib,json,re,subprocess,sys,time,uuid
from pathlib import Path
container,database,destination=sys.argv[1:]
if not re.fullmatch(r'[0-9a-f]{64}',container) or not re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}',database):raise SystemExit('Expected immutable container and leased local clone')
command=['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
out=Path(destination);out.mkdir(parents=True,exist_ok=True);salt='claim-contact-race-'+uuid.uuid4().hex[:10];prefix='cc-'+uuid.uuid4().hex[:10];results=[];processes=[]
def sql(body):
 r=subprocess.run(command,input="load 'safeupdate';"+body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
lease=json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton'))
assert lease['container_id']==container and lease['source_database']=='postgres' and lease['lease'].replace('-','')==database[-32:]
assert sql("select to_regprocedure('public.service_change_order_claim_contact(uuid,uuid,uuid,uuid,uuid,text,text,integer,jsonb,jsonb,text,text,boolean)') is not null")=='t'
def uid(kind,n):return str(uuid.UUID(hashlib.md5(f'{salt}:{kind}:{n}'.encode()).hexdigest()))
def lit(value):return "'"+str(value).replace("'","''")+"'"
def js(value):return lit(json.dumps(value,ensure_ascii=False,separators=(',',':')))+'::jsonb'
def service():return "select set_config('request.jwt.claim.role','service_role',true);select set_config('request.jwt.claim.sub','',true);"
def context(n,target='reshipment',command_kind='change'):
 return json.loads(sql('begin;'+service()+f"select public.service_get_order_claim_contact_context('{uid('order',n)}','{uid('claim',n)}','{uid('user',1)}','{uid('session',1)}','{target}','{command_kind}');commit;").splitlines()[-1])
def expected(ctx):return dict(ctx['current']['source'],addressHmac='a'*64,addressHmacKeyVersion='k1')
def field():return {'v':1,'kid':'k1','iv':'A'*16,'tag':'A'*22,'ct':'YQ'}
def address():return {k:field() for k in ['recipientName','phone','postalCode','address1','address2']}
def change(op):
 return {'effect':'change','changedFields':['recipientName'],'beforeAddressHmac':'a'*64,'afterAddressHmac':'b'*64,'addressHmacKeyVersion':'k1',
 'plan':{'planId':uid('plan',op),'piiVersion':uid('pii',op),'keyVersion':'k1','addressHmac':'b'*64,'addressHmacKeyVersion':'k1','address':address()},
 'history':{'piiVersion':uid('history-pii',op),'keyVersion':'k1','before':address(),'after':address(),'agreement':field()}}
def save(n,op,ctx,hmac='c'*64):
 return service()+f"select public.service_change_order_claim_contact('{uid('order',n)}','{uid('claim',n)}','{uid('user',1)}','{uid('session',1)}','{uid('operation',op)}',{lit(ctx['target'])},'exchange',{ctx['claimRevision']},{js(expected(ctx))},{js(change(op))},'{hmac}','k1',true);"
def read(n,op,ctx,seal=False):
 return service()+f"select public.service_read_order_claim_contact_operation('{uid('order',n)}','{uid('claim',n)}','{uid('user',1)}','{uid('session',1)}','{uid('operation',op)}','change',{lit(ctx['target'])},'exchange',{ctx['claimRevision']},{str(seal).lower()});"
def reship(n,op,ctx):
 source=ctx['current']['source'];destination={'piiVersion':uid('dest',op),'keyVersion':'k1','address':address(),'addressHmac':'a'*64,'addressHmacKeyVersion':'k1','sourceKind':source['sourceKind'],'sourceId':source['sourceId'],'sourceRevision':source['sourceRevision'],'sourcePlanRevision':source['planRevision'],'sourcePiiVersion':source['piiVersion']}
 return service()+f"select public.service_record_order_claim_reshipment_v2('{uid('order',n)}','{uid('claim',n)}','{uid('user',1)}','{uid('session',1)}','{uid('operation',op)}',{ctx['claimRevision']},{js(expected(ctx))},{js(destination)},'{op%10}'||repeat('{op%10}',63),'k1','hanjin','CCRACE{n:08d}','[]',true);"
def terminal(n):sql(f"update public.order_cancellation_requests set stage='rejected',decided_at=clock_timestamp()-interval '40 days',decided_by='{uid('user',1)}',decision_note='TEST terminal' where id='{uid('claim',n)}';")
def case(n,op,action='hold',revision=0,until_sql="clock_timestamp()+interval '1 day'"):
 return service()+f"select public.service_record_order_claim_contact_retention_case('{uid('order',n)}','{uid('claim',n)}','{uid('user',1)}','{uid('session',1)}','{uid('retention-operation',op)}',{revision},jsonb_build_object('action','{action}','caseRef','race-{n}','approvalRef','TEST-RACE','legalBasis','statutory_preservation','retainUntil',{until_sql},'occurredAt',clock_timestamp()-interval '1 second'));"
def purge(op):return service()+f"select public.service_purge_order_claim_contact_data('{uid('user',2)}','{uid('user',1)}','{uid('session',1)}','{uid('retention-operation',op)}',clock_timestamp(),100);"
def value(output):
 for line in reversed(output.splitlines()):
  if line.startswith('{'):return json.loads(line)
 raise AssertionError('Missing JSON result: '+output)
def wait_state(name,expected,process):
 for _ in range(200):
  if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}'")==expected:return
  if process.poll() is not None:raise RuntimeError(name+' ended early: '+str(process.communicate()))
  time.sleep(.015)
 raise RuntimeError(name+' did not reach '+expected)
def race(label,first,second,error=None):
 names=[prefix+'-'+str(len(results))+'-'+v for v in ['a','b']]
 one=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(one)
 one.stdin.write(f"load 'safeupdate';set application_name='{names[0]}';begin;set local lock_timeout='8s';{first}select pg_sleep(0.6);commit;");one.stdin.close();one.stdin=None
 wait_state(names[0],'Timeout',one)
 two=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(two)
 two.stdin.write(f"load 'safeupdate';set application_name='{names[1]}';begin;set local lock_timeout='8s';{second}commit;");two.stdin.close();two.stdin=None
 wait_state(names[1],'Lock',two)
 a,b=one.communicate(timeout=12),two.communicate(timeout=12)
 (out/(label+'-first.log')).write_text(a[0]+a[1]);(out/(label+'-second.log')).write_text(b[0]+b[1])
 assert one.returncode==0,a
 if error:assert two.returncode!=0 and error in b[1],b
 else:assert two.returncode==0,b
 results.append({'case':label,'actualLockWait':True,'result':error or 'committed'});print('PASS '+label,flush=True);return a[0],b[0]
try:
 fixture=Path(__file__).with_name('order_claim_contact.sql').read_text();fixture=fixture[:fixture.index("select pg_temp.cc_error('select pg_temp.cc_context(1)'")]
 fixture=fixture.replace('claim-contact-',salt+'-').replace('claim-contact:',salt+':').replace('generate_series(1,18)','generate_series(1,50)').replace('cc-good',prefix+'-good').replace('cc-ip',prefix+'-ip').replace('cc-origin',prefix+'-origin')
 sql(fixture+"update private.order_claim_contact_runtime set enabled=true where singleton;commit;")
 contexts={n:context(n) for n in range(1,13)}
 a,b=race('same-uuid-save-replay',save(1,1,contexts[1]),save(1,1,contexts[1]));assert value(a)==value(b)
 race('same-uuid-conflicting-request',save(2,2,contexts[2]),save(2,2,contexts[2],'d'*64),'claim_contact_operation_conflict')
 a,b=race('read-waits-for-save',save(3,3,contexts[3]),read(3,3,contexts[3]));assert value(a)==value(b)['receipt']
 a,b=race('save-before-seal',save(4,4,contexts[4]),read(4,4,contexts[4],True));assert value(a)==value(b)['receipt']
 race('seal-before-delayed-save',read(5,5,contexts[5],True),save(5,5,contexts[5]),'claim_contact_operation_sealed')
 for n in [6,7]:sql(f"update public.order_cancellation_requests set stage='collected',collected_at=clock_timestamp() where id='{uid('claim',n)}';")
 ctx6=context(6);ctx7=context(7)
 race('contact-before-reshipment',save(6,6,ctx6),reship(6,60,ctx6),'claim_contact_changed')
 race('reshipment-before-contact',reship(7,70,ctx7),save(7,7,ctx7),'claim_contact_changed')
 assert sql(f"select count(*) from private.order_claim_reshipment_destinations where claim_id='{uid('claim',7)}'")=='1'
 revoke=f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update private.operator_memberships set manager_role='deputy' where profile_id='{uid('user',1)}';"
 race('capability-loss-before-write',revoke,save(8,8,contexts[8]),'auth_changed');sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('user',1)}';")
 race('accepted-write-before-session-delete',save(9,9,contexts[9]),f"delete from auth.sessions where id='{uid('session',1)}';")
 sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{uid('session',1)}','{uid('user',1)}',clock_timestamp(),clock_timestamp());")
 race('revoked-session-before-write',f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);delete from auth.sessions where id='{uid('session',1)}';",save(10,10,contexts[10]),'auth_changed')
 sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{uid('session',1)}','{uid('user',1)}',clock_timestamp(),clock_timestamp());")
 source_change=f"update public.orders set address=jsonb_set(address,'{{recipientName}}','\"Changed source\"') where id='{uid('order',11)}';"
 race('original-source-change-before-write',source_change,save(11,11,contexts[11]),'claim_contact_changed')
 # A collection row can become received without changing claim_revision.
 sql(f"insert into public.order_claim_collections(claim_id,shipment_id,origin_id,origin_name_snapshot,return_address_snapshot,items_snapshot) values('{uid('claim',12)}','{uid('shipment',12)}','{uid('origin',1)}','TEST','TEST',jsonb_build_array(jsonb_build_object('orderItemId','{uid('item',12)}','qty',1)));")
 collection_ctx=context(12,'collection')
 collection=f"select id from public.orders where id='{uid('order',12)}' for update;update public.order_claim_collections set collected_at=clock_timestamp(),collected_by='{uid('user',1)}',evidence='TEST receipt' where claim_id='{uid('claim',12)}';"
 race('collection-receipt-before-contact',collection,save(12,12,collection_ctx),'claim_contact_blocked')
 # Only these terminal scopes are purge candidates; ordinary active claims stay untouched.
 terminal(20);terminal(21);terminal(22)
 _,b=race('hold-before-purge',case(20,200),purge(201));assert uid('claim',20) not in value(b)['purgedClaimIds']
 # 21/22 may have been purged in the same bounded pass. Use a fresh due scope.
 terminal(23)
 race('purge-before-hold',purge(230),case(23,231),'claim_contact_purged')
 terminal(24);sql('begin;'+case(24,240)+'commit;')
 _,b=race('release-before-purge',case(24,241,'release',1,'null'),purge(242));assert value(b)['remaining']['eligibleScopes']>=1
 sql('begin;'+purge(243)+'commit;')
 # Both active-hold directions keep PII, and release never silently broadens an earlier purge receipt.
 _,b=race('purge-before-release',purge(250),case(20,251,'release',1,'null'));assert value(b)['state']=='released'
 sql('begin;'+purge(252)+'commit;')
 terminal(26);sql('begin;'+case(26,260)+'commit;')
 _,b=race('extend-before-purge',case(26,261,'extend',1,"clock_timestamp()+interval '2 days'"),purge(262));assert uid('claim',26) not in value(b)['purgedClaimIds']
 _,b=race('purge-before-extend',purge(263),case(26,264,'extend',2,"clock_timestamp()+interval '3 days'"));assert value(b)['state']=='held'
 terminal(27)
 ownership=f"select private.gift_lock_subjects(array['{uid('user',2)}'::uuid,'{uid('user',4)}'::uuid]);update public.orders set user_id='{uid('user',4)}' where id='{uid('order',27)}';"
 race('ownership-change-before-purge',ownership,purge(270),'claim_contact_changed')
 assert sql(f"select count(*) from private.order_claim_contact_plans where claim_id='{uid('claim',27)}' and purged_at is not null")=='0'
 race('capability-loss-before-purge',revoke,purge(280),'auth_changed');sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('user',1)}';")
 race('accepted-purge-before-capability-loss',purge(281),revoke);sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('user',1)}';")
 race('session-loss-before-purge',f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);delete from auth.sessions where id='{uid('session',1)}';",purge(282),'auth_changed')
 sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{uid('session',1)}','{uid('user',1)}',clock_timestamp(),clock_timestamp());")
 # Runtime flips serialize with the shared runtime gate; metadata recovery remains independent.
 ctx29=context(29);ctx30=context(30)
 race('runtime-disabled-before-write',"update private.order_claim_contact_runtime set enabled=false where singleton;",save(29,29,ctx29),'feature_disabled')
 sql('update private.order_claim_contact_runtime set enabled=true where singleton;')
 race('accepted-write-before-runtime-disable',save(30,30,ctx30),"update private.order_claim_contact_runtime set enabled=false where singleton;")
 assert value(sql('begin;'+read(30,30,ctx30)+'commit;'))['receipt']['state']=='saved'
 sql('update private.order_claim_contact_runtime set enabled=true where singleton;')
 # An event becomes valid during a lock wait. recordedAt must reflect the
 # validation/commit side of that wait, never function-entry wall time.
 hold_subjects=f"select private.gift_lock_subjects(array['{uid('user',1)}'::uuid,'{uid('user',2)}'::uuid]);"
 delayed_event=case(31,310).replace("'occurredAt',clock_timestamp()-interval '1 second'", "'occurredAt',clock_timestamp()+interval '0.2 second'")
 _,b=race('retention-recorded-after-validation-lock',hold_subjects,delayed_event)
 from datetime import datetime
 assert datetime.fromisoformat(value(b)['occurredAt'])<=datetime.fromisoformat(value(b)['recordedAt'])
 # Customer deletion fences serialize with new PII work, while metadata recovery survives.
 ctx25=context(25)
 fence=f"select private.gift_lock_subjects(array['{uid('user',2)}'::uuid]);insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values('{uid('fence',1)}','{uid('user',2)}','{uid('fence',2)}','awaiting_email_intent');insert into private.account_action_fences(subject_user_id,deletion_event_id) values('{uid('user',2)}','{uid('fence',1)}');"
 race('customer-fence-before-contact',fence,save(25,25,ctx25),'claim_contact_blocked')
 recovered=value(sql('begin;'+read(1,1,contexts[1])+'commit;'));assert recovered['receipt']['state']=='saved'
 assert sql(f"select count(*) from private.order_claim_contact_operations where id in('{uid('operation',8)}','{uid('operation',10)}','{uid('operation',11)}','{uid('operation',12)}','{uid('operation',25)}')")=='0'
 report={'status':'PASS','database':database,'lease':lease['lease'],'fixtureNamespace':salt,'cases':results,'externalCalls':0,'sourceDatabaseWrites':0}
 (out/'result.json').write_text(json.dumps(report,indent=2)+'\n');print('PASS '+str(len(results))+' actual lock races',flush=True)
finally:
 for process in processes:
  if process.poll() is None:process.terminate();process.wait(timeout=5)

"""Real lock waits on an explicitly leased local clone, with synthetic accounts."""
import hashlib,json,re,subprocess,sys,time,uuid
from pathlib import Path
container,database,destination=sys.argv[1:]
if not re.fullmatch(r'[0-9a-f]{64}',container) or not re.fullmatch(r'icons_(refund_account|goods_transaction)_[0-9a-f]{32}',database):
 raise SystemExit('Expected immutable local container identity and leased clone')
command=['docker','exec','-i',container,'psql','-X','-U','supabase_admin','-d',database,'-qAt','-v','ON_ERROR_STOP=1']
out=Path(destination);out.mkdir(parents=True,exist_ok=True);results=[];processes=[];prefix='ra-'+uuid.uuid4().hex[:12]
def sql(body):
 r=subprocess.run(command,input="load 'safeupdate';"+body,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
lease=json.loads(sql("select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;"))
assert lease['container_id']==container and lease['source_database']=='postgres' and lease['lease'].replace('-','')==database[-32:]
def uid(kind,n):return str(uuid.UUID(hashlib.md5(f'claim-refund-account:{kind}:{n}'.encode()).hexdigest()))
def actor(n=1):
 claims=json.dumps({'role':'authenticated','sub':uid('user',n),'session_id':uid('session',n)})
 return f"select set_config('request.jwt.claim.sub','',true);select set_config('request.jwt.claims','{claims}',true);set local role authenticated;"
def save(n,op,number='000000001234'):
 return actor()+f"select public.set_my_order_claim_refund_account('{uid('order',n)}','{uid('claim',n)}','{uid('race',op)}',0,'합성은행','{number}','합성구매자','{uid('user',1)}','{uid('session',1)}');"
def read(n,op,seal=False):
 return actor()+f"select public.read_my_order_claim_refund_account_operation('{uid('order',n)}','{uid('claim',n)}','{uid('race',op)}',0,'{uid('user',1)}','{uid('session',1)}',{str(seal).lower()});"
def file_refund(n,revision):
 return actor(3)+f"select public.admin_record_bank_transfer_refund('{uid('order',n)}','{uid('claim',n)}','{uid('bank-file',n)}','file_transfer',{revision},13000,clock_timestamp(),'TEST 합성 접수 증빙','TEST-ONLY 금융 경합 검증, 외부 송금 없음',true,'{uid('user',3)}','{uid('session',3)}');"
def confirm_cancellation(n,revision):
 return actor(3)+f"select public.admin_record_bank_transfer_refund('{uid('order',n)}','{uid('claim',n)}','{uid('bank-confirm',n)}','confirm_cancellation',{revision},13000,clock_timestamp(),'TEST 합성 취소 확인','TEST-ONLY 금융 경합 검증, 외부 송금 없음',true,'{uid('user',3)}','{uid('session',3)}');"
def wait_state(name,state,process):
 for _ in range(160):
  current=sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';")
  if current==state:return
  if process.poll() is not None:raise RuntimeError(name+' ended early: '+str(process.communicate()))
  time.sleep(.02)
 raise RuntimeError(name+' did not reach '+state)
def race(label,first,second,error=None):
 names=[prefix+'-'+str(len(results))+'-a',prefix+'-'+str(len(results))+'-b']
 one=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(one)
 one.stdin.write(f"load 'safeupdate';set application_name='{names[0]}';begin;set local lock_timeout='8s';{first}select pg_sleep(1.2);commit;");one.stdin.close();one.stdin=None
 wait_state(names[0],'Timeout',one)
 two=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);processes.append(two)
 two.stdin.write(f"load 'safeupdate';set application_name='{names[1]}';begin;set local lock_timeout='8s';{second}commit;");two.stdin.close();two.stdin=None
 wait_state(names[1],'Lock',two)
 a,b=one.communicate(timeout=15),two.communicate(timeout=15)
 (out/(label+'-first.log')).write_text(a[0]+a[1]);(out/(label+'-second.log')).write_text(b[0]+b[1])
 if one.returncode:raise RuntimeError(a[1])
 if error:
  if not two.returncode or error not in b[1]:raise RuntimeError('Expected '+error+': '+str(b))
 elif two.returncode:raise RuntimeError(b[1])
 results.append({'case':label,'actualLockWait':True,'result':error or 'both-committed'});print('PASS '+label,flush=True)
 return a[0],b[0]
try:
 first,second=race('same-operation',save(2,1),save(2,1))
 receipt=lambda s:next(json.loads(line) for line in s.splitlines() if line.startswith('{') and 'operationId' in line)
 assert receipt(first)==receipt(second)
 race('changed-payload',save(7,2),save(7,2,'000000009999'),'refund_account_request_conflict')
 race('competing-operation-cas',save(8,3),save(8,4),'claim_changed')
 first,second=race('read-waits-for-save',save(17,5),read(17,5));assert receipt(first)==receipt(second)
 first,second=race('save-before-seal',save(16,6),read(16,6,True));assert receipt(first)==receipt(second)
 race('seal-before-delayed-save',read(22,7,True),save(22,7),'refund_account_request_sealed')
 # The current bank lifecycle refuses filing until an account exists. It must
 # not manufacture the old pg_cancel-on-bank state merely to block a later save.
 rejected=subprocess.run(command,input="begin;"+file_refund(25,0)+"commit;",text=True,capture_output=True)
 (out/'filing-without-account.log').write_text(rejected.stdout+rejected.stderr)
 assert rejected.returncode and 'claim_refund_account_missing' in rejected.stderr,rejected.stderr
 assert sql(f"select count(*) from private.bank_transfer_refund_operations where id='{uid('bank-file',25)}'")=='0'
 assert sql(f"select count(*) from public.refunds where cancellation_request_id='{uid('claim',25)}' and (filed_at is not null or method is not null)")=='0'
 results.append({'case':'filing-without-account-rejected','actualLockWait':False,'result':'claim_refund_account_missing','financialMutation':False})
 print('PASS filing-without-account-rejected',flush=True)
 # An unshipped cancellation must be confirmed before filing its transfer.
 # The bank writer waits for the payer's committed account and uses that
 # revision; only then does a separate normal filing follow the new receipt.
 _,confirmed=race('account-before-bank-cancellation-confirmed',save(26,9),confirm_cancellation(26,1))
 confirmation=receipt(confirmed)
 assert confirmation['kind']=='confirm_cancellation' and confirmation['state']=='recorded'
 sql('begin;'+file_refund(26,confirmation['resultRevision'])+'commit;')
 assert sql(f"select count(*) from private.claim_refund_accounts where claim_id='{uid('claim',25)}'")=='0'
 assert sql(f"select method from public.refunds where cancellation_request_id='{uid('claim',26)}'")=='bank_transfer'
 assert sql(f"select status||':'||(filed_at is not null)::text from public.refunds where cancellation_request_id='{uid('claim',26)}'")=='awaiting_transfer:true'
 assert sql(f"select count(*) from private.order_claim_refund_account_operations where id in('{uid('race',1)}','{uid('race',2)}','{uid('race',3)}','{uid('race',5)}','{uid('race',6)}','{uid('race',9)}') and state='saved'")=='6'
 race('accepted-write-before-session-revoke',save(1,11),f"delete from auth.sessions where id='{uid('session',1)}';")
 sql(f"insert into auth.sessions(id,user_id,created_at,updated_at) values('{uid('session',1)}','{uid('user',1)}',clock_timestamp(),clock_timestamp());")
 revoke=f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);delete from auth.sessions where id='{uid('session',1)}';"
 race('revoked-session-before-writer',revoke,save(18,10),'refund_account_auth_changed')
 assert sql(f"select count(*) from private.claim_refund_accounts where claim_id='{uid('claim',18)}'")=='0'
 (out/'result.json').write_text(json.dumps({'status':'PASS','cases':results,'externalProviderCalls':0},indent=2)+'\n')
finally:
 for process in processes:
  if process.poll() is None:process.terminate();process.wait(timeout=5)

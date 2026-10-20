"""Real lock waits against disposable gift clones; committed fixtures die with it."""
from pathlib import Path
import hashlib,json,re,subprocess,sys,time
from gift_order_test_support import validate_owned_clone
container,database,directory=sys.argv[1:]
validate_owned_clone(container,database)
out=Path(directory);out.mkdir(parents=True,exist_ok=True)
command=['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose']
results=[]
def sql(body,name='query'):
 r=subprocess.run(command,input=body,text=True,capture_output=True,timeout=30);(out/(name+'.log')).write_text(r.stdout+r.stderr)
 if r.returncode:raise RuntimeError(name+': '+r.stderr[-3000:])
 return r.stdout.strip()
def uid(n):return f'93942000-0000-4000-8000-{n:012}'
def auth(n):return f"set local role authenticated;select set_config('request.jwt.claim.sub','{uid(n)}',true);"
def start(name,body,delay=0):
 f=(out/(name+'.log')).open('w');p=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=f,stderr=f,text=True)
 p.stdin.write(f"begin;set local application_name='{name}';set local statement_timeout='12s';set local lock_timeout='8s';"+body+(f'select pg_sleep({delay});' if delay else '')+'commit;');p.stdin.close();return p,f
def wait(name,event,p):
 for _ in range(150):
  state=sql(f"select coalesce(wait_event_type,'')||':'||coalesce(wait_event,'') from pg_stat_activity where application_name='{name}';")
  if event in state:return
  if p.poll() is not None:raise RuntimeError(name+' finished before '+event+': '+(out/(name+'.log')).read_text()[-2000:])
  time.sleep(.025)
 raise RuntimeError(name+' never reached '+event)
def pair(label,first,second,error=None,delay=1.25):
 a,af=start('gift-'+label+'-a',first,delay);b=bf=None
 try:
  wait('gift-'+label+'-a','PgSleep',a);b,bf=start('gift-'+label+'-b',second);wait('gift-'+label+'-b','Lock:',b)
  assert a.wait(timeout=15)==0,(out/('gift-'+label+'-a.log')).read_text();code=b.wait(timeout=15);body=(out/('gift-'+label+'-b.log')).read_text()
  assert '40P01' not in body,body
  assert (code==0 if error is None else code!=0 and error in body),body
  results.append({'case':label,'observedLockWait':True,'expectedError':error,'status':'PASS'});print('PASS '+label,flush=True)
 finally:
  for p,f in [(a,af),(b,bf)]:
   if p and p.poll() is None:p.terminate();p.wait(timeout=5)
   if f:f.close()
root=Path(__file__).parent
fixture=(root/'gift_order_domain.sql').read_text().split("select pg_temp.gift_assert(not has_table_privilege")[0].replace('begin;','',1).replace('pg_temp.','gift_test.')
kc=(root/'helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.','gift_test.')
sql('begin;create schema gift_test;grant usage on schema gift_test to authenticated,service_role;'+kc+fixture+"grant execute on all functions in schema gift_test to authenticated,service_role;update private.gift_runtime set enabled=true,privacy_ready=true;update private.goods_transaction_runtime set enabled=true;update public.profiles set role='admin' where id=('47c47700'||left(md5('gift-domain-good'),24))::uuid;commit;",'fixture')
selection=sql("select jsonb_build_array(jsonb_build_object('goodId',good_id,'variantId',id,'qty',2,'inputRevision',0,'inputValues','{}'::jsonb)) from public.goods_variants where good_id='gift-domain-good' and is_default;")
def new_gift(n):
 token=hashlib.sha256(f'token-{n}'.encode()).hexdigest();session=hashlib.sha256(f'session-{n}'.encode()).hexdigest()
 sql('begin;'+auth(1)+f"select public.create_my_gift('{uid(n)}','{selection}','TEST 경합','{uid(n+10000)}','{uid(1)}');select public.issue_my_gift_link('{uid(n)}',1,'{token}','{uid(n+20000)}','{uid(1)}');reset role;set local role service_role;select public.service_begin_gift_claim_session('{token}','{session}');commit;",f'new-{n}')
 return session
address='{"recipientName":"TEST 수령인","phone":"01000001111","postalCode":"12345","address1":"TEST-GIFT-CONCURRENCY-ADDRESS"}'
def accept(n,session,recipient=2):return auth(recipient)+f"select public.respond_to_gift('{uid(n)}','{session}',true,'{address}',2,'{uid(n+30000+recipient)}','{uid(recipient)}');"
# Two real recipients compete for the same unconsumed token.
session=new_gift(1000);pair('two-recipients',accept(1000,session),accept(1000,session,3),'PT409')
assert sql(f"select recipient_id='{uid(2)}' and revision=3 from private.gift_intents where id='{uid(1000)}';")=='t'
# Session expires while an actor lock is held; statement start time must not win.
session=new_gift(1001);sql(f"update private.gift_claim_sessions set expires_at=clock_timestamp()+interval '800 milliseconds' where session_hash='{session}';")
pair('session-expiry',f"select private.gift_lock_subjects(array['{uid(1)}'::uuid]);",accept(1001,session),'gift_invitation_unavailable')
assert sql(f"select recipient_id is null from private.gift_intents where id='{uid(1001)}';")=='t'
admin="set local role authenticated;select set_config('request.jwt.claim.sub',('47c47700'||left(md5('gift-domain-good'),24))::uuid::text,true);"
suspend=admin+f"select public.admin_suspend_user('{uid(2)}','TEST gift race');"
session=new_gift(1002);pair('suspend-before-accept',suspend,accept(1002,session),'gift_account_unavailable')
sql(f"update public.profiles set suspended_at=null,suspension_reason=null where id='{uid(2)}';")
session=new_gift(1003);pair('accept-before-suspend',accept(1003,session),suspend)
assert sql(f"select state='accepted' from private.gift_intents where id='{uid(1003)}';")=='t'
sql(f"update public.profiles set suspended_at=null,suspension_reason=null where id='{uid(2)}';")
# Actual account-action fence writer lock; gift checks the committed fence.
def fence(n):return f"select private.lock_account_action_subject('{uid(2)}');insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values('{uid(n+40000)}','{uid(2)}','{uid(n+50000)}','awaiting_email_intent');insert into private.account_action_fences(subject_user_id,deletion_event_id) values('{uid(2)}','{uid(n+40000)}');"
def clear_fence():sql(f"delete from private.account_action_fences where subject_user_id='{uid(2)}';delete from private.account_deletion_requests where subject_user_id='{uid(2)}';")
session=new_gift(1004);pair('fence-before-accept',fence(1004),accept(1004,session),'gift_account_unavailable');clear_fence()
session=new_gift(1005);pair('accept-before-fence',accept(1005,session),fence(1005))
# Post-fence cleanup is a separate committed RPC and never reverses actor locks.
ids=json.loads(sql(f"set role service_role;select to_json(public.service_list_fenced_gifts('{uid(2)}'));"))
assert uid(1005) in ids
for giftid in ids:sql(f"set role service_role;select public.service_cleanup_fenced_gift('{giftid}');")
assert sql(f"select not exists(select 1 from private.gift_recipient_addresses where recipient_id='{uid(2)}');")=='t'
assert sql(f"set role service_role;select cardinality(public.service_list_fenced_gifts('{uid(2)}')); ")=='0'
clear_fence();results.append({'case':'post-fence-separate-transactions','status':'PASS'})
# Existing accepted gift, common financial quote, then address/close versus place.
def accepted(n):
 session=new_gift(n);sql('begin;'+accept(n,session)+'commit;');return n
def quote(n):
 lines=sql('begin;'+auth(1)+f"select public.quote_my_gift('{uid(n)}',3,null,0,'{uid(1)}');commit;").splitlines();value=next(json.loads(x) for x in lines if x.startswith('{'));assert value['state']=='quoted',value;return value['quoteId']
def place(n,q):return auth(1)+f"select public.place_my_gift('{uid(n)}','{q}','{uid(n+60000)}','card','{uid(1)}');"
def address_change(n):return auth(2)+f"select public.update_my_gift_address('{uid(n)}','{address}',3,'{uid(n+70000)}','{uid(2)}');"
n=accepted(1006);q=quote(n);pair('address-before-place',address_change(n),place(n,q),'gift_source_changed')
assert sql(f"select order_id is null from private.gift_intents where id='{uid(n)}';")=='t'
n=accepted(1007);q=quote(n);pair('place-before-address',place(n,q),address_change(n),'PT409')
assert sql(f"select order_id is not null from private.gift_intents where id='{uid(n)}';")=='t'
n=accepted(1008);q=quote(n);pair('close-before-place',auth(2)+f"select public.close_my_gift('{uid(n)}',3,'{uid(n+80000)}','{uid(2)}');",place(n,q),'gift_payment_not_ready')
n=accepted(1009);q=quote(n);pair('place-before-close',place(n,q),auth(2)+f"select public.close_my_gift('{uid(n)}',3,'{uid(n+80000)}','{uid(2)}');",'PT409')
# Quote holds the same gift source; following address mutation invalidates it.
n=accepted(1010);pair('quote-before-address',auth(1)+f"select public.quote_my_gift('{uid(n)}',3,null,0,'{uid(1)}');",address_change(n))
assert sql(f"select not exists(select 1 from private.goods_transaction_quotes where source->>'id'='{uid(n)}' and order_id is null);")=='t'
# A waiting address correction must not hold origins before acquiring goods.
# An origin writer can finish while the correction waits for the catalog holder.
orderid=sql(f"select order_id from private.gift_intents where id='{uid(1007)}';")
origin=sql(f"select origin_id from public.order_shipments where order_id='{orderid}' limit 1;")
sql(f"update public.orders set status='paid' where id='{orderid}';")
changed_address=address.replace('TEST-GIFT-CONCURRENCY-ADDRESS','TEST-GIFT-CHANGED-ADDRESS')
first,ff=start('gift-address-catalog-holder',f"select id from public.goods where id='gift-domain-good' for update;select pg_sleep(1.5);select id from public.fulfillment_origins where id='{origin}' for share;")
second=sf=third=tf=None
try:
 wait('gift-address-catalog-holder','PgSleep',first)
 second,sf=start('gift-address-catalog-wait',admin+f"select public.admin_change_order_address('{uid(99901)}','{orderid}',0,'{changed_address}','TEST 수신자 동의',true);")
 wait('gift-address-catalog-wait','Lock:',second)
 third,tf=start('gift-address-origin-writer',f"update public.fulfillment_origins set base_fee=base_fee where id='{origin}';")
 assert third.wait(timeout=.8)==0,(out/'gift-address-origin-writer.log').read_text()
 assert first.wait(timeout=15)==0,(out/'gift-address-catalog-holder.log').read_text()
 assert second.wait(timeout=15)==0,(out/'gift-address-catalog-wait.log').read_text()
 results.append({'case':'address-catalog-origin-three-sessions','observedLockWait':True,'originWriterFinishedBeforeCatalogReleased':True,'status':'PASS'});print('PASS address-catalog-origin-three-sessions',flush=True)
finally:
 for p,f in [(first,ff),(second,sf),(third,tf)]:
  if p and p.poll() is None:p.terminate();p.wait(timeout=5)
  if f:f.close()
(out/'result.json').write_text(json.dumps({'status':'PASS','cases':results},indent=2)+'\n')

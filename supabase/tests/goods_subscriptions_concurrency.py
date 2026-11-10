"""Local-only subscription lease, cancel/dispatch race and durable Fake recovery."""
from pathlib import Path
import concurrent.futures,json,os,re,subprocess,time
container=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['PGDATABASE'];base=Path(__file__).parent
out=Path(os.environ.get('SUBSCRIPTION_TEST_OUTPUT_DIR','/tmp/icons-subscription-concurrency'));out.mkdir(parents=True,exist_ok=True)
assert os.environ['SUBSCRIPTION_TEST_SCOPE'] in ('ci','isolated-local') and re.fullmatch(r'icons_subscriptions_[0-9_]+',database)
assert re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+',container)
container_id=os.environ['SUBSCRIPTION_TEST_CONTAINER_ID']
assert re.fullmatch(r'[a-f0-9]{64}',container_id)
identity=json.loads(subprocess.check_output(['docker','inspect','--format','{{json .}}',container_id],text=True))
assert identity['Id']==container_id and identity['Name']=='/'+container and identity['State']['Running']
assert identity['Config']['Labels']['com.supabase.cli.project']==container.removeprefix('supabase_db_')
container=container_id
label='sr-'+str(os.getpid());actor='b1714000-0000-4000-8000-000000000002';profile='b1714000-0000-4000-8000-000000000020';credential='b1714000-0000-4000-8000-000000000023';cycle='b1714000-0000-4000-8000-000000000030'
def uid(n):return 'b1714900-0000-4000-8000-'+str(n).zfill(12)
def cmd(app):return ['docker','exec','-i','-e','PGAPPNAME='+app,container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
def run(sql,name,ok=True):
 r=subprocess.run(cmd(label+'-'+name),input=sql,text=True,capture_output=True,timeout=30);(out/(name+'.log')).write_text(r.stdout+r.stderr)
 if ok:assert r.returncode==0,r.stderr
 return r
service="begin;set local statement_timeout='10s';set local role service_role;select set_config('request.jwt.claim.role','service_role',true);\n"
customer=f"begin;set local statement_timeout='10s';set local role authenticated;select set_config('request.jwt.claim.sub','{actor}',true);\n"
def obj(output):return [json.loads(line) for line in output.splitlines() if line.startswith('{')][-1]
def sjson(value):return "'"+json.dumps(value,ensure_ascii=False).replace("'","''")+"'::jsonb"
def start_locked(sql,name):
 proc=subprocess.Popen(cmd(label+'-'+name),stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 proc.stdin.write(sql+"\nselect 'SUBSCRIPTION_LOCK_HELD';\n");proc.stdin.flush();lines=[]
 while True:
  line=proc.stdout.readline()
  if not line:raise AssertionError(proc.stderr.read())
  lines.append(line)
  if line.strip()=='SUBSCRIPTION_LOCK_HELD':break
 return proc,lines

def commit(proc,lines,name):
 proc.stdin.write('commit;\n');proc.stdin.flush();stdout,stderr=proc.communicate(timeout=15);text=''.join(lines)+stdout
 (out/(name+'.log')).write_text(text+stderr);assert proc.returncode==0,stderr;return text
def blocked_pair(first_sql,second_sql,name,error=None):
 first,lines=start_locked(first_sql,name+'-a')
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
   future=pool.submit(run,second_sql+'commit;',name+'-b',False);blocked=False
   for _ in range(80):
    probe=run(f"select count(*) from pg_stat_activity where datname=current_database() and application_name='{label}-{name}-b' and wait_event_type='Lock';",name+'-lock-probe')
    if probe.stdout.strip()=='1':blocked=True;break
    if future.done():break
    time.sleep(.025)
   assert blocked,'second session did not actually block: '+name
   first_text=commit(first,lines,name+'-a');second=future.result(timeout=15)
   if error:assert second.returncode!=0 and error in second.stderr,second.stderr
   else:assert second.returncode==0,second.stderr
   return first_text,second.stdout
 finally:
  if first.poll() is None:first.kill();first.communicate()

fixture=(base/'goods_subscriptions_transactions.sql').read_text();fixture=fixture[:fixture.index("set local role service_role;")]
fixture=fixture.replace("values('b1714000-0000-4000-8000-000000000001','primary');","values('b1714000-0000-4000-8000-000000000001',case when exists(select 1 from private.operator_memberships where manager_role='owner') then 'primary' else 'owner' end);")
run((base/'helpers/goods_kc_fixture.sql').read_text()+fixture+'commit;','fixture')
plan=obj(run(f"select jsonb_build_object('id',id,'revision',revision) from private.goods_subscription_plans where creation_operation_id='{cycle}';",'plan').stdout)
# While session A holds the claimed row, SKIP LOCKED returns null in session B.
token=uid(1);first,lines=start_locked(service+f"select public.service_claim_goods_subscription_work('{token}','{cycle}');",'claim-first')
try:
 second=run(service+f"select coalesce(public.service_claim_goods_subscription_work('{uid(2)}','{cycle}')::text,'NO_WORK');commit;",'claim-second')
 assert 'NO_WORK' in second.stdout and first.poll() is None
 claimed=obj(commit(first,lines,'claim-first'));assert claimed['token']==token
finally:
 if first.poll() is None:first.kill();first.communicate()
print('PASS two concurrent claim sessions yield exactly one lease',flush=True)
# Customer cancellation commits while a worker waits on the same actor lock.
first,lines=start_locked(customer+f"select public.change_my_goods_subscription_state('{actor}','{plan['id']}',{plan['revision']},'{uid(3)}','cancel');",'cancel-first')
worker_sql=service+f"select public.service_prepare_goods_subscription_work('{actor}','{cycle}','{token}',{claimed['fence']},'{profile}','fake-v1');commit;"
try:
 with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
  future=pool.submit(run,worker_sql,'cancel-worker',False);blocked=False
  for _ in range(80):
   probe=run(f"select count(*) from pg_stat_activity where datname=current_database() and application_name='{label}-cancel-worker' and wait_event_type='Lock';",'cancel-lock-probe')
   if probe.stdout.strip()=='1':blocked=True;break
   if future.done():break
   time.sleep(.025)
  assert blocked,'worker did not wait on customer cancellation lock'
  commit(first,lines,'cancel-first');second=future.result(timeout=15)
  assert second.returncode!=0 and 'subscription_claim_stale' in second.stderr,second.stderr
finally:
 if first.poll() is None:first.kill();first.communicate()
readback=obj(run(f"select jsonb_build_object('state',c.state,'dispatched',c.dispatched_at,'attempt',c.attempt_id,'orderStatus',o.status) from private.goods_subscription_cycles c left join public.orders o on o.id=c.order_id where c.id='{cycle}';",'cancel-readback').stdout)
assert readback=={'state':'canceled','dispatched':None,'attempt':None,'orderStatus':'canceled'},readback
print('PASS customer cancellation blocks stale worker before dispatch',flush=True)
# A fresh plan is dispatched. The Fake provider commits success, then the application dies
# before finalizing. A new psql process reclaims and inspects the durable provider ledger.
terms=obj(run(f"select jsonb_build_object('selection',selection,'address',address,'schedule',schedule) from private.goods_subscription_terms where plan_id='{plan['id']}' limit 1;",'terms').stdout)
cycle=uid(10)
prepared=obj(run(customer+f"select public.prepare_my_goods_subscription('{actor}','{cycle}',{sjson(terms['selection'])},{sjson(terms['address'])},{sjson(terms['schedule'])},'{{}}',null,0);commit;",'prepare-new').stdout)['subscription']
confirm_sql=f"select public.confirm_my_goods_subscription('{actor}','{prepared['id']}','{cycle}',1,'{prepared['firstQuoteId']}','{prepared['termsId']}','{credential}','{uid(11)}',true);"
a,b=blocked_pair(customer+confirm_sql,customer+confirm_sql,'same-confirm-operation');confirmation=obj(a);assert confirmation==obj(b)
print('PASS same confirm operation in two blocked sessions returns one original receipt',flush=True)
claimed=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(12)}','{cycle}');commit;",'claim-new').stdout)
work=obj(run(service+f"select public.service_prepare_goods_subscription_work('{actor}','{cycle}','{uid(12)}',{claimed['fence']},'{profile}','fake-v1');commit;",'prepare-charge').stdout)
assert work['kind']=='charge';attempt=work['attempt']['id'];amount=work['attempt']['amount']
def fake(command,name):
 return obj(run(service+f"select public.service_fake_billing_command({sjson(command)}||jsonb_build_object('at',clock_timestamp()));commit;",name).stdout)
common={'profileId':profile};register={**common,'kind':'register','operationRef':'1'*64,'payloadHash':'2'*64,'credentialRef':'3'*64,'customerRef':'4'*64}
assert fake(register,'fake-register')['state']=='registered'
charge={**common,'kind':'charge','operationRef':'5'*64,'payloadHash':'6'*64,'credentialRef':'3'*64,'customerRef':'4'*64,'orderRef':'7'*64,'attemptId':attempt,'amount':amount}
charged=fake(charge,'fake-charge-response-lost');assert charged['state']=='approved'
# This is another DB process: no in-memory fake Map or shared node process survives.
inspected=fake({**common,'kind':'inspect','orderRef':'7'*64},'fake-new-process-inspect');assert inspected==charged
assert fake(charge,'fake-replay')==charged
assert fake({**charge,'operationRef':'8'*64},'fake-distinct-operation')['state']=='conflict'
run(f"update private.goods_subscription_cycles set lease_until=clock_timestamp()-interval '1 second',next_check_at=clock_timestamp()-interval '1 second' where id='{cycle}';update public.payment_attempts set claim_expires_at=clock_timestamp()-interval '1 second' where id='{attempt}';",'expire-leases')
reclaimed=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(13)}','{cycle}');commit;",'reclaim').stdout)
assert reclaimed['fence']>claimed['fence']
recover_sql=service+f"select public.service_prepare_goods_subscription_work('{actor}','{cycle}','{uid(13)}',{reclaimed['fence']},null,null);"
old_finish_sql=service+f"select public.service_finish_goods_subscription_work('{actor}','{cycle}','{uid(12)}',{claimed['fence']},'approved');"
a,b=blocked_pair(recover_sql,old_finish_sql,'reclaimed-lease-late-worker','subscription_claim_stale');recovered=obj(a)
assert recovered['kind']=='inspect' and 'envelope' not in recovered
finished=run(service+f"select public.service_finish_goods_subscription_work('{actor}','{cycle}','{uid(13)}',{reclaimed['fence']},'approved','{inspected['paymentKey']}','{inspected['transactionId']}','12345678','DONE','카드','43301234****123*','{inspected['at']}');commit;",'recovered-finalize')
assert 'approved' in finished.stdout
final=obj(run(f"select jsonb_build_object('paid',o.status,'payments',(select count(*) from public.payments where purpose='order' and ref_id=o.id),'cycles',(select count(*) from private.goods_subscription_cycles where plan_id='{prepared['id']}'),'providerRows',(select count(*) from private.fake_billing_payments where profile_id='{profile}'),'bindings',(select count(*) from private.payment_provider_bindings where cycle_id='{cycle}')) from public.orders o where id='{confirmation['orderId']}';",'recovered-readback').stdout)
assert final=={'paid':'paid','payments':1,'cycles':2,'providerRows':1,'bindings':1},final
# Refund remains single-effect after process restart, then revoke prevents future charges.
refund={**common,'kind':'refund','operationRef':'9'*64,'payloadHash':'a'*64,'orderRef':'7'*64,'attemptId':attempt,'amount':amount}
refunded=fake(refund,'fake-refund');assert refunded['state']=='canceled' and fake(refund,'fake-refund-replay')==refunded
assert fake({**common,'kind':'revoke','credentialRef':'3'*64},'fake-revoke')['state']=='revoked'
assert fake({**charge,'operationRef':'b'*64,'orderRef':'c'*64},'fake-revoked-charge')['state']=='declined'
print('PASS durable Fake approval/restart/inspect/stale fence/refund/revoke; exactly one provider charge and order payment',flush=True)
# Verified provider refund competes with a webhook-style reconciliation completion.
refund_sql=service+f"select public.cancel_order_with_provider_evidence('{confirmation['orderId']}','TEST verified full refund',array['{charged['paymentKey']}']);"
webhook_sql=service+f"select public.claim_goods_payment_reconciliation('{attempt}','{uid(25)}','subscription_refund_webhook_test');select public.service_finalize_subscription_payment_reconciliation('{attempt}','{uid(25)}','approved');"
a,b=blocked_pair(refund_sql,webhook_sql,'refund-webhook-reconciliation');assert 'approved' in b,b
refunded_db=obj(run(f"select jsonb_build_object('order',o.status,'payment',p.status,'refundCount',(select count(*) from public.refunds where payment_id=p.id),'refundTotal',(select sum(amount) from public.refunds where payment_id=p.id),'bindings',(select count(*) from private.payment_provider_bindings where attempt_id='{attempt}')) from public.orders o join public.payments p on p.purpose='order' and p.ref_id=o.id where o.id='{confirmation['orderId']}';",'refund-webhook-readback').stdout)
assert refunded_db=={'order':'canceled','payment':'refunded','refundCount':1,'refundTotal':amount,'bindings':1},refunded_db
print('PASS verified full refund and webhook reconciliation serialize; one refund, canceled order, binding retained',flush=True)
# Subscription-only interleavings use an unsent future-cycle fixture brought due.
# We reinsert that unsent row with the test clock, retaining all business identities;
# no trigger is disabled and no dispatched row or accepted terms are edited.
plan_id=prepared['id']
def due_cycle(name):
 data=obj(run(f"with removed as(delete from private.goods_subscription_cycles where plan_id='{plan_id}' and state='ready' and dispatched_at is null returning *) insert into private.goods_subscription_cycles select (jsonb_populate_record(null::private.goods_subscription_cycles,to_jsonb(removed)||jsonb_build_object('scheduled_at',clock_timestamp()-interval '1 second'))).* from removed returning jsonb_build_object('id',id,'number',cycle_number);",name+'-due-fixture').stdout)
 run(f"update private.goods_subscription_plans set next_run_at=(select scheduled_at from private.goods_subscription_cycles where id='{data['id']}') where id='{plan_id}';",name+'-next-fixture');return data['id']
def claim_prepare_sql(cycle_id,token,fence):return service+f"select public.service_prepare_goods_subscription_work('{actor}','{cycle_id}','{token}',{fence},'{profile}','fake-v1');"
cycle_id=due_cycle('price');lease=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(30)}','{cycle_id}');commit;",'price-claim').stdout)
a,b=blocked_pair("begin;update public.goods set price=15000 where id='subscription-tx-good';",claim_prepare_sql(cycle_id,uid(30),lease['fence']),'price-change-dispatch')
assert obj(b)=={'kind':'stopped','reason':'terms_changed'},b
changed=obj(run(f"select jsonb_build_object('state',p.state,'reason',p.pause_reason,'orderId',c.order_id,'attemptId',c.attempt_id) from private.goods_subscription_plans p join private.goods_subscription_cycles c on c.id='{cycle_id}' where p.id='{plan_id}';",'price-change-readback').stdout)
assert changed=={'state':'needs_confirmation','reason':'terms_changed','orderId':None,'attemptId':None},changed
price_changed=changed
print('PASS concurrent price change stops next cycle before order or dispatch and requires new consent',flush=True)
run("update public.goods set price=10000 where id='subscription-tx-good';",'restore-fixture-price')
next_schedule=obj(run("select jsonb_build_object('unit','month','interval',1,'anchorDate',((clock_timestamp() at time zone 'Asia/Seoul')::date+1)::text,'time','09:00','monthEnd',false);",'next-schedule').stdout)
def proposal(command,operation):
 revision=int(run(f"select revision from private.goods_subscription_plans where id='{plan_id}';",command+'-revision').stdout.strip())
 return obj(run(customer+f"select public.prepare_my_goods_subscription_change('{actor}','{plan_id}',{revision},'{operation}','{command}',{sjson({'schedule':next_schedule})});commit;",command+'-proposal').stdout)
def change_sql(p,new_card,operation):
 return f"select public.confirm_my_goods_subscription_change('{actor}','{plan_id}',{p['expectedRevision']},'{p['id']}','{p['termsId']}','{p['quoteId']}','{new_card}','{operation}',true);"
p=proposal('accept_terms',uid(31));run(customer+change_sql(p,credential,uid(32))+'commit;','accept-price-consent')
cycle_id=due_cycle('card');lease=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(33)}','{cycle_id}');commit;",'card-old-claim').stdout)
replacement=uid(34)
run(f"insert into private.billing_credentials select (jsonb_populate_record(null::private.billing_credentials,to_jsonb(c)||jsonb_build_object('id','{replacement}'))).* from private.billing_credentials c where id='{credential}';",'replacement-card-fixture')
p=proposal('replace_card',uid(35))
blocked_pair(customer+change_sql(p,replacement,uid(36)),claim_prepare_sql(cycle_id,uid(33),lease['fence']),'card-replacement-dispatch','subscription_claim_stale')
changed=obj(run(f"select jsonb_build_object('credential',p.credential_id,'oldCycleState',c.state,'oldAttempt',c.attempt_id,'oldDispatched',c.dispatched_at) from private.goods_subscription_plans p join private.goods_subscription_cycles c on c.id='{cycle_id}' where p.id='{plan_id}';",'card-change-readback').stdout)
assert changed=={'credential':replacement,'oldCycleState':'skipped','oldAttempt':None,'oldDispatched':None},changed
print('PASS concurrent card replacement invalidates old cycle lease before dispatch',flush=True)
# Cart and subscription call the same creator and compete for one available
# lifetime unit. Run once with last stock=1, then with spare stock=5 to isolate quota.
cart_races=[]
for case,stock,offset in [('last-stock-and-member-limit',1,50),('member-limit-with-spare-stock',5,60)]:
 run(f"update public.goods set member_purchase_limit_enabled=true,member_lifetime_qty_limit=1 where id='subscription-tx-good';update public.goods_variants set stock_qty={stock} where good_id='subscription-tx-good';",case+'-limits')
 cycle_id=due_cycle(case);lease=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(offset)}','{cycle_id}');commit;",case+'-claim').stdout)
 variant=run("select id from public.goods_variants where good_id='subscription-tx-good' and is_default;",case+'-variant').stdout.strip()
 run(customer+f"select public.set_cart_item_quantity('subscription-tx-good','{variant}',1);select public.clear_cart_coupon();commit;",case+'-cart')
 cart_selection=json.loads(run(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='{actor}';",case+'-selection').stdout)
 quoted=obj(run(service+f"select public.quote_cart_goods_transaction('{actor}',{sjson(cart_selection)},{sjson(terms['address'])},'{{}}',null,0);commit;",case+'-quote').stdout);assert quoted['state']=='quoted',quoted
 place_sql=service+f"select jsonb_build_object('orderId',public.place_cart_goods_transaction('{actor}',{sjson(cart_selection)},{sjson(terms['address'])},'{quoted['quoteId']}','{uid(offset+1)}','card'));"
 a,b=blocked_pair(place_sql,claim_prepare_sql(cycle_id,uid(offset),lease['fence']),case+'-cart-subscription');cart_order=obj(a)['orderId'];assert obj(b)['kind']=='stopped',b
 oracle=obj(run(f"select jsonb_build_object('stock',(select stock_qty from public.goods_variants where id='{variant}'),'activeQty',(select sum(i.qty) from public.order_items i join public.orders o on o.id=i.order_id where o.user_id='{actor}' and o.status<>'canceled' and i.good_id='subscription-tx-good'),'cycleOrder',(select order_id from private.goods_subscription_cycles where id='{cycle_id}'),'cycleAttempt',(select attempt_id from private.goods_subscription_cycles where id='{cycle_id}'))",case+'-readback').stdout)
 assert oracle=={'stock':stock-1,'activeQty':1,'cycleOrder':None,'cycleAttempt':None},oracle
 cart_races.append({'case':case,'observedLockWait':True,'readback':oracle})
 run(service+f"select public.cancel_order('{cart_order}','TEST unpaid cart cleanup');commit;",case+'-cancel-cart')
 p=proposal('resume',uid(offset+2));run(customer+change_sql(p,replacement,uid(offset+3))+'commit;',case+'-resume')
 print('PASS cart/subscription '+case+' actual lock wait; one lifetime unit reserved, no second order/attempt',flush=True)
run("update public.goods set member_purchase_limit_enabled=false,member_lifetime_qty_limit=null where id='subscription-tx-good';update public.goods_variants set stock_qty=100 where good_id='subscription-tx-good';",'clear-cart-race-fixture-limits')
cycle_id=due_cycle('account-fence');lease=obj(run(service+f"select public.service_claim_goods_subscription_work('{uid(37)}','{cycle_id}');commit;",'account-fence-claim').stdout)
work=obj(run(claim_prepare_sql(cycle_id,uid(37),lease['fence'])+'commit;','account-fence-prepare').stdout);assert work['kind']=='charge'
assert fake({**common,'kind':'register','operationRef':'d'*64,'payloadHash':'e'*64,'credentialRef':'f'*64,'customerRef':'4'*64},'fake-replacement-register')['state']=='registered'
second_charge=fake({**common,'kind':'charge','operationRef':'1a'*32,'payloadHash':'2a'*32,'credentialRef':'f'*64,'customerRef':'4'*64,'orderRef':'3a'*32,'attemptId':work['attempt']['id'],'amount':work['attempt']['amount']},'fake-before-fence');assert second_charge['state']=='approved'
fence_sql=f"begin;select private.subscription_lock_actor('{actor}',false);insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values('{uid(38)}','{actor}','{uid(39)}','awaiting_email_intent');insert into private.account_action_fences(subject_user_id,deletion_event_id) values('{actor}','{uid(38)}');"
finish_sql=service+f"select public.service_finish_goods_subscription_work('{actor}','{cycle_id}','{uid(37)}',{lease['fence']},'approved','{second_charge['paymentKey']}','{second_charge['transactionId']}','12345678','DONE','카드','43301234****123*','{second_charge['at']}');"
a,b=blocked_pair(fence_sql,finish_sql,'account-fence-finalizer');assert 'needs_review' in b,b
retained=obj(run(f"select jsonb_build_object('plan',p.state,'cycle',c.state,'attempt',a.state,'order',o.status,'evidence',(select count(*) from private.payment_provider_evidence where payment_attempt_id=a.id and provider_payment_key='{second_charge['paymentKey']}')) from private.goods_subscription_plans p join private.goods_subscription_cycles c on c.plan_id=p.id join public.payment_attempts a on a.id=c.attempt_id join public.orders o on o.id=c.order_id where c.id='{cycle_id}';",'account-fence-finalizer-readback').stdout)
assert retained['cycle']=='needs_review' and retained['attempt']=='needs_review' and retained['order']=='pending' and retained['evidence']>=1,retained
print('PASS account fence blocks finalizer, preserves actual approval evidence and marks review without a new order',flush=True)
(out/'result.json').write_text(json.dumps({'status':'PASS','database':database,'twoSessionsHeldClaim':True,'cancellationActuallyBlockedWorker':True,'sameOperationActuallyBlocked':True,
 'priceChangeActuallyBlockedDispatch':True,'cardReplacementActuallyBlockedDispatch':True,'accountFenceActuallyBlockedFinalizer':True,'durableFakeAcrossProcesses':True,'reclaimedLeaseActuallyBlockedOldWorker':True,'readback':final,
 'refundWebhookReadback':refunded_db,'cartSubscriptionRaces':cart_races,'priceChangeReadback':price_changed,'cardReplacementReadback':changed,'fencedApprovalReadback':retained,'externalNetworkCalls':0},indent=2))

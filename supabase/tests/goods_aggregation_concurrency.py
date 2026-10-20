"""Observe actual owner-row waits inside the explicitly leased aggregation clone."""
import json,os,re,subprocess,time,uuid
from pathlib import Path
container=os.environ['SUPABASE_DB_CONTAINER'];database=os.environ['PGDATABASE'];lease=os.environ['GOODS_AGGREGATION_LEASE']
assert re.fullmatch(r'[0-9a-f]{64}',container) and re.fullmatch(r'icons_(?:goods_aggregation|goods_transaction)_[0-9a-f]{32}',database)
lease_uuid=uuid.UUID(lease)
assert lease==str(lease_uuid) and database.endswith('_'+lease_uuid.hex)
cmd=['docker','exec','-i',container,'psql','-X','-qAt','-U','supabase_admin','-d',database,'-v','ON_ERROR_STOP=1']
def sql(source):
 r=subprocess.run(cmd,input=source,text=True,capture_output=True)
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
identity=json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;'))
assert identity['lease']==lease and identity['container_id']==container and identity['source_database']=='postgres'
prefix='aggregation-race-'+str(os.getpid());buyer='bc140000-0000-4000-8000-000000000002'
def literal(value):return "'"+value.replace("'","''")+"'"
def start(label,source,delay=0):
 proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 proc.stdin.write(f"set application_name='{prefix}-{label}';begin;set local lock_timeout='10s';"+source+(f'select pg_sleep({delay});' if delay else '')+'commit;')
 proc.stdin.close();proc.stdin=None;return proc
def wait(label,event,proc):
 for _ in range(200):
  if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{prefix}-{label}';")==event:return
  if proc.poll() is not None:raise RuntimeError(f'{label} exited before {event}: {proc.communicate()}')
  time.sleep(.02)
 raise RuntimeError(f'{label} did not enter {event}')
def finish(proc):
 output,error=proc.communicate(timeout=15)
 if proc.returncode:raise RuntimeError(error)
 return output.strip()
root=Path(__file__).parent
fixture=(root/'goods_aggregation_families.sql').read_text().split('set local role service_role;')[0]
fixture=fixture.replace('pg_temp.','goods_aggregation_race.').replace('begin;','',1)
kc=(root/'helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.','goods_aggregation_race.')
sql('begin;create schema goods_aggregation_race;grant usage on schema goods_aggregation_race to authenticated,service_role;'+kc+fixture+"reset role;update private.operator_memberships set manager_role='owner' where profile_id='bc140000-0000-4000-8000-000000000001' and not exists(select 1 from private.operator_memberships where manager_role='owner');commit;")
# The original is deliberately absent from the cart. Only the inherited policy
# requires checkout to lock it, so a selected-goods-only lock implementation fails.
sql(f"delete from public.cart_items where user_id='{buyer}' and good_id='aggregation-root';update public.cart_items set qty=2 where user_id='{buyer}' and good_id='aggregation-child';")
expected=sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='{buyer}';")
held=sql(f"select user_coupon_id from public.cart_coupon_selections where user_id='{buyer}';")
address='{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'
quote=f"set local role service_role;select public.quote_cart_goods_transaction('{buyer}',{literal(expected)},{literal(address)},'{{}}','{held}',0);"
first=start('owner-change',"update public.goods set min_order_qty=1,max_order_qty=1 where id='aggregation-root';",1.3)
wait('owner-change','Timeout',first)
second=start('child-quote',quote);wait('child-quote','Lock',second)
finish(first);result=json.loads(finish(second))
assert result['state']=='blocked' and result['issues'][0]['code']=='purchase_limit',result
assert sql(f"select not exists(select 1 from private.goods_transaction_quotes where actor_id='{buyer}');")=='t'
print('PASS unselected owner update / child-only quote: real Lock wait, refreshed family limit, zero quotes',flush=True)
sql("update public.goods set min_order_qty=2,max_order_qty=3 where id='aggregation-root';")
first=start('child-quote-holds-owner',quote,1.3);wait('child-quote-holds-owner','Timeout',first)
second=start('owner-change-waits',"update public.goods set min_order_qty=1,max_order_qty=1 where id='aggregation-root';")
wait('owner-change-waits','Lock',second);finish(first);finish(second)
assert sql(f"select count(*)=1 from private.goods_transaction_quotes where actor_id='{buyer}';")=='t'
assert sql(f"select not exists(select 1 from public.orders where user_id='{buyer}');")=='t'
print('PASS child-only quote / owner update: reverse real Lock wait, one immutable quote, zero orders',flush=True)
print(json.dumps({'cases':2,'sourceDatabaseWrites':0,'database':database}),flush=True)

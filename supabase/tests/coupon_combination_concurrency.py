"""Synthetic local-only coupon order retries and competing checkout keys."""
import argparse, concurrent.futures, json, subprocess, threading, uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--runtime-json',required=True);rt=json.loads(Path(p.parse_args().runtime_json).read_text());cid=rt['databaseContainerId'];meta=json.loads(subprocess.check_output(['docker','inspect',cid],timeout=10))[0]
assert rt['projectId'].startswith('icons-ip-full-admin-') and meta['Id']==cid and meta['Name']=='/supabase_db_'+rt['projectId']
def sql(q):
 r=subprocess.run(['docker','exec','-i',cid,'psql','-X','-U','supabase_admin','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],input=q.encode(),capture_output=True,timeout=60)
 if r.returncode:raise RuntimeError(r.stderr.decode()[-2000:])
 return r.stdout.decode().strip()
run=uuid.uuid4().hex[:8];good_a=f'coupon-race-{run}-a';good_b=f'coupon-race-{run}-b';actor=f'{run}-0000-4000-8000-000000000001';buyer=f'{run}-0000-4000-8000-000000000002';session=f'{run}-0000-4000-9000-000000000001'
fixture=Path('supabase/tests/coupon_combinations.sql').read_text().split('set local role service_role;\nselect public.quote_cart_goods_transaction_combined',1)[0].replace('c7160854',run).replace('coupon-combination-check',f'coupon-race-{run}').replace('COMBO-',run.upper()+'-')
fixture+="""select pg_temp.coupon_actor(1);set local role authenticated;
select public.admin_save_coupon_combination_policy('{"stackingEnabled":true,"maxGoodsCoupons":3,"shippingEnabled":true,"evidence":"TEST concurrency policy","confirmed":true}',(public.admin_get_coupon_combination_policy()->>'revision')::bigint,gen_random_uuid(),auth.uid(),(auth.jwt()->>'session_id')::uuid);
reset role;commit;
"""
sql(Path('supabase/tests/helpers/goods_kc_fixture.sql').read_text()+fixture)
cart=json.loads(sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='{buyer}';"))
address={'recipientName':'TEST 쿠폰 구매자','phone':'01000000000','postalCode':'12345','address1':'TEST 합성 주소'};choices={good_a:{'method':'quick','paymentMode':'prepaid'}};ids=[f'{run}-0000-4008-8000-{n:012}' for n in [1,2,3]]
def lit(value):return "'"+json.dumps(value,ensure_ascii=False).replace("'","''")+"'"
def quote():
 return json.loads(sql(f"begin;set local role service_role;select public.quote_cart_goods_transaction_combined('{buyer}',{lit(cart)},{lit(address)},{lit(choices)},array["+','.join("'"+i+"'" for i in ids)+"]::uuid[],0);commit;").splitlines()[-1])
def place(q,key):return sql(f"begin;set local lock_timeout='20s';set local role service_role;select public.place_cart_goods_transaction('{buyer}',{lit(cart)},{lit(address)},'{q['quoteId']}','{key}','card');commit;").splitlines()[-1]
def race(size,fn):
 barrier=threading.Barrier(size)
 def task(n):barrier.wait(timeout=15);return fn(n)
 with concurrent.futures.ThreadPoolExecutor(max_workers=size) as pool:return list(pool.map(task,range(size)))
first_quote=quote();assert first_quote['state']=='quoted',first_quote
key=str(uuid.uuid4());orders=race(12,lambda _:place(first_quote,key));assert len(set(orders))==1,orders;order=orders[0]
proof=json.loads(sql(f"select jsonb_build_object('orders',(select count(*) from public.orders where user_id='{buyer}'),'redemptions',(select count(*) from public.coupon_redemptions where order_id='{order}'),'goodsDiscount',discount_total,'shippingDiscount',shipping_coupon_discount_total,'shippingFee',shipping_fee,'total',total,'valid',private.goods_transaction_snapshot_matches(id,total,shipping_fee)) from public.orders where id='{order}';"))
assert proof=={'orders':1,'redemptions':3,'goodsDiscount':5200,'shippingDiscount':3500,'shippingFee':5900,'total':25700,'valid':True},proof
# Cancellation releases all three; a separate set of checkout keys then competes for the same coupons.
sql(f"update public.orders set status='canceled' where id='{order}';")
jwt=json.dumps({'sub':buyer,'role':'authenticated','session_id':f'{run}-0000-4000-9000-000000000002'})
restore="begin;select set_config('request.jwt.claims','"+jwt+"',true);set local role authenticated;"+''.join(f"select public.set_cart_item_quantity('{item['good_id']}','{item['variant_id']}',{item['qty']});" for item in cart)+'commit;'
sql(restore);quotes=[quote(),quote()]
def competing(n):
 try:return {'saved':place(quotes[n%2],str(uuid.uuid4()))}
 except RuntimeError as e:
  reasons=['cart_snapshot_changed','transaction_quote_changed','transaction_quote_already_used','coupon_already_used'];reason=next((x for x in reasons if x in str(e)),None);assert reason,str(e);return {'blocked':reason}
results=race(8,competing);assert sum('saved' in r for r in results)==1,results
state=json.loads(sql(f"select jsonb_build_object('pendingOrders',(select count(*) from public.orders where user_id='{buyer}' and status='pending'),'applied',(select count(*) from public.coupon_redemptions where user_id='{buyer}' and status='applied'),'released',(select count(*) from public.coupon_redemptions where user_id='{buyer}' and status='released'),'used',(select count(*) from public.user_coupons where user_id='{buyer}' and status='used'));"))
assert state=={'pendingOrders':1,'applied':3,'released':3,'used':3},state
print(json.dumps({'run':run,'sameRequestCount':12,'sameOrder':order,'firstReadback':proof,'competingKeys':results,'finalReadback':state},indent=2))

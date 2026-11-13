"""Same-claim defective stock recording races on a disposable clone, without contacting a payment provider."""
if not __debug__:
    raise SystemExit('Refusing optimized Python: safety assertions must remain enabled')

import hashlib
import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_claim_defective_concurrency_'):
    raise SystemExit('Use the disposable claim defective stock wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number=1):
    return hashlib.md5(f'claim-defective-concurrency:{kind}:{number}'.encode()).hexdigest()[:8] + f'-1111-4111-8111-{number:012d}'


def actor(number=1):
    return (f"select set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub','{uid('user', number)}',"
            f"'session_id','{uid('session', number)}')::text,true);set local role authenticated;")


CLAIM = uid('claim')
ITEM_KEPT = uid('item', 2)
ITEM_DEFECT = uid('item', 1)

# Synthetic fixture: one return claim with two items, item 1 chosen as defective, refund finalized (stock restored for item 2 only).
sql(f"""
begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data)
 values ('{uid('user', 1)}','authenticated','authenticated','defective-race-1@example.test',clock_timestamp(),'{{}}','{{}}'),
        ('{uid('user', 2)}','authenticated','authenticated','defective-race-2@example.test',clock_timestamp(),'{{}}','{{}}');
insert into auth.sessions(id,user_id,created_at,updated_at) values ('{uid('session', 1)}','{uid('user', 1)}',clock_timestamp(),clock_timestamp());
update public.profiles set nickname='TEST 불량재고 동시성', role='admin' where id='{uid('user', 1)}';
insert into private.operator_memberships(profile_id,manager_role) values ('{uid('user', 1)}','primary');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values ('{uid('origin')}','defective-race-origin','TEST 불량재고 출고지','hanjin',3000,'TEST 반품 주소',true);
insert into public.ips(id,title,vertical_key) values ('defective-race-ip','TEST 불량재고 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 select 'defective-race-good-'||n,'defective-race-ip','TEST 불량재고 상품 '||n,'문구',10000,'ok',10,'{uid('origin')}' from generate_series(1,2) n;
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,created_at,delivered_at,shipped_at)
 values ('{uid('order')}','{uid('user', 2)}','delivered',50000,0,
  '{{"recipientName":"TEST 구매자","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}}','card',
  clock_timestamp()-interval '3 days',clock_timestamp()-interval '1 day',clock_timestamp()-interval '2 days');
insert into public.order_items(id,order_id,good_id,variant_id,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,qty,unit_price)
 select ('{ITEM_DEFECT}'::uuid), '{uid('order')}'::uuid, 'defective-race-good-1', v.id, 'TEST 불량재고 상품 1', '문구', 'defective-race-ip', 2, 10000
 from public.goods_variants v where v.good_id='defective-race-good-1' and v.is_default
 union all
 select ('{ITEM_KEPT}'::uuid), '{uid('order')}'::uuid, 'defective-race-good-2', v.id, 'TEST 불량재고 상품 2', '문구', 'defective-race-ip', 3, 10000
 from public.goods_variants v where v.good_id='defective-race-good-2' and v.is_default;
insert into public.payments(id,user_id,provider,purpose,ref_id,amount,status,payment_key,idempotency_key,created_at)
 values ('{uid('payment')}','{uid('user', 2)}','toss','order','{uid('order')}',50000,'paid','TEST-DEFECT-RACE-KEY','defective-race-test',clock_timestamp()-interval '3 days');
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,reason_type,claim_type,stage,collection_policy,collected_at,requested_at)
 values ('{CLAIM}','{uid('order')}','{uid('user', 2)}','TEST 불량 재고 동시성','defect','return','collected','legacy',
  clock_timestamp()-interval '30 minutes',clock_timestamp()-interval '2 days');
{actor()}
select public.admin_plan_claim_defective_stock('{CLAIM}',array['{ITEM_DEFECT}']::uuid[]);
select public.admin_record_order_claim_refund('{CLAIM}','pg_cancel','filed',null);
reset role;
select public.complete_order_cancellation_request('{CLAIM}',array['TEST-DEFECT-RACE-KEY'],'{uid('user', 1)}');
commit;
""")

assert sql(f"select count(*) from private.claim_defective_stock where claim_id='{CLAIM}' and state='planned';") == '1'


def record(_):
    output = sql(f"begin;{actor()}select public.admin_record_claim_defective_stock('{CLAIM}');commit;")
    return [line for line in output.splitlines() if line.startswith('{') and '"recorded"' in line][0]


# Six concurrent callers record the same claim: exactly one writes, the rest replay.
with ThreadPoolExecutor(max_workers=6) as pool:
    results = [json.loads(value) for value in pool.map(record, range(6))]

assert sum(result['recorded'] for result in results) == 1, results
assert all(result['total'] == 1 and result['pending'] == 0 for result in results), results
assert sql(f"select count(*) from private.claim_defective_stock where claim_id='{CLAIM}' and state='recorded';") == '1'
assert sql(f"select count(*) from public.audit_log where action='order.claim_defective_stock_recorded' and diff->>'claimId'='{CLAIM}';") == '1'
# Stock: the kept item is restored once (+3), the defective item never (10).
assert sql("select stock_qty from public.goods_variants where good_id='defective-race-good-1' and is_default;") == '10'
assert sql("select stock_qty from public.goods_variants where good_id='defective-race-good-2' and is_default;") == '13'
print('claim defective stock concurrency passed')

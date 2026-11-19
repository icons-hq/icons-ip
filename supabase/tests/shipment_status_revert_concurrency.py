"""Race the delivery revert (ADR-0045) against automatic purchase confirmation and customer return intake.

The revert locks orders, then shipments, in id order (lock_shipment_pack_scope) — the same graph as settle_delivered_orders
(order, then confirmation row, never waiting) and request_order_claim (order, then shipments). Exactly one side wins:
  · revert first: the settle run skips the held order and later finds it in transit; the return intake waits and then sees
    an in-transit order (no deadlock).
  · settle/intake first: the revert waits for the order lock and then refuses (purchase confirmed / claim exists).
"""
import json
import os
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_shipment_revert_concurrency_'):
    raise SystemExit('Use the disposable shipment revert concurrency wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'shipment-revert-{os.getpid()}'
operator = 'c3b00000-0000-4000-8000-000000000001'
buyer = 'c3b00000-0000-4000-8000-000000000002'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def order(n):
    return f'c3b00000-0000-4001-8000-{n:012d}'


def shipment(n):
    return f'c3b00000-0000-4002-8000-{n:012d}'


def as_operator():
    return f"select set_config('request.jwt.claim.sub','{operator}',true);set local role authenticated;"


def revert(n, reason='엉뚱한 배송 건을 배송완료로 눌렀음'):
    return (as_operator() + f"select public.admin_revert_shipment_delivery('{shipment(n)}','{reason}','{uuid.uuid4()}',"
            f"(select delivered_at from public.order_shipments where id='{shipment(n)}'));reset role;")


SETTLE = 'select public.settle_delivered_orders();'


def intake(n):
    return (f"set local role service_role;select public.request_order_claim('{order(n)}','{buyer}','return','TEST 반품 경합','change_of_mind');"
            'reset role;')


def session(name, body):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}';{body}")
    process.stdin.close()
    process.stdin = None
    return process


def wait_state(name, expected, process):
    for _ in range(200):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def finish(process, label, expect_error=None):
    out, err = process.communicate(timeout=30)
    if 'deadlock' in err:
        raise RuntimeError(f'{label}: deadlock {err}')
    if expect_error:
        if process.returncode == 0 or expect_error not in err:
            raise RuntimeError(f'{label}: expected {expect_error}, got rc={process.returncode} {err}')
        return out
    if process.returncode:
        raise RuntimeError(f'{label}: {err}')
    return out


def state(n):
    return sql(f"""select s.status||':'||o.status||':'||(select count(*) from private.order_purchase_confirmations c where c.order_id=o.id)
        ||':'||(select count(*) from public.order_cancellation_requests q where q.order_id=o.id)
        from public.order_shipments s join public.orders o on o.id=s.order_id where s.id='{shipment(n)}';""")


ORDERS = 4
fixture = f"""
begin;
update private.operator_access_state set configured=false,revision=1 where id;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('{operator}','authenticated','authenticated','shipment-revert-race-operator@example.test',now(),'{{}}','{{}}',now(),now()),
 ('{buyer}','authenticated','authenticated','shipment-revert-race-buyer@example.test',now(),'{{}}','{{}}',now(),now());
update public.profiles set nickname='TEST 정정 경합 '||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true}}',
 role=case when id='{operator}' then 'staff'::public.user_role else 'user'::public.user_role end where id in('{operator}','{buyer}');
insert into private.operator_memberships(profile_id,manager_role) values('{operator}','primary');
update private.purchase_confirmation_policy set auto_enabled=true,auto_after_days=7,buyer_extension_days=3 where singleton;
insert into public.ips(id,title,vertical_key) values('shipment-revert-race-ip','TEST 정정 경합 IP','character');
insert into public.goods(id,ip_id,name,price,stock,stock_qty) values('shipment-revert-race-good','shipment-revert-race-ip','TEST 정정 경합 상품',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('c3b00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'{buyer}','shipping'::public.order_status,1000,0,
 jsonb_build_object('recipientName','TEST 수령인'||n,'phone','0108888000'||(n%10),'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote',''),now()-interval '14 days'
from generate_series(1,{ORDERS}) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_ip_id_snapshot)
select ('c3b00000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,('c3b00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'shipment-revert-race-good',v.id,1,1000,
 'TEST 정정 경합 상품','shipment-revert-race-ip'
from generate_series(1,{ORDERS}) n cross join (select id from public.goods_variants where good_id='shipment-revert-race-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,exported_at)
select ('c3b00000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,('c3b00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042201'::uuid,'김포',0,'{{}}','shipping','hanjin','8'||lpad(n::text,11,'0'),now()-interval '12 days',now()-interval '13 days'
from generate_series(1,{ORDERS}) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select ('c3b00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,('c3b00000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,
 ('c3b00000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,1 from generate_series(1,{ORDERS}) n;
insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
select '{buyer}','order',('c3b00000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'toss',1000,'paid','pk-revert-race-'||n,'idem-revert-race-'||n
from generate_series(1,{ORDERS}) n;
select set_config('request.jwt.claim.sub','{operator}',true);
set local role authenticated;
-- 1·2: 10일 전에 도착(구매확정 기한이 이미 지남), 3·4: 어제 도착(반품 접수 가능).
select public.admin_complete_shipments_at(array['{shipment(1)}','{shipment(2)}']::uuid[],now()-interval '10 days','택배사 조회 결과 10일 전 도착');
select public.admin_complete_shipments_at(array['{shipment(3)}','{shipment(4)}']::uuid[],now()-interval '1 day',null);
reset role;
commit;
"""
sql(fixture)
delivered = sql("select count(*) from public.order_shipments where id::text like 'c3b00000-0000-4002-8000-%' and status='delivered';")
assert delivered == str(ORDERS), delivered
due = sql("select count(*) from private.order_purchase_confirmations where order_id::text like 'c3b00000-0000-4001-8000-%' and auto_due_at<=now();")
assert due == '2', due

# 1) 되돌리기가 주문 1을 잡은 동안 자동 구매확정이 돈다: 기다리지 않고 1을 넘긴다. 되돌린 뒤에는 대상이 아니다.
name = f'{prefix}-revert-first'
holder = session(f'{name}-revert', f'begin;{revert(1)}select pg_sleep(1.5);commit;')
wait_state(f'{name}-revert', 'Timeout', holder)
started = time.monotonic()
settled = finish(session(f'{name}-settle', f'begin;{SETTLE}commit;'), 'settle while revert holds order 1')
elapsed = time.monotonic() - started
assert holder.poll() is None, 'settle must finish while the revert still holds its lock'
assert elapsed < 1.4, f'settle waited for a lock ({elapsed:.2f}s)'
finish(holder, 'revert holding order 1')
# 정산 실행은 2를 확정하고(1은 건너뜀) — 되돌린 1은 배송 중이고 기한 행이 없다. 다시 돌려도 1은 확정되지 않는다.
assert state(1) == 'shipping:shipping:0:0', state(1)
assert state(2) == 'delivered:done:1:0', (state(2), settled)
sql(SETTLE)
assert state(1) == 'shipping:shipping:0:0', state(1)
print(f'PASS revert-first: settle skipped the held order without waiting ({elapsed:.2f}s); reverted order is not confirmed later')

# 2) 자동 구매확정이 이미 주문 2를 확정했다 — 정산이 잠금을 쥔 동안 되돌리기는 기다렸다가 거절한다. 새 정산 대상 하나를 만들어 재현한다.
sql(f"""begin;update public.order_shipments set status='shipping',delivered_at=null where id='{shipment(1)}';
select set_config('request.jwt.claim.sub','{operator}',true);set local role authenticated;
select public.admin_complete_shipments_at(array['{shipment(1)}']::uuid[],now()-interval '10 days','택배사 조회 결과 10일 전 도착');reset role;commit;""")
assert state(1) == 'delivered:delivered:1:0', state(1)
name = f'{prefix}-settle-first'
runner = session(f'{name}-settle', f'begin;{SETTLE}select pg_sleep(1.5);commit;')
wait_state(f'{name}-settle', 'Timeout', runner)
waiter = session(f'{name}-revert', f'begin;{revert(1)}commit;')
wait_state(f'{name}-revert', 'Lock', waiter)
finish(runner, 'settle holding order 1')
finish(waiter, 'revert after settle', expect_error='shipment_revert_purchase_confirmed')
assert state(1) == 'delivered:done:1:0', state(1)
print('PASS settle-first: revert waited for the confirmation (real lock wait) and refused a confirmed purchase')

# 3) 반품 접수가 주문 3을 잡은 동안 되돌리기는 기다렸다가 클레임 때문에 거절한다.
name = f'{prefix}-intake-first'
runner = session(f'{name}-intake', f'begin;{intake(3)}select pg_sleep(1.5);commit;')
wait_state(f'{name}-intake', 'Timeout', runner)
waiter = session(f'{name}-revert', f'begin;{revert(3)}commit;')
wait_state(f'{name}-revert', 'Lock', waiter)
finish(runner, 'intake holding order 3')
finish(waiter, 'revert after intake', expect_error='shipment_revert_claim_exists')
assert state(3) == 'delivered:delivered:1:1', state(3)
print('PASS intake-first: revert waited for the return intake and refused')

# 4) 되돌리기가 주문 4를 잡은 동안 반품 접수는 기다렸다가 배송 중 주문으로 본다(교착 없음, 상태는 한 번만 바뀐다).
name = f'{prefix}-revert-before-intake'
holder = session(f'{name}-revert', f'begin;{revert(4)}select pg_sleep(1.5);commit;')
wait_state(f'{name}-revert', 'Timeout', holder)
waiter = session(f'{name}-intake', f'begin;{intake(4)}commit;')
wait_state(f'{name}-intake', 'Lock', waiter)
finish(holder, 'revert holding order 4')
outcome = finish(waiter, 'intake after revert')
assert state(4).startswith('shipping:shipping:0:'), (state(4), outcome)
assert sql(f"select count(*) from private.shipment_status_reverts where shipment_id='{shipment(4)}';") == '1'
print(f'PASS revert-before-intake: intake waited and saw an in-transit order ({state(4)})')
print('PASS final readback: each race changed the order once without deadlock')

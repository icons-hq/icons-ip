"""Race the tracking auto delivery run against operator bulk delivery (QNA-028).

The run takes order locks in the same global order as the operator path (order id, then shipment id) and never waits
(skip locked), so the two sides cannot deadlock: a run that meets a held lock leaves that pack for its next tick, and an
operator who meets the run's lock waits briefly and then sees the shipment already delivered.
"""
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_delivery_tracking_concurrency_'):
    raise SystemExit('Use the disposable delivery tracking concurrency wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'delivery-tracking-{os.getpid()}'
operator = 'f13c0000-0000-4000-8000-000000000001'
buyer = 'f13c0000-0000-4000-8000-000000000002'
PAIRS = 8


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def order(n):
    return f'f13c0000-0000-4001-8000-{n:012d}'


def shipment(n):
    return f'f13c0000-0000-4002-8000-{n:012d}'


def tracking(n):
    return f'DC{n:08d}'


SERVICE_RUN = 'set local role service_role;select public.service_complete_tracked_deliveries(50);reset role;'


def operator_complete(*numbers):
    ids = ','.join(f"'{shipment(n)}'" for n in numbers)
    return (f"select set_config('request.jwt.claim.sub','{operator}',true);set local role authenticated;"
            f'select public.admin_complete_shipments(array[{ids}]::uuid[]);reset role;')


def delivered_events(*numbers):
    return ''.join(
        "insert into private.shipment_tracking_events(provider,carrier,tracking_number,event_key,status,occurred_at,payload)"
        f" values('fake','hanjin','{tracking(n)}','delivered-{n}','delivered',now()-interval '1 hour','{{}}');" for n in numbers)


def last_json(output):
    lines = [line for line in output.splitlines() if line.startswith('{') or line.startswith('[')]
    if not lines:
        raise RuntimeError(f'no JSON result in {output!r}')
    return json.loads(lines[-1])


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


def finish(process, label):
    out, err = process.communicate(timeout=30)
    if process.returncode or 'deadlock' in err:
        raise RuntimeError(f'{label}: {err}')
    return out


def delivered_once(n):
    # 배송 중 → 배송완료 전이 감사가 정확히 하나(자동 또는 운영자)이고, 자동이면 그 시각이 배송 건 시각과 같다(나중 쪽이 덮어쓰지 않았다).
    return sql(f"""select s.status||':'||(select string_agg(case when l.action='system.shipment.tracking_delivered' then 'auto' else 'manual' end,',')
        from public.audit_log l where l.target='order:'||s.order_id and l.diff->>'shipmentId'=s.id::text and l.diff->>'to'='delivered'
          and l.action in ('system.shipment.tracking_delivered','admin.shipment.status_updated'))
      ||':'||coalesce((a.delivered_at=s.delivered_at)::text,'-')
      from public.order_shipments s left join private.shipment_auto_deliveries a on a.shipment_id=s.id and a.state='completed'
      where s.id='{shipment(n)}';""")


numbers = range(1, PAIRS * 2 + 1)
fixture = f"""
begin;
update private.operator_access_state set configured=false,revision=1 where id;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('{operator}','authenticated','authenticated','delivery-tracking-race-operator@example.test',now(),'{{}}','{{}}',now(),now()),
 ('{buyer}','authenticated','authenticated','delivery-tracking-race-buyer@example.test',now(),'{{}}','{{}}',now(),now());
update public.profiles set nickname='TEST 추적 경합 '||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true}}',
 role=case when id='{operator}' then 'staff'::public.user_role else 'user'::public.user_role end where id in('{operator}','{buyer}');
insert into private.operator_memberships(profile_id,manager_role) values('{operator}','primary');
insert into public.ips(id,title,vertical_key) values('delivery-tracking-race-ip','TEST 추적 경합 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('delivery-tracking-race-good','delivery-tracking-race-ip','TEST 추적 경합 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('f13c0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'{buyer}','confirmed'::public.order_status,4000,3000,
 jsonb_build_object('recipientName','TEST 수령인'||n,'phone','0107777000'||(n%10),'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote',''),now()-interval '3 days'
from generate_series(1,{PAIRS * 2}) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('f13c0000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,('f13c0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'delivery-tracking-race-good',v.id,1,1000,
 'TEST 추적 경합 상품','문구','delivery-tracking-race-ip'
from generate_series(1,{PAIRS * 2}) n cross join (select id from public.goods_variants where good_id='delivery-tracking-race-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at)
select ('f13c0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,('f13c0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042201'::uuid,'김포',3000,'{{}}',now()-interval '2 days'
from generate_series(1,{PAIRS * 2}) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select ('f13c0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,('f13c0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,
 ('f13c0000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,1 from generate_series(1,{PAIRS * 2}) n;
set local role authenticated;
select set_config('request.jwt.claim.sub','{operator}',true);
select public.admin_import_shipment_tracking_batch((select jsonb_agg(jsonb_build_object('line',n,'reference',('f13c0000-0000-4002-8000-'||lpad(n::text,12,'0')),
 'carrier','hanjin','trackingNumber','DC'||lpad(n::text,8,'0'))) from generate_series(1,{PAIRS * 2}) n));
reset role;
-- 짝마다 id가 큰 배송 건을 먼저 발송한 것으로 둔다: 자동 처리 후보 순서(발송 순)가 운영자 잠금 순서(id 순)와 반대다.
update public.order_shipments set shipped_at=now()-interval '2 days'+case when (right(id::text,12)::integer)%2=1 then interval '1 hour' else interval '0' end
 where id::text like 'f13c0000-0000-4002-8000-%';
update private.delivery_tracking_settings set auto_delivery_enabled=true,provider='fake',enabled_at=now() where singleton;
commit;
"""
sql(fixture)
dispatched = sql("select count(*) from public.order_shipments where id::text like 'f13c0000-0000-4002-8000-%' and status='shipping';")
assert dispatched == str(PAIRS * 2), dispatched

# 1) 운영자가 주문 1을 잡은 채 일괄 배송완료(1, 2)로 가는 사이에 자동 처리가 돈다(예전 교착 순서: 자동 처리는 발송 순으로 2 → 1).
#    자동 처리는 기다리지 않고 1을 넘기고 2만 바꾼 뒤 끝나고, 운영자는 1을 바꾸고 2는 이미 배송완료로 본다. 자동 처리가 잠금을
#    기다리는 구현이면 2를 쥔 채 1을 기다리다가 2초 뒤 2를 요청하는 운영자와 교착하거나 시간 한도에 걸린다.
sql(delivered_events(1, 2))
name = f'{prefix}-operator-first'
holder = session(f'{name}-operator', f"begin;select id from public.orders where id='{order(1)}' for update;select pg_sleep(2);{operator_complete(1, 2)}commit;")
wait_state(f'{name}-operator', 'Timeout', holder)
started = time.monotonic()
service_out = finish(session(f'{name}-run', f'begin;{SERVICE_RUN}commit;'), 'run while operator holds an order')
elapsed = time.monotonic() - started
assert holder.poll() is None, 'the run must finish while the operator still holds its lock'
assert elapsed < 1.8, f'the run waited for a lock ({elapsed:.2f}s)'
run = last_json(service_out)
assert [entry['shipmentId'] for entry in run['completed']] == [shipment(2)] and run['skipped'] == 1 and run['held'] == [], run
operator_results = {entry['id']: entry for entry in last_json(finish(holder, 'operator after the run'))}
# 운영자 배송완료는 이미 배송완료인 건을 그대로 두고 성공으로 돌려준다(전이·시각 불변).
assert all(entry['ok'] for entry in operator_results.values()), operator_results
assert delivered_once(1) == 'delivered:manual:-' and delivered_once(2) == 'delivered:auto:true', (delivered_once(1), delivered_once(2))
print(f'PASS operator-first: run skipped the held pack without waiting ({elapsed:.2f}s), operator finished without deadlock')

# 2) 자동 처리가 주문 3·4를 잡고 있는 동안 운영자 일괄 배송완료(3, 4)는 잠금을 기다렸다가 이미 배송완료로 본다.
sql(delivered_events(3, 4))
name = f'{prefix}-run-first'
runner = session(f'{name}-run', f'begin;{SERVICE_RUN}select pg_sleep(1.5);commit;')
wait_state(f'{name}-run', 'Timeout', runner)
waiter = session(f'{name}-operator', f'begin;{operator_complete(3, 4)}commit;')
wait_state(f'{name}-operator', 'Lock', waiter)
run = last_json(finish(runner, 'run holding the locks'))
assert sorted(entry['shipmentId'] for entry in run['completed']) == [shipment(3), shipment(4)] and run['skipped'] == 0, run
operator_results = last_json(finish(waiter, 'operator waiting for the run'))
assert all(entry['ok'] for entry in operator_results), operator_results
assert delivered_once(3) == 'delivered:auto:true' and delivered_once(4) == 'delivered:auto:true', (delivered_once(3), delivered_once(4))
print('PASS run-first: operator waited for the run (real lock wait) and finished without deadlock')

# 3) 같은 순간에 함께 시작해도(예전 재현 순서) 교착 없이 배송 건마다 한쪽만 바꾼다.
for pair in range(3, PAIRS + 1):
    first, second = pair * 2 - 1, pair * 2
    sql(delivered_events(first, second))
    name = f'{prefix}-together-{pair}'
    runner = session(f'{name}-run', f'begin;{SERVICE_RUN}commit;')
    waiter = session(f'{name}-operator', f'begin;{operator_complete(first, second)}commit;')
    run = last_json(finish(runner, f'run together {pair}'))
    operator_results = last_json(finish(waiter, f'operator together {pair}'))
    assert all(entry['ok'] for entry in operator_results), operator_results
    states = [delivered_once(n) for n in (first, second)]
    assert all(state in ('delivered:auto:true', 'delivered:manual:-') for state in states), (states, run, operator_results)
    assert sum(state == 'delivered:auto:true' for state in states) == len(run['completed']), (states, run)
print(f'PASS together: {PAIRS - 2} simultaneous pairs finished without deadlock, each shipment changed once')
print('PASS final readback: every shipment delivered exactly once')

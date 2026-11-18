"""Race two registrations of the same tracking number (SHP-030).

The registration judgment (`private.assert_tracking_registrable`) takes a transaction advisory lock on the carrier + number
before it looks for other orders' uses, and batch imports lock every number of the file in key order after their order locks.
A second session that registers the same number for another customer waits for the first commit and is then rejected,
and two reply files whose numbers cross never deadlock.
"""
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_tracking_integrity_concurrency_'):
    raise SystemExit('Use the disposable tracking integrity concurrency wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'tracking-integrity-{os.getpid()}'
operator = 'f13d0000-0000-4000-8000-000000000001'
buyer = 'f13d0000-0000-4000-8000-000000000002'
SHIPMENTS = 6


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def shipment(n):
    return f'f13d0000-0000-4002-8000-{n:012d}'


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
    if 'deadlock' in err:
        raise RuntimeError(f'{label}: {err}')
    return process.returncode, out, err


def state(n):
    return sql(f"select status||':'||coalesce(tracking_number,'-') from public.order_shipments where id='{shipment(n)}';")


ACTOR = f"set local role authenticated;select set_config('request.jwt.claim.sub','{operator}',true);"

# 배송 건 n은 주문 n 하나이고, 받는 분이 모두 달라 같은 번호를 함께 쓸 수 없다(합배송·합포장 아님).
fixture = f"""
begin;
update private.operator_access_state set configured=false,revision=1 where id;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('{operator}','authenticated','authenticated','tracking-integrity-race-operator@example.test',now(),'{{}}','{{}}',now(),now()),
 ('{buyer}','authenticated','authenticated','tracking-integrity-race-buyer@example.test',now(),'{{}}','{{}}',now(),now());
update public.profiles set nickname='TEST 운송장 경합 '||right(id::text,1),birth_date='1990-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true}}',
 role=case when id='{operator}' then 'staff'::public.user_role else 'user'::public.user_role end where id in('{operator}','{buyer}');
insert into private.operator_memberships(profile_id,manager_role) values('{operator}','primary');
insert into public.ips(id,title,vertical_key) values('tracking-integrity-race-ip','TEST 운송장 경합 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('tracking-integrity-race-good','tracking-integrity-race-ip','TEST 운송장 경합 상품','문구',1000,'ok',100);
insert into public.orders(id,user_id,status,total,shipping_fee,address,confirmed_at)
select ('f13d0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'{buyer}','confirmed'::public.order_status,4000,3000,
 jsonb_build_object('recipientName','TEST 수령인'||n,'phone','0107777000'||n,'postalCode','00123','address1','합성 주소','address2',n||'층','deliveryNote',''),now()-interval '3 days'
from generate_series(1,{SHIPMENTS}) n;
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot)
select ('f13d0000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,('f13d0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,'tracking-integrity-race-good',v.id,1,1000,
 'TEST 운송장 경합 상품','문구','tracking-integrity-race-ip'
from generate_series(1,{SHIPMENTS}) n cross join (select id from public.goods_variants where good_id='tracking-integrity-race-good' and is_default) v;
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,exported_at)
select ('f13d0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,('f13d0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,
 '00000000-0000-4000-8000-000000042201'::uuid,'김포',3000,'{{}}',now()-interval '2 days'
from generate_series(1,{SHIPMENTS}) n;
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty)
select ('f13d0000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid,('f13d0000-0000-4002-8000-'||lpad(n::text,12,'0'))::uuid,
 ('f13d0000-0000-4003-8000-'||lpad(n::text,12,'0'))::uuid,1 from generate_series(1,{SHIPMENTS}) n;
commit;
"""
sql(fixture)


def dispatch(n, tracking):
    return f"select public.admin_update_shipment_status('{shipment(n)}','shipping','hanjin','{tracking}');"


def batch(rows):
    payload = json.dumps([{'line': line, 'reference': shipment(n), 'carrier': 'hanjin', 'trackingNumber': tracking} for line, (n, tracking) in enumerate(rows, 1)])
    return f"select public.admin_import_shipment_tracking_batch('{payload}'::jsonb);"


# 1) 수동 입력 두 건이 같은 번호를 다른 고객 배송 건에 동시에 등록한다. 뒤 세션은 번호 잠금을 실제로 기다렸다가 앞의 커밋을 보고 거절된다.
name = f'{prefix}-manual'
first = session(f'{name}-first', f"begin;{ACTOR}{dispatch(1, '300000000001')}select pg_sleep(1);commit;")
wait_state(f'{name}-first', 'Timeout', first)
second = session(f'{name}-second', f"begin;{ACTOR}{dispatch(2, '300000000001')}commit;")
wait_state(f'{name}-second', 'Lock', second)
waiting = sql(f"select l.locktype from pg_locks l join pg_stat_activity a on a.pid=l.pid where a.application_name='{name}-second' and not l.granted;")
assert waiting == 'advisory', waiting
code, _, _ = finish(first, 'first manual registration')
assert code == 0
code, _, err = finish(second, 'second manual registration')
assert code != 0 and 'tracking_number_in_use' in err, err
assert state(1) == 'shipping:300000000001' and state(2) == 'ready:-', (state(1), state(2))
print('PASS manual-race: the second session waited on the number lock and was rejected after the first commit')

# 2) 두 회신 파일이 번호를 엇갈려 담는다(파일 A: 3→X, 4→Y / 파일 B: 5→Y, 6→X). 번호를 열쇠 순서로 미리 잠그므로 교착 없이
#    뒤 파일의 두 줄만 실패한다.
name = f'{prefix}-batch'
file_a = session(f'{name}-a', f"begin;{ACTOR}{batch([(3, '400000000001'), (4, '400000000002')])}select pg_sleep(1);commit;")
wait_state(f'{name}-a', 'Timeout', file_a)
file_b = session(f'{name}-b', f"begin;{ACTOR}{batch([(5, '400000000002'), (6, '400000000001')])}commit;")
wait_state(f'{name}-b', 'Lock', file_b)
code, _, err = finish(file_a, 'file A')
assert code == 0, err
code, out, err = finish(file_b, 'file B')
assert code == 0, err
rows = json.loads([line for line in out.splitlines() if line.startswith('[')][-1])
assert [row.get('error') for row in rows] == ['tracking_number_in_use', 'tracking_number_in_use'], rows
assert [state(n) for n in (3, 4, 5, 6)] == ['shipping:400000000001', 'shipping:400000000002', 'ready:-', 'ready:-'], [state(n) for n in (3, 4, 5, 6)]
print('PASS crossed-files: the later file waited, failed only its two rows, and nothing deadlocked')

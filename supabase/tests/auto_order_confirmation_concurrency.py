"""Race the automatic order confirmation run against customer cancellation and manual confirmation."""
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_auto_order_confirm_concurrency_'):
    raise SystemExit('Use the disposable auto order confirmation wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'auto-order-confirm-{os.getpid()}'
operator = 'a0c10000-0000-4000-8000-000000000001'
buyer = 'a0c10000-0000-4000-8000-000000000002'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def order(n):
    return f'a0c10000-0000-4001-8000-{n:012d}'


def run(now):
    return f"select private.run_auto_order_confirmation('{now}')->>'status';"


def customer_cancel(n):
    return f"set local role service_role;select public.request_order_claim('{order(n)}','{buyer}','cancel','동시성 검수 변심 취소','change_of_mind');reset role;"


def manual_confirm(n):
    return (f"select set_config('request.jwt.claim.sub','{operator}',true);set local role authenticated;"
            f"select public.admin_update_order_status('{order(n)}','confirmed',null,null);reset role;")


def wait_state(name, expected, process):
    for _ in range(100):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def session(name, body):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{name}';{body}")
    process.stdin.close()
    process.stdin = None
    return process


def race(label, first, second, hold=1.5):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep({hold});commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: real lock wait observed')
    return first_out[0], second_out[0]


fixture = f"""
begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('{operator}','authenticated','authenticated','auto-confirm-race-operator@example.test',now(),'{{}}','{{}}',now(),now()),
 ('{buyer}','authenticated','authenticated','auto-confirm-race-buyer@example.test',now(),'{{}}','{{}}',now(),now());
update public.profiles set nickname='TEST 자동 발주확인 경합 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true}}',
 role=case when id='{operator}' then 'admin'::public.user_role else 'user'::public.user_role end where id in('{operator}','{buyer}');
insert into private.operator_memberships(profile_id,manager_role) values('{operator}','owner');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('auto-confirm-race-ip','TEST 경합 IP','character');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty) values('auto-confirm-race-goods','auto-confirm-race-ip','TEST 경합 굿즈','문구',10000,'ok',100);
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('a0c10000-0000-4000-8000-0000000000f1','auto-confirm-race-origin','TEST 경합 창고',0,'합성 반송 주소');
update private.auto_order_confirmation_settings set enabled=true,run_time='16:30',enabled_at='2031-03-13 10:00:00+09',revision=revision+1 where singleton;
do $seed$
declare item uuid;sid uuid;oid uuid;paid timestamptz;n integer;
begin
 for n,paid in select * from (values (1,'2031-03-14 10:00:00+09'::timestamptz),(2,'2031-03-14 17:00:00+09'),(3,'2031-03-15 17:00:00+09'),
   (4,'2031-03-16 17:00:00+09'),(5,'2031-03-16 17:01:00+09'),(6,'2031-03-17 19:00:00+09'),(7,'2031-03-17 18:00:00+09')) v loop
  oid:=('a0c10000-0000-4001-8000-'||lpad(n::text,12,'0'))::uuid;sid:=gen_random_uuid();
  insert into public.orders(id,user_id,status,total,address) values(oid,'{buyer}','paid',10000,
   '{{"recipientName":"TEST 수령인","phone":"01000000000","postalCode":"12345","address1":"합성 주소"}}');
  insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)
   values(oid,'auto-confirm-race-goods',1,10000,'TEST 경합 굿즈','문구','auto-confirm-race-ip',
    (select id from public.goods_variants where good_id='auto-confirm-race-goods' and is_default)) returning id into item;
  insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot)
   values(sid,oid,'a0c10000-0000-4000-8000-0000000000f1','TEST 경합 창고',0,'{{}}');
  insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values(oid,sid,item,1);
  insert into public.payments(user_id,purpose,ref_id,provider,amount,status,payment_key,idempotency_key)
   values('{buyer}','order',oid,'toss',10000,'paid','pk-auto-confirm-race-'||n,'idem-auto-confirm-race-'||n);
  insert into private.order_paid_marks(order_id,paid_at) values(oid,paid);
 end loop;
end $seed$;
commit;
"""
sql(fixture)

# 1) 고객 취소가 주문 잠금을 먼저 잡으면 자동 실행은 기다렸다가 제외한다.
_, auto_after_cancel = race('cancel-before-auto', customer_cancel(1), run('2031-03-14 16:31:00+09'))
assert 'finished' in auto_after_cancel, auto_after_cancel
assert sql(f"select status from public.orders where id='{order(1)}';") == 'paid'
assert sql(f"select outcome from private.auto_order_confirmation_outcomes where run_date='2031-03-14' and order_id='{order(1)}';") == 'cancellation_in_progress'
assert sql(f"select count(*) from public.order_cancellation_claims where order_id='{order(1)}';") == '1'

# 2) 자동 실행이 먼저 잡으면 고객 직접 취소는 기다렸다가 닫힌다.
_, cancel_after_auto = race('auto-before-cancel', run('2031-03-15 16:31:00+09'), customer_cancel(2))
assert 'not_cancelable' in cancel_after_auto, cancel_after_auto
assert sql(f"select status from public.orders where id='{order(2)}';") == 'confirmed'
assert sql(f"select count(*) from public.order_cancellation_requests where order_id='{order(2)}';") == '0'

# 3) 수동 발주확인과 겹치면 한 번만 전이하고 자동 실행은 상태 변경으로 기록한다.
_, auto_after_manual = race('manual-before-auto', manual_confirm(3), run('2031-03-16 16:31:00+09'))
assert 'finished' in auto_after_manual, auto_after_manual
assert sql(f"select outcome from private.auto_order_confirmation_outcomes where run_date='2031-03-16' and order_id='{order(3)}';") == 'status_changed'
assert sql(f"select count(*)||':'||count(*) filter(where actor_id='{operator}') from public.audit_log where target='order:{order(3)}' and action='admin.order.status_updated';") == '1:1'

# 4) 다른 처리가 주문을 잠금 대기 한도(3초)보다 오래 쥐면 그 주문만 locked로 남고 나머지는 커밋된다.
_, auto_while_locked = race('locked-order-skipped', f"select id from public.orders where id='{order(4)}' for update;", run('2031-03-17 16:31:00+09'), hold=4.5)
assert 'finished' in auto_while_locked, auto_while_locked
assert sql(f"select outcome||':'||coalesce(detail,'') from private.auto_order_confirmation_outcomes where run_date='2031-03-17' and order_id='{order(4)}';") == 'locked:55P03'
assert sql(f"select status from public.orders where id='{order(4)}';") == 'paid'
assert sql(f"select status from public.orders where id='{order(5)}';") == 'confirmed'
assert sql("select (finished_at is not null)::text||':'||confirmed_count||':'||excluded_count from private.auto_order_confirmation_runs where run_date='2031-03-17';") == 'true:1:2'

# 5) 배송 건을 쥔 트랜잭션 + 주문 id 순으로 여러 주문을 잠그는 트랜잭션과 겹쳐도 교착 없이 끝난다.
#    (결제는 Y가 먼저지만 자동 실행도 주문 id 순 X → Y로 잠근다.)
name = f'{prefix}-pack-order'
holder = session(f'{name}-shipments', f"begin;select 1 from public.order_shipments where order_id='{order(7)}' for update;select pg_sleep(2.5);commit;")
wait_state(f'{name}-shipments', 'Timeout', holder)
runner = session(f'{name}-run', f"begin;{run('2031-03-18 16:31:00+09')}commit;")
wait_state(f'{name}-run', 'Lock', runner)
multi = session(f'{name}-multi', f"begin;select id from public.orders where id in ('{order(6)}','{order(7)}') order by id for update;select pg_sleep(0.5);commit;")
wait_state(f'{name}-multi', 'Lock', multi)
outputs = [process.communicate(timeout=20) for process in (holder, runner, multi)]
for process, (out, err) in zip((holder, runner, multi), outputs):
    if process.returncode:
        raise RuntimeError(err)
assert 'finished' in outputs[1][0], outputs[1]
assert sql(f"select string_agg(status::text,',' order by id) from public.orders where id in ('{order(6)}','{order(7)}');") == 'confirmed,confirmed'
print('PASS id-ordered-locks: shipment holder and multi-order locker finished without deadlock')
print('PASS final readback: each order took exactly one side of every race')

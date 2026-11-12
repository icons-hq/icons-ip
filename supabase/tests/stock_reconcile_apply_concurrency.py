"""재고 대조 반영과 같은 옵션의 고객 주문 재고 차감이 겹칠 때(QA1 S-T07-01).

1) 주문이 먼저 상품·옵션 행을 잠그면 반영은 기다렸다가 그 주문을 본다. 맞춘 뒤 재고수량이 미리보기(7)와 달라져(6)
   반영 전체를 거절하고 바뀐 옵션을 돌려준다. 재고는 주문만 반영된 값(9)이다.
2) 반영이 먼저 잠그면 주문은 기다렸다가 반영된 재고에서 뺀다. 반영은 확인한 값(9 → 6)으로 끝나고 결과·감사는 반영 시점 값이다.
"""
import json
import os
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_stock_reconcile_race_'):
    raise SystemExit('Use the disposable stock reconcile race wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'stock-reconcile-race-{os.getpid()}'
operator = '5a0d0000-0000-4000-8000-000000000001'
buyer = '5a0d0000-0000-4000-8000-000000000002'
good = 'stock-race-goods'
variant = f"(select id from public.goods_variants where good_id='{good}' and is_default)"


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def last_json(output):
    lines = [line for line in output.splitlines() if line.startswith('{')]
    if not lines:
        raise RuntimeError(f'no JSON result: {output}')
    return json.loads(lines[-1])


def as_operator(body):
    claims = json.dumps({'sub': operator, 'role': 'authenticated'})
    return (f"select set_config('request.jwt.claim.sub','{operator}',true);select set_config('request.jwt.claims','{claims}',true);"
            f"set local role authenticated;{body}reset role;")


def preview(label, qty):
    code = sql(f"select code from public.goods_variants where good_id='{good}' and is_default;")
    rows = json.dumps([{'row': 1, 'optionCode': code, 'qty': qty}])
    return last_json(sql(f"begin;{as_operator(f'select public.admin_preview_stock_reconcile(null,now(),{label!r},{rows!r}::jsonb);')}commit;"))


def apply(snapshot, expected, reason):
    return f"select public.admin_apply_stock_reconcile('{snapshot}',{expected},'{reason}');"


def place_order(n):
    """고객 주문의 재고 차감: 상품 → 옵션 행을 잠그고 재고를 1 빼고 결제 주문 품목을 남긴다(출고 대기 1)."""
    order_id = f'5a0d0000-0000-4001-8000-{n:012d}'
    address = json.dumps({'recipientName': 'TEST 수령인', 'phone': '01000000000', 'postalCode': '12345', 'address1': '합성 주소'}, ensure_ascii=False)
    return (f"select private.change_goods_variant_stock('{good}',{variant},-1);"
            f"insert into public.orders(id,user_id,status,total,address) values('{order_id}','{buyer}','paid',10000,'{address}');"
            f"insert into public.order_items(order_id,good_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot,variant_id)"
            f" values('{order_id}','{good}',1,10000,'TEST 재고대조 경합 굿즈','문구','stock-race-ip',{variant});")


def stock():
    return int(sql(f"select stock_qty from public.goods_variants where id={variant};"))


def wait_state(name, expected, process):
    for _ in range(200):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, hold=1.5):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep({hold});commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=20), two.communicate(timeout=20)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: real lock wait observed')
    return first_out[0], second_out[0]


sql(f"""
begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('{operator}','authenticated','authenticated','stock-race-operator@example.test',now(),'{{}}','{{}}',now(),now()),
 ('{buyer}','authenticated','authenticated','stock-race-buyer@example.test',now(),'{{}}','{{}}',now(),now());
update public.profiles set nickname='TEST 재고대조 경합 '||right(id::text,1),birth_date='2000-01-01',onboarded_at=now(),consents='{{"terms":true,"privacy":true}}',
 role=case when id='{operator}' then 'admin'::public.user_role else 'user'::public.user_role end where id in('{operator}','{buyer}');
-- 설정 완료 모드에는 통합 매니저가 있어야 한다(커밋 때 확인). 반영 권한(catalog.manage)도 통합 매니저에게 있다.
insert into private.operator_memberships(profile_id,manager_role) values('{operator}','owner');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('stock-race-ip','TEST 재고대조 경합 IP','character');
insert into public.fulfillment_origins(id,code,name,base_fee,return_address)
 values('5a0d0000-0000-4000-8000-0000000000a1','stock-race-a','TEST 재고대조 경합 창고',0,'합성 반송 주소');
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id)
 values('{good}','stock-race-ip','TEST 재고대조 경합 굿즈','문구',10000,'ok',10,'5a0d0000-0000-4000-8000-0000000000a1');
commit;
""")
assert stock() == 10

# 1) 미리보기 '10 → 맞춘 뒤 7'을 띄운 사이 주문이 먼저 잠근다. 반영은 기다렸다가 그 주문을 보고 거절한다.
first = preview('TEST 경합 파일 1', 7)
assert first['changedCount'] == 1 and first['items'][0]['targetQty'] == 7, first
_, rejected = race('order-before-apply', place_order(1), as_operator(apply(first['id'], 1, 'TEST 경합 반영 1')))
outcome = last_json(rejected)
assert outcome['status'] == 'conflict', outcome
conflict = outcome['conflicts'][0]
assert (conflict['reason'], conflict['previewTargetQty'], conflict['currentTargetQty'], conflict['previewStockQty'], conflict['currentStockQty'],
        conflict['previewPendingQty'], conflict['currentPendingQty']) == ('pending_changed', 7, 6, 10, 9, 0, 1), conflict
assert stock() == 9
assert sql(f"select (applied_at is null)::text from private.stock_reconcile_snapshots where id='{first['id']}';") == 'true'
assert sql(f"select count(*) from public.audit_log where action='admin.good.stock_reconciled' and diff->>'snapshotId'='{first['id']}';") == '0'

# 2) 다시 미리보기('9 → 6', 출고 대기 1)를 반영하는 쪽이 먼저 잠근다. 주문은 기다렸다가 반영된 6에서 뺀다.
second = preview('TEST 경합 파일 2', 7)
assert second['changedCount'] == 1 and (second['items'][0]['stockQty'], second['items'][0]['pendingQty'], second['items'][0]['targetQty']) == (9, 1, 6), second
applied, _ = race('apply-before-order', as_operator(apply(second['id'], 1, 'TEST 경합 반영 2')), place_order(2))
outcome = last_json(applied)
assert outcome['status'] == 'applied' and not outcome['replayed'], outcome
item = outcome['snapshot']['items'][0]
assert (item['stockBefore'], item['appliedPendingQty'], item['stockAfter'], item['appliedDelta']) == (9, 1, 6, -3), item
assert stock() == 5
assert sql(f"select diff->>'from'||':'||(diff->>'to')||':'||(diff->>'pendingQty') from public.audit_log"
           f" where action='admin.good.stock_reconciled' and diff->>'snapshotId'='{second['id']}';") == '9:6:1'
assert sql("select count(*) from public.orders where id in('5a0d0000-0000-4001-8000-000000000001','5a0d0000-0000-4001-8000-000000000002');") == '2'

# 반영과 주문이 모두 끝난 뒤 같은 파일을 다시 대조하면 차이가 없다(재고 5 + 출고 대기 2 = 파일 7).
third = preview('TEST 경합 파일 3', 7)
assert third['changedCount'] == 0 and third['items'][0]['difference'] == 0 and third['items'][0]['pendingQty'] == 2, third
print('PASS final readback: rejected apply changed nothing, accepted apply kept the confirmed value and the waiting order took one more')

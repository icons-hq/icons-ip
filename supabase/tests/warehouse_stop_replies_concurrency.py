"""Warehouse stop replies and canceled-after-export discoveries (ADR-0046) under real lock waits.

취소 시작과 창고 회신 기록, 같은 주문의 두 번 누른 취소, 발견 반입끼리·발견 반입과 처리, 처리끼리가 같은 주문 잠금에 줄을 서서
재고가 정확히 한 번만 움직이는지 본다.
"""
import hashlib
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_warehouse_stop_concurrency_'):
    raise SystemExit('Use the disposable warehouse stop wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'warehouse-stop-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'warehouse-stop:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return ("select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','%s')::text, true);"
            "select set_config('request.jwt.claim.sub', '%s', true);set local role authenticated;") % (uid('user', number), uid('user', number))


def reply(order, outcome, operation):
    return actor() + (f"select public.admin_record_warehouse_stop_reply(array['{uid('shipment-' + str(order), 1)}']::uuid[],'{outcome}','phone',"
                      f"clock_timestamp(),'합성 창고 통화','{uid('reply-op', operation)}');")


def start(order):
    return actor() + f"select public.admin_start_order_cancellation('{uid('order', order)}','out_of_stock',null,true);"


def complete(order):
    request = sql(f"select id from public.order_cancellation_requests where order_id='{uid('order', order)}' and origin='staff';")
    sql(f"begin;set local role service_role;select public.complete_order_cancellation_request('{request}',array['pk-wsr-{order}'],'{uid('user', 1)}');commit;")


def import_tracking(order, tracking):
    return actor() + f"select public.admin_import_shipment_tracking('{uid('shipment-' + str(order), 1)}','hanjin','{tracking}');"


def resolve(order, outcome, operation):
    dispatch = sql(f"select id from private.canceled_shipment_dispatches where shipment_id='{uid('shipment-' + str(order), 1)}';")
    return actor() + (f"select public.admin_resolve_canceled_shipment_dispatch('{dispatch}','{outcome}','합성 처리 기록 메모',"
                      f"'{uid('resolve-op', operation)}');")


def stock(order):
    return int(sql(f"select stock_qty from public.goods_variants where good_id='wsr-goods-{order}' and is_default;"))


def wait_state(name, expected, process):
    for _ in range(120):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"load 'safeupdate';set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close(); one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"load 'safeupdate';set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close(); two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: actual lock wait; ' + ('rejected safely' if expected_error else 'committed'), flush=True)
    return second_out[0]


fixture = Path(__file__).with_name('warehouse_stop_replies.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.wsr_id'):fixture.index('-- END FIXTURE')]
sql('begin;create schema wsr_test;grant usage on schema wsr_test to authenticated, service_role;' + fixture.replace('pg_temp.', 'wsr_test.') + 'commit;')

# 1. 회신 기록이 먼저 잠금을 잡으면 취소 시작은 기다린 뒤 그 '이미 출고' 회신을 보고 거절된다.
race('reply-before-start', reply(1, 'already_shipped', 1), start(1), 'warehouse_already_shipped')
assert sql(f"select count(*) from public.order_cancellation_requests where order_id='{uid('order', 1)}';") == '0'

# 2. 같은 주문을 두 번 누르면 두 번째는 기다린 뒤 진행 중 요청으로 거절된다(회신을 두 번 쓰지 않는다).
sql('begin;' + reply(5, 'stopped', 2) + 'commit;')
race('same-order-twice', start(5), start(5), 'order_claim_in_progress')
assert sql(f"select count(*) from private.warehouse_stop_replies where operation_id='{uid('reply-op', 2)}' and used_kind='staff_cancellation';") == '1'
complete(5)
assert stock(5) == 11

# 3. 같은 운송장 회신을 두 화면에서 동시에 올리면 두 번째는 기다린 뒤 첫 발견을 돌려받는다(재고는 한 번만 뺀다).
replayed = race('discovery-twice', import_tracking(5, '4200000005'), import_tracking(5, '4200000005'))
if '"replayed": true' not in replayed:
    raise RuntimeError(f'Expected replay: {replayed}')
assert stock(5) == 10

# 4. 처리(회수 입고)가 먼저면 같은 운송장 재반입은 기다린 뒤 첫 발견을 돌려받고 재고를 다시 빼지 않는다.
replayed = race('resolve-before-import', resolve(5, 'returned', 1), import_tracking(5, '4200000005'))
if '"replayed": true' not in replayed:
    raise RuntimeError(f'Expected replay after resolution: {replayed}')
assert stock(5) == 11

# 5. 서로 다른 요청번호의 처리 두 건: 두 번째는 기다린 뒤 이미 처리됨으로 거절된다(재고는 한 번만 되돌린다).
sql('begin;' + reply(6, 'stopped', 3) + 'commit;')
sql('begin;' + start(6) + 'commit;')
complete(6)
sql('begin;' + import_tracking(6, '4200000006') + 'commit;')
assert stock(6) == 10
race('resolve-twice', resolve(6, 'returned', 2), resolve(6, 'lost', 3), 'canceled_dispatch_already_resolved')
assert stock(6) == 11
assert sql(f"select state from private.canceled_shipment_dispatches where shipment_id='{uid('shipment-6', 1)}';") == 'returned'
assert sql("select count(*) from public.audit_log where action='admin.shipment.canceled_dispatch_discovered';") == '2'
print('PASS 5 races: reply and staff start serialized, one reply per request, one discovery per shipment, one resolution per discovery', flush=True)

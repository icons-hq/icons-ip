"""Stock-out partial cancellation (ADR-0032) against a second start on the same order and warehouse export marking."""
import hashlib
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_partial_cancel_concurrency_'):
    raise SystemExit('Use the disposable partial cancellation wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'partial-cancel-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'partial-cancel:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return ("select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','%s','session_id','%s')::text, true);"
            "set local role authenticated;") % (uid('user', number), uid('session', number))


def start(order, operation, item='a', qty=1, expected=9500, warehouse='false'):
    items = f"""jsonb_build_array(jsonb_build_object('orderItemId','{uid('item-partial-cancel-' + item, order)}','qty',{qty}))"""
    return actor() + (f"select public.admin_start_order_partial_cancellation('{uid('order', order)}',{items},"
                      f"'합성 고객 결정 기록',null,{warehouse},{expected},'{uid('operation', operation)}',null);")


def mark_exported(order):
    shipment = uid('shipment-1', order)
    updated = sql(f"select to_json(updated_at)#>>'{{}}' from public.order_shipments where id='{shipment}';")
    return actor() + f"""select public.admin_mark_shipments_exported(jsonb_build_array(jsonb_build_object('id','{shipment}','updatedAt','{updated}')));"""


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


fixture = Path(__file__).with_name('order_partial_cancellation.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.pc_id'):fixture.index('-- END FIXTURE')]
sql('begin;create schema partial_test;grant usage on schema partial_test to authenticated;' + fixture.replace('pg_temp.', 'partial_test.') + 'commit;')
sql("update private.return_fee_deduction_settings set partial_cancel_enabled=true,partial_cancel_evidence='합성 동시성 시험',partial_cancel_enabled_at=clock_timestamp() where singleton;")

# 같은 주문에 두 번: 두 번째는 주문 잠금을 기다린 뒤 처리 중인 부분 취소를 보고 거절된다(결제사 잔액 기대값이 엇갈리지 않게).
race('same-order-twice', start(1, 101), start(1, 102, item='b', expected=10000), 'partial_cancel_in_progress')
# 같은 요청 번호 재전송(더블 클릭): 두 번째는 기다린 뒤 첫 결과를 돌려받고 새 원장을 만들지 않는다.
replayed = race('same-operation-twice', start(2, 103), start(2, 103))
if '"replayed": true' not in replayed:
    raise RuntimeError(f'Expected replay: {replayed}')
# 출고지시 전달이 먼저면 부분 취소는 창고 출고 중단 확인 없이 열리지 않는다.
race('export-before-partial', mark_exported(5), start(5, 104), 'warehouse_stop_confirmation_required')
# 부분 취소가 먼저면 결제사 확인이 끝날 때까지 출고지시 전달이 막힌다.
race('partial-before-export', start(6, 105), mark_exported(6), 'order cancellation in progress')

assert sql(f"select count(*) from private.order_partial_cancellations where order_id='{uid('order', 1)}';") == '1'
assert sql(f"select count(*) from private.order_partial_cancellations where order_id='{uid('order', 2)}';") == '1'
assert sql(f"select count(*) from private.order_partial_cancellations where order_id='{uid('order', 5)}';") == '0'
assert sql(f"select exported_at is null from public.order_shipments where id='{uid('shipment-1', 6)}';") == 't'
assert sql("select sum(stock_qty) from public.goods_variants where good_id like 'partial-cancel-%';") == '30'
print('PASS 4 races: one in-flight partial per order, replayed operation, export and partial serialized; stock unchanged before provider confirmation', flush=True)

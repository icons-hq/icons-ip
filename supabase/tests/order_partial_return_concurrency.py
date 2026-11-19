"""Partial return (ADR-0047) intake and refund filing against concurrent claims and stock-out partial cancellation on the same order."""
import hashlib
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_partial_return_concurrency_'):
    raise SystemExit('Use the disposable partial return wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'partial-return-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'partial-return:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return ("select set_config('request.jwt.claims', json_build_object('role','authenticated','sub','%s','session_id','%s')::text, true);"
            % (uid('user', number), uid('session', number)))


def partial(order, spec):
    return f"select partial_return_test.pr_request('{spec}@{order}');"


def whole_return(order):
    return f"select public.request_order_claim('{uid('order', order)}','{uid('user', 2)}','return','단순 변심 반품','change_of_mind');"


def stockout(order, operation):
    items = f"""jsonb_build_array(jsonb_build_object('orderItemId','{uid('item-partial-return-c', order)}','qty',1))"""
    return actor() + ("set local role authenticated;"
                      f"select public.admin_start_order_partial_cancellation('{uid('order', order)}',{items},"
                      f"'합성 고객 결정 기록',null,false,8000,'{uid('operation', operation)}',null);")


def export_other(order):
    # 고른 품목이 없는 배송 건 2(발송 전)를 출고 파일로 내보냈다고 적는다. 판 버전은 문장 실행 때 읽는다.
    ship = uid('shipment-2', order)
    return actor() + ("set local role authenticated;"
                      f"select public.admin_mark_shipments_exported(jsonb_build_array(jsonb_build_object('id','{ship}',"
                      f"'updatedAt',(select updated_at from public.order_shipments where id='{ship}'))));")


def allocate_other(order):
    # 배송 건 2의 예약 판매 품목(C)에 입고 실물을 할당한다.
    return actor() + ("set local role authenticated;"
                      f"select public.admin_allocate_goods_preorders('partial-return-c',array['{uid('item-partial-return-c', order)}'::uuid],"
                      "jsonb_build_object((select id from public.goods_variants where good_id='partial-return-c' and is_default)::text,"
                      "(select stock_qty from public.goods_variants where good_id='partial-return-c' and is_default)),'합성 입고 확인');")


def filed(claim):
    return actor() + f"select public.admin_record_order_claim_refund('{claim}','pg_cancel','filed',null);"


def wait_state(name, expected, process):
    for _ in range(120):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None, expected_output=None):
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
    if expected_output and expected_output not in second_out[0]:
        raise RuntimeError(f'Expected output {expected_output}: {second_out}')
    print(f'PASS {label}: actual lock wait; ' + ('rejected safely' if expected_error else 'expected outcome' if expected_output else 'committed'), flush=True)
    return second_out[0]


fixture = Path(__file__).with_name('order_partial_return.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.pr_id'):fixture.index('-- END FIXTURE')]
sql('begin;create schema partial_return_test;grant usage on schema partial_return_test to authenticated;' + fixture.replace('pg_temp.', 'partial_return_test.') + 'commit;')
sql("select partial_return_test.pr_order(n, 'toss', 3000, true) from unnest(array[13, 14, 15, 16]) n;")
# 예약 정책에는 초안이 없다(2026-11-19). 옵션이 선택하지 않은(접수를 마친) 완전한 정책에 예약을 걸어 둔다.
sql(f"""insert into private.goods_preorder_policies(id, variant_id, state, capacity_qty, starts_at, ends_at, expected_ship_date,
    created_by, activated_by, activated_at, stopped_by, stopped_at)
  select '{uid('policy', 16)}', id, 'stopped', 10, now() - interval '2 days', now() - interval '1 day', current_date + 7,
    '{uid('user', 1)}', '{uid('user', 1)}', now() - interval '2 days', '{uid('user', 1)}', now() - interval '1 day'
  from public.goods_variants where good_id='partial-return-c' and is_default;
  insert into private.goods_preorder_reservations(order_item_id, order_id, policy_id, qty)
  values ('{uid('item-partial-return-c', 16)}', '{uid('order', 16)}', '{uid('policy', 16)}', 1);""")
sql("update private.return_fee_deduction_settings set partial_return_enabled=true,partial_return_evidence='합성 동시성 시험',partial_return_enabled_at=clock_timestamp(),"
    "partial_cancel_enabled=true,partial_cancel_evidence='합성 동시성 시험',partial_cancel_enabled_at=clock_timestamp() where singleton;")

# 같은 품목 동시 부분 반품: 두 번째는 주문 잠금을 기다린 뒤 진행 중 클레임을 보고 접수되지 않는다(클레임 품목은 하나뿐).
race('same-item-twice', partial(1, 'a:1'), partial(1, 'a:1'), expected_output='already_requested')
# 부분 반품 대 주문 전체 반품: 뒤의 것은 진행 중 클레임을 보고 접수되지 않는다.
race('partial-vs-whole-return', partial(2, 'a:1'), whole_return(2), expected_output='already_requested')
# 부분 반품 대 재고 부족 부분 취소(발송 전 배송 건이 남은 주문 8): 부분 반품이 먼저면 부분 취소는 진행 중 클레임으로 막힌다.
race('partial-return-then-stockout', partial(8, 'a:1'), stockout(8, 801), 'order_claim_in_progress')
# 재고 부족 부분 취소가 먼저(결제사 확인 대기)면 배송 중 반품 접수가 닫힌다(E: 처리 중 부분 취소는 반품·교환 접수를 막는다).
race('stockout-then-partial-return', stockout(13, 1301), partial(13, 'a:1'), expected_output='not_claimable')
# 진행 중 부분 반품은 고른 품목이 없는 배송 건의 출고·예약 할당을 막지 않는다(배송 건 단위 판정, 적대적 리뷰 2026-11-19).
race('return-then-export-other', partial(14, 'a:1'), export_other(14), expected_output='1')
race('export-other-then-return', export_other(15), partial(15, 'a:1'), expected_output='requested')
race('return-then-allocate-other', partial(16, 'a:1'), allocate_other(16), expected_output='"allocatedItems": 1')
# 같은 부분 반품의 환불 접수 두 번(더블 클릭): 두 번째는 기다린 뒤 이미 만든 원장을 보고 같은 결과다(원장 하나).
sql(f"begin;{actor()}select partial_return_test.pr_request('a:1@7');select partial_return_test.pr_collect((partial_return_test.pr_claim(7)).id);commit;")
claim7 = sql("select (partial_return_test.pr_claim(7)).id;")
race('refund-filed-twice', filed(claim7), filed(claim7), expected_output='filed')

assert sql(f"select count(*) from public.order_cancellation_requests where order_id='{uid('order', 1)}';") == '1'
assert sql(f"select count(*) from public.order_claim_items where order_id='{uid('order', 1)}';") == '1'
assert sql(f"select count(*) from public.order_cancellation_requests where order_id='{uid('order', 2)}';") == '1'
assert sql(f"select count(*) from public.order_claim_items where order_id='{uid('order', 2)}';") == '1'
assert sql(f"select count(*) from private.order_partial_cancellations where order_id='{uid('order', 8)}';") == '0'
assert sql(f"select count(*) from public.order_cancellation_requests where order_id='{uid('order', 13)}';") == '0'
assert sql(f"select count(*) from private.order_partial_cancellations where order_id='{uid('order', 13)}' and reason_code='out_of_stock';") == '1'
assert sql(f"select count(*) from private.order_partial_cancellations where claim_id='{claim7}';") == '1'
for order in (14, 15, 16):
    assert sql(f"select count(*) from public.order_claim_items where order_id='{uid('order', order)}';") == '1'
assert sql(f"select count(*) from public.order_shipments where id in ('{uid('shipment-2', 14)}','{uid('shipment-2', 15)}') and exported_at is not null;") == '2'
assert sql(f"select state from private.goods_preorder_reservations where order_item_id='{uid('item-partial-return-c', 16)}';") == 'allocated'
print('PASS 8 races: one active claim per order (same item, whole return, stock-out partial cancel), in-flight stock-out closes return intake, '
      'in-flight partial return leaves other shipments exportable and allocatable, one refund ledger per partial return', flush=True)

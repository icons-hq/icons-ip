"""Real separate-session lock waits for cart retention (ADR-0026) in a disposable goods clone.

새 장바구니 주문이 이전 미결제 주문을 닫는 동안 같은 계정의 다른 결제 finalize가 겹쳐도
finalize는 성공해야 한다. 잠금 순서는 계정 advisory → 주문 행 → account-action → profiles →
장바구니이고, claim·prepare·finalize(주문 → account-action → profiles)와 같은 방향이다.
"""
import json
import os
import re
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not re.fullmatch(r'[0-9a-f]{64}', container) or not re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}', database):
    raise SystemExit('Use goods_transaction_isolated.sh and its disposable database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'cart-retained-{os.getpid()}'
buyer = 'cc270000-0000-4000-8000-000000000002'
address = '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def start(label, statements):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{prefix}-{label}';begin;set local lock_timeout='15s';{statements}commit;")
    process.stdin.close()
    process.stdin = None
    return process


def wait_state(label, expected, process):
    for _ in range(300):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{prefix}-{label}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{label} exited before {expected}: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{label} never reached {expected}')


def finish(process, expected_error=None):
    output = process.communicate(timeout=30)
    if 'deadlock detected' in output[1]:
        raise RuntimeError(f'deadlock: {output}')
    if expected_error:
        if not process.returncode or expected_error not in output[1]:
            raise RuntimeError(f'Expected {expected_error}: {output}')
    elif process.returncode:
        raise RuntimeError(output[1])
    return output[0]


def cart():
    # 같음 비교(assert cart() == cart_before)는 원소 순서까지 본다 — 실행 계획(seq scan·인덱스 스캔)과 무관하게 정렬한다.
    return sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id,variant_id,input_key) from public.cart_items where user_id='{buyer}';")


def as_buyer(statement):
    return f"select set_config('request.jwt.claim.sub','{buyer}',true);set local role authenticated;{statement}reset role;"


def service(statement):
    return f'set local role service_role;{statement}reset role;'


def claimed_attempt(order_id, nonce, token):
    attempt = json.loads(sql('begin;' + service(f"select public.prepare_goods_payment_attempt('{buyer}','{order_id}','toss');") + 'commit;').splitlines()[-1])['id']
    provider_id = sql(f"select provider_order_id from public.payment_attempts where id='{attempt}';")
    sql('begin;' + service(f"select public.bind_goods_payment_callback_nonce('{attempt}',repeat('{nonce}',64));"
        + f"select public.claim_goods_payment_attempt('toss','{provider_id}',repeat('{nonce}',64),'{token}');") + 'commit;')
    return attempt


root = Path(__file__).parent
fixture = (root / 'cart_retained_until_payment.sql').read_text().split('-- ── 1.')[0]
fixture = fixture.replace('\\set ON_ERROR_STOP on', '').replace('begin;', '', 1).replace('pg_temp.', 'cart_retained_test.')
kc = (root / 'helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.', 'cart_retained_test.')
sql('begin;create schema cart_retained_test;grant usage on schema cart_retained_test to authenticated,service_role;' + kc + fixture
    + 'reset role;update private.goods_transaction_runtime set enabled=true where singleton;'
    # 운영자 설정 완료 상태에는 소유자 1명이 필요하다. 같은 clone의 앞선 경합 스모크가 이미 정했으면 그대로 둔다.
    + "update private.operator_memberships set manager_role='owner' where profile_id='cc270000-0000-4000-8000-000000000001'"
    + " and not exists(select 1 from private.operator_memberships where manager_role='owner');commit;")
variant = sql("select id from public.goods_variants where good_id='retained-a' and is_default;")

# 1. 거래 런타임: 새 주문(사용자 advisory → 이전 주문 행 대기)과 그 이전 주문 finalize(주문 행 →
#    account-action)가 겹친다. actor 잠금을 이전 주문 행보다 먼저 잡으면 교착한다.
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',2);") + 'commit;')
selection = cart()
quote = json.loads(sql('begin;' + service(f"select public.quote_cart_goods_transaction('{buyer}',{literal(selection)},{literal(address)},'{{}}',null,0);") + 'commit;').splitlines()[-1])
first = sql('begin;' + service(f"select public.place_cart_goods_transaction('{buyer}',{literal(selection)},{literal(address)},'{quote['quoteId']}','dd270000-0000-4000-8000-000000000001','card');") + 'commit;').splitlines()[-1]
attempt = claimed_attempt(first, '1', 'dd270000-0000-4000-8000-000000000101')
second_quote = json.loads(sql('begin;' + service(f"select public.quote_cart_goods_transaction('{buyer}',{literal(selection)},{literal(address)},'{{}}',null,0);") + 'commit;').splitlines()[-1])
finalizer = start('tx-finalize', f"select 1 from public.orders where id='{first}' for update;select pg_sleep(1.5);"
                  + service(f"select public.finalize_goods_payment_attempt('{attempt}','dd270000-0000-4000-8000-000000000101','approved',null,'TEST-RETAINED-CONC-1');"))
wait_state('tx-finalize', 'Timeout', finalizer)
placer = start('tx-place', service(f"select public.place_cart_goods_transaction('{buyer}',{literal(selection)},{literal(address)},'{second_quote['quoteId']}','dd270000-0000-4000-8000-000000000002','card');"))
wait_state('tx-place', 'Lock', placer)
assert 'approved' in finish(finalizer)
finish(placer, 'cart_snapshot_changed')
assert sql(f"select status from public.orders where id='{first}';") == 'paid'
assert sql(f"select state from private.cart_order_holds where order_id='{first}';") == 'consumed'
assert sql(f"select count(*) from public.orders where user_id='{buyer}' and checkout_key='dd270000-0000-4000-8000-000000000002';") == '0'
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}';") == '0'
print('PASS transaction new order waits on previous order row; previous finalize approved without deadlock; new order rejected by consumed cart', flush=True)

# 2. legacy: 새 주문이 보류 주문(O1)을 닫는 동안 같은 계정의 다른 주문(O2, 보류 없음) finalize가
#    account-action을 먼저 쥐었다. 닫기는 취소(profiles 잠금) 전에 account-action을 기다려야 한다.
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',1);") + 'commit;')
other = sql('begin;' + service(f"select public.place_order_with_store_credits('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000003','card',0);") + 'commit;').splitlines()[-1]
other_attempt = claimed_attempt(other, '2', 'dd270000-0000-4000-8000-000000000102')
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',2);") + 'commit;')
selection = cart()
held = sql('begin;' + service(f"select public.place_order_with_cart_snapshot('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000004','card',0,null,{literal(selection)});") + 'commit;').splitlines()[-1]
sql('begin;' + service(f"select public.prepare_goods_payment_attempt('{buyer}','{held}','toss');") + 'commit;')
finalizer = start('legacy-finalize', f"select private.lock_account_action_subject('{buyer}');select pg_sleep(1.5);"
                  + service(f"select public.finalize_goods_payment_attempt('{other_attempt}','dd270000-0000-4000-8000-000000000102','approved',null,'TEST-RETAINED-CONC-2');"))
wait_state('legacy-finalize', 'Timeout', finalizer)
placer = start('legacy-place', service(f"select public.place_order_with_cart_snapshot('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000005','card',0,null,{literal(selection)});"))
wait_state('legacy-place', 'Lock', placer)
assert 'approved' in finish(finalizer)
replacement = finish(placer).strip().splitlines()[-1]
assert sql(f"select status from public.orders where id='{other}';") == 'paid'
assert sql(f"select status from public.orders where id='{held}';") == 'canceled'
assert sql(f"select state||':'||release_reason from private.cart_order_holds where order_id='{held}';") == 'released:superseded'
assert sql(f"select status from public.orders where id='{replacement}';") == 'pending'
assert sql(f"select state from private.cart_order_holds where order_id='{replacement}';") == 'awaiting_payment'
print('PASS legacy supersede waits for account-action before cancel; other order finalize approved; replacement order created', flush=True)

# 3. 장바구니 복귀: 닫을 주문 finalize가 주문 행을 쥔 동안 release는 그 행을 기다리고, 결제 완료된
#    주문은 닫지 않는다.
attempt = claimed_attempt(replacement, '3', 'dd270000-0000-4000-8000-000000000103')
finalizer = start('release-finalize', f"select 1 from public.orders where id='{replacement}' for update;select pg_sleep(1.5);"
                  + service(f"select public.finalize_goods_payment_attempt('{attempt}','dd270000-0000-4000-8000-000000000103','approved',null,'TEST-RETAINED-CONC-3');"))
wait_state('release-finalize', 'Timeout', finalizer)
releaser = start('release', service(f"select public.release_unpaid_cart_orders('{buyer}');"))
wait_state('release', 'Lock', releaser)
assert 'approved' in finish(finalizer)
assert finish(releaser).strip().splitlines()[-1] == '0'
assert sql(f"select status from public.orders where id='{replacement}';") == 'paid'
print('PASS cart return waits on finalizing order row and never closes the approved order', flush=True)

# 4. 장바구니 변경 RPC는 'cart:'를 쥔 채 INSERT 계정 fence에서 account-action을 기다린다. 그 사이
#    finalize가 account-action을 쥐고 장바구니를 정리해도 교착하지 않아야 한다(정리는 행 잠금만 쓴다).
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',2);") + 'commit;')
selection = cart()
pending = sql('begin;' + service(f"select public.place_order_with_cart_snapshot('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000006','card',0,null,{literal(selection)});") + 'commit;').splitlines()[-1]
attempt = claimed_attempt(pending, '4', 'dd270000-0000-4000-8000-000000000104')
finalizer = start('cart-finalize', f"select private.lock_account_action_subject('{buyer}');select pg_sleep(1.5);"
                  + service(f"select public.finalize_goods_payment_attempt('{attempt}','dd270000-0000-4000-8000-000000000104','approved',null,'TEST-RETAINED-CONC-4');"))
wait_state('cart-finalize', 'Timeout', finalizer)
mutation = start('cart-mutation', as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',3);"))
wait_state('cart-mutation', 'Lock', mutation)
assert 'approved' in finish(finalizer)
finish(mutation)
assert sql(f"select status from public.orders where id='{pending}';") == 'paid'
assert sql(f"select consumption#>>'{{lines,0,outcome}}' from private.cart_order_holds where order_id='{pending}';") == 'removed'
assert sql(f"select qty from public.cart_items where user_id='{buyer}' and variant_id='{variant}';") == '3'
print('PASS cart mutation waiting on account-action does not deadlock with finalize cart cleanup', flush=True)

# 5. 주문 생성과 다른 탭의 장바구니 수량 변경. 장바구니 변경 RPC도 사용자 advisory → account-action →
#    profiles → 'cart:' 순서로 잠그므로(lock_goods_transaction_actor) 어느 쪽이 먼저 'cart:'를 쥐어도
#    다른 쪽은 그보다 앞의 잠금에서 기다리고 교착하지 않는다. 테스트 전용 트리거로 각 경로를 'cart:'를
#    쥔 지점에서 멈춘다.
sql("""create function private.test_cart_retained_cart_pause() returns trigger language plpgsql as $$begin
 if new.user_id='cc270000-0000-4000-8000-000000000002'::uuid then perform pg_advisory_xact_lock(2710051);end if;
 return new;end$$;
create function private.test_cart_retained_order_pause() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.orders where id=new.order_id and checkout_key='dd270000-0000-4000-8000-000000000008'::uuid) then
  perform pg_advisory_xact_lock(2710052);end if;
 return new;end$$;
create trigger aaa_test_cart_retained_pause before insert on public.cart_items for each row execute function private.test_cart_retained_cart_pause();
create trigger aaa_test_cart_retained_pause before insert on public.order_items for each row execute function private.test_cart_retained_order_pause();""")
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',0);") + 'commit;')
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',2);") + 'commit;')
selection = cart()
# 5a. 다른 탭의 수량 변경이 'cart:'를 쥔 채 멈춰 있는 동안 주문을 만든다.
holder = start('cart-hold-a', 'select pg_advisory_xact_lock(2710051);select pg_sleep(1.5);')
wait_state('cart-hold-a', 'Timeout', holder)
mutation = start('cart-change-a', as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',0);select public.set_cart_item_quantity('retained-a','{variant}',3);"))
wait_state('cart-change-a', 'Lock', mutation)
placer = start('order-a', service(f"select public.place_order_with_cart_snapshot('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000007','card',0,null,{literal(selection)});"))
wait_state('order-a', 'Lock', placer)
finish(holder)
finish(mutation)
finish(placer, 'cart_snapshot_changed')
assert sql(f"select qty from public.cart_items where user_id='{buyer}' and variant_id='{variant}';") == '3'
assert sql(f"select count(*) from public.orders where user_id='{buyer}' and checkout_key='dd270000-0000-4000-8000-000000000007';") == '0'
# 5b. 주문이 'cart:'와 장바구니 행을 쥔 채 품목을 쓰는 동안 다른 탭이 수량을 바꾼다.
selection = cart()
holder = start('cart-hold-b', 'select pg_advisory_xact_lock(2710052);select pg_sleep(1.5);')
wait_state('cart-hold-b', 'Timeout', holder)
placer = start('order-b', service(f"select public.place_order_with_cart_snapshot('{buyer}',{literal(address)},'dd270000-0000-4000-8000-000000000008','card',0,null,{literal(selection)});"))
wait_state('order-b', 'Lock', placer)
mutation = start('cart-change-b', as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',1);"))
wait_state('cart-change-b', 'Lock', mutation)
finish(holder)
created = finish(placer).strip().splitlines()[-1]
finish(mutation)
assert sql(f"select status from public.orders where id='{created}';") == 'pending'
assert sql(f"select (lines->0->>'qty') from private.cart_order_holds where order_id='{created}';") == '3'
assert sql(f"select qty from public.cart_items where user_id='{buyer}' and variant_id='{variant}';") == '1'
sql('drop trigger aaa_test_cart_retained_pause on public.cart_items;drop trigger aaa_test_cart_retained_pause on public.order_items;'
    'drop function private.test_cart_retained_cart_pause();drop function private.test_cart_retained_order_pause();')
print('PASS order creation and other-tab cart quantity change wait in lock order either way; no deadlock', flush=True)
# 6. 장바구니 선택 주문(ADR-0030): 고른 줄(A)로 주문이 품목을 쓰는 동안 다른 탭이 고르지 않은 줄(C)을 바꾼다.
#    다른 탭은 사용자 advisory에서 기다리고, 주문은 A만 담아 끝난다. 고르지 않은 C는 다른 탭 값으로 남는다.
variant_c = sql("select id from public.goods_variants where good_id='retained-c' and is_default;")
sql("""create function private.test_cart_selection_order_pause() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.orders where id=new.order_id and checkout_key in ('dd270000-0000-4000-8000-000000000009'::uuid,'dd270000-0000-4000-8000-000000000010'::uuid)) then
  perform pg_advisory_xact_lock(2710053);end if;
 return new;end$$;
create trigger aaa_test_cart_selection_pause before insert on public.order_items for each row execute function private.test_cart_selection_order_pause();""")
sql('begin;' + as_buyer(f"select public.set_cart_item_quantity('retained-a','{variant}',0);select public.set_cart_item_quantity('retained-a','{variant}',1);"
    f"select public.set_cart_item_quantity('retained-c','{variant_c}',1);") + 'commit;')
selected = sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id,variant_id,input_key) from public.cart_items where user_id='{buyer}' and good_id='retained-a';")
draft = sql('begin;' + service(f"select public.service_create_checkout_selection_draft('{buyer}',{literal(selected)});") + 'commit;').splitlines()[-1]
holder = start('selection-hold', 'select pg_advisory_xact_lock(2710053);select pg_sleep(1.5);')
wait_state('selection-hold', 'Timeout', holder)
placer = start('selection-order', service(f"select public.place_order_with_cart_selection('{buyer}','{draft}',{literal(address)},'dd270000-0000-4000-8000-000000000009','card',0,null);"))
wait_state('selection-order', 'Lock', placer)
mutation = start('selection-other-line', as_buyer(f"select public.set_cart_item_quantity('retained-c','{variant_c}',2);"))
wait_state('selection-other-line', 'Lock', mutation)
finish(holder)
selection_order = finish(placer).strip().splitlines()[-1]
finish(mutation)
assert sql(f"select string_agg(good_id,',' order by good_id) from public.order_items where order_id='{selection_order}';") == 'retained-a'
assert sql(f"select jsonb_array_length(lines)||':'||(lines->0->>'goodId') from private.cart_order_holds where order_id='{selection_order}';") == '1:retained-a'
assert sql(f"select qty from public.cart_items where user_id='{buyer}' and good_id='retained-c';") == '2'
print('PASS selection order holds only selected line while other tab changes an unselected line; no deadlock', flush=True)

# 7. 두 탭 바로구매(ADR-0030): 첫 바로구매가 품목을 쓰는 동안 둘째 바로구매는 사용자 advisory에서 기다렸다가 첫 주문을
#    닫고(출처 무관 supersede) 새 주문을 만든다. 장바구니는 두 주문 모두 건드리지 않는다.
cart_before = cart()
direct_lines = f"jsonb_build_array(jsonb_build_object('good_id','retained-a','variant_id','{variant}','qty',1))"
draft_1 = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
draft_2 = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
holder = start('direct-hold', 'select pg_advisory_xact_lock(2710053);select pg_sleep(1.5);')
wait_state('direct-hold', 'Timeout', holder)
first_tab = start('direct-first', service(f"select public.place_direct_order('{buyer}','{draft_1}',{literal(address)},'dd270000-0000-4000-8000-000000000010','card',0,null);"))
wait_state('direct-first', 'Lock', first_tab)
second_tab = start('direct-second', service(f"select public.place_direct_order('{buyer}','{draft_2}',{literal(address)},'dd270000-0000-4000-8000-000000000011','card',0,null);"))
wait_state('direct-second', 'Lock', second_tab)
finish(holder)
first_order = finish(first_tab).strip().splitlines()[-1]
second_order = finish(second_tab).strip().splitlines()[-1]
assert sql(f"select status from public.orders where id='{first_order}';") == 'canceled'
assert sql(f"select state||':'||release_reason from private.cart_order_holds where order_id='{first_order}';") == 'released:superseded'
assert sql(f"select status from public.orders where id='{second_order}';") == 'pending'
assert sql(f"select source from private.cart_order_holds where order_id='{second_order}';") == 'direct_checkout'
assert cart() == cart_before
sql('drop trigger aaa_test_cart_selection_pause on public.order_items;drop function private.test_cart_selection_order_pause();')
print('PASS two-tab direct orders serialize; second supersedes first; cart untouched; no deadlock', flush=True)

# 8·9. 두 탭이 같은 주문서(초안)를 새 checkout key로 무통장 동시 제출한다(완료 기준 5). 첫 탭이 품목을 쓰는 동안 둘째 탭은
#      사용자 advisory에서 기다렸다가, 첫 주문이 무통장으로 접수됐으므로 checkout_draft_used(원 주문 id)로 거절된다.
sql("""create function private.test_cart_draft_used_pause() returns trigger language plpgsql as $$begin
 if exists(select 1 from public.orders where id=new.order_id and checkout_key in ('dd270000-0000-4000-8000-000000000012'::uuid,'dd270000-0000-4000-8000-000000000014'::uuid)) then
  perform pg_advisory_xact_lock(2710054);end if;
 return new;end$$;
create trigger aaa_test_cart_draft_used_pause before insert on public.order_items for each row execute function private.test_cart_draft_used_pause();""")


def two_tab_bank(label, place_first, place_second, first_key, second_key):
    holder = start(f'{label}-hold', 'select pg_advisory_xact_lock(2710054);select pg_sleep(1.5);')
    wait_state(f'{label}-hold', 'Timeout', holder)
    first_tab = start(f'{label}-first', service(place_first))
    wait_state(f'{label}-first', 'Lock', first_tab)
    second_tab = start(f'{label}-second', service(place_second))
    wait_state(f'{label}-second', 'Lock', second_tab)
    finish(holder)
    placed = finish(first_tab).strip().splitlines()[-1]
    rejected = second_tab.communicate(timeout=30)
    if 'deadlock detected' in rejected[1] or not second_tab.returncode or 'checkout_draft_used' not in rejected[1] or placed not in rejected[1]:
        raise RuntimeError(f'Expected checkout_draft_used with the first order: {rejected}')
    assert sql(f"select count(*) from public.orders where user_id='{buyer}' and checkout_key in ('{first_key}','{second_key}');") == '1'
    assert sql(f"select status||':'||payment_method from public.orders where id='{placed}';") == 'pending:bank_transfer'
    return placed


cart_before = cart()
bank_draft = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
place = "select public.place_direct_order('{0}','{1}',{2},'{3}','bank_transfer',0,null);"
two_tab_bank('draft-direct', place.format(buyer, bank_draft, literal(address), 'dd270000-0000-4000-8000-000000000012'),
             place.format(buyer, bank_draft, literal(address), 'dd270000-0000-4000-8000-000000000013'),
             'dd270000-0000-4000-8000-000000000012', 'dd270000-0000-4000-8000-000000000013')
assert cart() == cart_before
print('PASS two tabs submit the same direct draft by bank transfer; one order; second rejected as used; cart untouched; no deadlock', flush=True)

selected_c = sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values) order by good_id,variant_id,input_key) from public.cart_items where user_id='{buyer}' and good_id='retained-c';")
selection_draft = sql('begin;' + service(f"select public.service_create_checkout_selection_draft('{buyer}',{literal(selected_c)});") + 'commit;').splitlines()[-1]
place = "select public.place_order_with_cart_selection('{0}','{1}',{2},'{3}','bank_transfer',0,null);"
selection_bank = two_tab_bank('draft-selection', place.format(buyer, selection_draft, literal(address), 'dd270000-0000-4000-8000-000000000014'),
                              place.format(buyer, selection_draft, literal(address), 'dd270000-0000-4000-8000-000000000015'),
                              'dd270000-0000-4000-8000-000000000014', 'dd270000-0000-4000-8000-000000000015')
assert sql(f"select string_agg(good_id||':'||qty,',' order by good_id) from public.order_items where order_id='{selection_bank}';") == 'retained-c:2'
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}' and good_id='retained-c';") == '0'
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}' and good_id='retained-a';") == '1'
sql('drop trigger aaa_test_cart_draft_used_pause on public.order_items;drop function private.test_cart_draft_used_pause();')
print('PASS two tabs submit the same selection draft by bank transfer; one order consumes selected line once; second rejected as used; no deadlock', flush=True)

# 10. 같은 주문서의 첫 카드 주문 결제 확정(finalize)이 진행 중일 때 같은 초안을 새 키로 다시 낸다. 재제출은 초안의 이전 주문
#     행에서 기다렸다가(사용자 advisory → 주문 → account-action, finalize와 같은 방향이라 교착 없음) 결제 완료를 보고
#     checkout_draft_used로 거절된다. 두 번째 주문은 없고 초안은 원 주문을 그대로 가리킨다.
cart_before = cart()
finalize_draft = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
paid_first = sql('begin;' + service(f"select public.place_direct_order('{buyer}','{finalize_draft}',{literal(address)},'dd270000-0000-4000-8000-000000000016','card',0,null);") + 'commit;').splitlines()[-1]
paid_attempt = claimed_attempt(paid_first, '3', 'dd270000-0000-4000-8000-000000000103')
finalizer = start('draft-finalize', service(f"select public.finalize_goods_payment_attempt('{paid_attempt}','dd270000-0000-4000-8000-000000000103','approved',null,'TEST-RETAINED-CONC-10');")
                  + 'select pg_sleep(1.5);')
wait_state('draft-finalize', 'Timeout', finalizer)
resubmit = start('draft-resubmit', service(f"select public.place_direct_order('{buyer}','{finalize_draft}',{literal(address)},'dd270000-0000-4000-8000-000000000017','bank_transfer',0,null);"))
wait_state('draft-resubmit', 'Lock', resubmit)
assert 'approved' in finish(finalizer)
finish(resubmit, 'checkout_draft_used')
assert sql(f"select count(*) from public.orders where user_id='{buyer}' and checkout_key='dd270000-0000-4000-8000-000000000017';") == '0'
assert sql(f"select status from public.orders where id='{paid_first}';") == 'paid'
assert sql(f"select order_id from private.checkout_drafts where id='{finalize_draft}';") == paid_first
assert cart() == cart_before
print('PASS same draft resubmitted while the first payment finalizes waits on that order and is rejected as used; one order; no deadlock', flush=True)

# 11. 첫 주문의 결제가 승인 확인 중인데 리스(10분)가 지났다(승인 API가 늦거나 서버가 결과를 잃음). 같은 초안의 재제출은
#     그 주문을 떼어 내고(detach) 새 주문을 만들지 않고 checkout_payment_in_progress(원 주문)로 거절된다.
lease_draft = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
confirming_first = sql('begin;' + service(f"select public.place_direct_order('{buyer}','{lease_draft}',{literal(address)},'dd270000-0000-4000-8000-000000000018','card',0,null);") + 'commit;').splitlines()[-1]
confirming_attempt = claimed_attempt(confirming_first, '4', 'dd270000-0000-4000-8000-000000000104')
sql(f"update public.payment_attempts set claim_expires_at=clock_timestamp()-interval '1 second' where id='{confirming_attempt}';")
lease_resubmit = start('draft-expired-lease', service(f"select public.place_direct_order('{buyer}','{lease_draft}',{literal(address)},'dd270000-0000-4000-8000-000000000019','card',0,null);"))
rejected = lease_resubmit.communicate(timeout=30)
if not lease_resubmit.returncode or 'checkout_payment_in_progress' not in rejected[1] or confirming_first not in rejected[1]:
    raise RuntimeError(f'Expected checkout_payment_in_progress with the first order: {rejected}')
assert sql(f"select count(*) from public.orders where user_id='{buyer}' and checkout_key='dd270000-0000-4000-8000-000000000019';") == '0'
assert sql(f"select o.status||':'||h.state from public.orders o join private.cart_order_holds h on h.order_id=o.id where o.id='{confirming_first}';") == 'pending:awaiting_payment'
assert sql(f"select order_id from private.checkout_drafts where id='{lease_draft}';") == confirming_first
print('PASS same draft resubmitted while the first payment is confirming past its lease is rejected without detaching; one order', flush=True)

# 12·13. 바로구매 '다시 구매하기'(service_retry_direct_order)는 계정 advisory → 주문 → account-action → profiles 순서로 잠근다.
#     정지 계정 확인이 profiles를 먼저 잡으면(FOR SHARE) 다른 탭의 새 주문이 그 주문을 닫을 때(12)나 그 주문의 결제 확정(13)의
#     등급 재계산(profiles FOR UPDATE)과 교착한다 — 트리거가 교착을 삼키면 등급 재계산이 조용히 빠진다(stderr WARNING). 멈춤
#     트리거로 보류 해제·결제 확정 직전에 세워 두고 다시 구매하기를 끼워 넣는다. finish()가 stderr의 'deadlock detected'를 잡는다.
pause = 7101056
sql(f"""create table private.test_retry_pause_targets(order_id uuid primary key);
create function private.test_retry_pause_hold() returns trigger language plpgsql as $$begin
 if old.state='awaiting_payment' and new.state='released' and exists(select 1 from private.test_retry_pause_targets t where t.order_id=old.order_id) then
  perform pg_advisory_xact_lock({pause}); end if; return new; end$$;
create function private.test_retry_pause_paid() returns trigger language plpgsql as $$begin
 if old.status='pending' and new.status='paid' and exists(select 1 from private.test_retry_pause_targets t where t.order_id=old.id) then
  perform pg_advisory_xact_lock({pause}); end if; return new; end$$;
create trigger aaa_test_retry_pause_hold before update on private.cart_order_holds for each row execute function private.test_retry_pause_hold();
create trigger aaa_test_retry_pause_paid before update of status on public.orders for each row execute function private.test_retry_pause_paid();""")


def direct_order(key):
    draft = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
    return sql('begin;' + service(f"select public.place_direct_order('{buyer}','{draft}',{literal(address)},'{key}','card',0,null);") + 'commit;').splitlines()[-1]


window_order = direct_order('dd270000-0000-4000-8000-000000000020')
sql('begin;' + service(f"select public.prepare_goods_payment_attempt('{buyer}','{window_order}','toss');") + 'commit;')
sql(f"insert into private.test_retry_pause_targets values('{window_order}');")
superseding_draft = sql('begin;' + service(f"select public.service_create_checkout_direct_draft('{buyer}','retained-a',{direct_lines});") + 'commit;').splitlines()[-1]
gate = start('retry-pause-hold', f'select pg_advisory_xact_lock({pause});select pg_sleep(1.5);')
wait_state('retry-pause-hold', 'Timeout', gate)
superseder = start('retry-superseder', service(f"select public.place_direct_order('{buyer}','{superseding_draft}',{literal(address)},'dd270000-0000-4000-8000-000000000021','card',0,null);"))
wait_state('retry-superseder', 'Lock', superseder)
retry = start('retry-behind-superseder', service(f"select public.service_retry_direct_order('{buyer}','{window_order}');"))
wait_state('retry-behind-superseder', 'Lock', retry)
finish(gate)
finish(superseder)
retried = json.loads(finish(retry).splitlines()[-1])
assert sql(f"select status from public.orders where id='{window_order}';") == 'canceled'
assert retried['result'] == 'draft', retried
sql('delete from private.test_retry_pause_targets;')
print('PASS 다시 구매하기 behind a superseding new order waits on the account advisory; no deadlock; loyalty recalculation not skipped', flush=True)

finalizing_order = direct_order('dd270000-0000-4000-8000-000000000022')
finalizing_attempt = claimed_attempt(finalizing_order, '5', 'dd270000-0000-4000-8000-000000000105')
sql(f"insert into private.test_retry_pause_targets values('{finalizing_order}');")
gate = start('retry-pause-paid', f'select pg_advisory_xact_lock({pause});select pg_sleep(1.5);')
wait_state('retry-pause-paid', 'Timeout', gate)
finalizer = start('retry-finalize', service(f"select public.finalize_goods_payment_attempt('{finalizing_attempt}','dd270000-0000-4000-8000-000000000105','approved',null,'TEST-RETAINED-CONC-13');"))
wait_state('retry-finalize', 'Lock', finalizer)
retry = start('retry-finalizing', service(f"select public.service_retry_direct_order('{buyer}','{finalizing_order}');"))
wait_state('retry-finalizing', 'Lock', retry)
finish(gate)
assert 'approved' in finish(finalizer)
retried = json.loads(finish(retry).splitlines()[-1])
assert retried['result'] == 'not_retryable', retried
assert sql(f"select status from public.orders where id='{finalizing_order}';") == 'paid'
sql('delete from private.test_retry_pause_targets;')
print('PASS 다시 구매하기 of an order whose payment is finalizing waits on that order row and reports not_retryable; no deadlock', flush=True)
sql('drop trigger aaa_test_retry_pause_hold on private.cart_order_holds;drop trigger aaa_test_retry_pause_paid on public.orders;'
    'drop function private.test_retry_pause_hold();drop function private.test_retry_pause_paid();drop table private.test_retry_pause_targets;')

# 14. 같은 실패 주문의 '다시 구매하기'를 두 탭이 동시에 누른다. 두 호출은 계정 advisory에서 차례로 오고, 둘째는 첫째가 만든
#     초안을 돌려받는다 — 다시 구매 초안은 원 주문당 하나다(두 번 주문되지 않게).
declined_order = direct_order('dd270000-0000-4000-8000-000000000023')
sql('begin;' + service(f"select public.prepare_goods_payment_attempt('{buyer}','{declined_order}','toss');") + 'commit;')
sql(f"update public.payment_attempts set state='declined' where purpose='order' and ref_id='{declined_order}';")
gate = start('retry-tabs-gate', f"select pg_advisory_xact_lock(hashtextextended('{buyer}',0));select pg_sleep(1.5);")
wait_state('retry-tabs-gate', 'Timeout', gate)
tab_one = start('retry-tab-1', service(f"select public.service_retry_direct_order('{buyer}','{declined_order}');"))
wait_state('retry-tab-1', 'Lock', tab_one)
tab_two = start('retry-tab-2', service(f"select public.service_retry_direct_order('{buyer}','{declined_order}');"))
wait_state('retry-tab-2', 'Lock', tab_two)
finish(gate)
first_retry = json.loads(finish(tab_one).splitlines()[-1])
second_retry = json.loads(finish(tab_two).splitlines()[-1])
assert first_retry['result'] == second_retry['result'] == 'draft', (first_retry, second_retry)
assert first_retry['draftId'] == second_retry['draftId']
assert sql(f"select count(*) from private.checkout_drafts where retry_order_id='{declined_order}';") == '1'
assert sql(f"select status from public.orders where id='{declined_order}';") == 'canceled'
print('PASS two tabs press 다시 구매하기 for the same order at once; one retry draft; no deadlock', flush=True)
print(json.dumps({'cases': 14, 'database': database, 'sourceDatabaseWrites': 0}, ensure_ascii=False), flush=True)

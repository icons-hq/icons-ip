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
    return sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='{buyer}';")


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
    + 'reset role;update private.goods_transaction_runtime set enabled=true where singleton;commit;')
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
print(json.dumps({'cases': 4, 'database': database, 'sourceDatabaseWrites': 0}, ensure_ascii=False), flush=True)

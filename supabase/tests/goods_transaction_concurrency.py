"""Real separate-session waits against an explicitly disposable goods clone."""
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
prefix = f'goods-transaction-{os.getpid()}'
buyer = 'bb140000-0000-4000-8000-000000000002'
admin = 'bb140000-0000-4000-8000-000000000001'
address = '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def literal(value):
    return "'" + value.replace("'", "''") + "'"

def actor(value):
    return f"select set_config('request.jwt.claim.sub','{value}',true);set local role authenticated;"

def start(label, statements, delay=0):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"set application_name='{prefix}-{label}';begin;set local lock_timeout='10s';{statements}" + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close();process.stdin = None
    return process

def wait_state(label, expected, process):
    for _ in range(180):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{prefix}-{label}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{label} exited before {expected}: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{label} never reached {expected}')

def finish(process, expected_error=None):
    output = process.communicate(timeout=15)
    if expected_error:
        if not process.returncode or expected_error not in output[1]:
            raise RuntimeError(f'Expected {expected_error}: {output}')
    elif process.returncode:
        raise RuntimeError(output[1])
    return output

root = Path(__file__).parent
fixture = (root / 'goods_transaction_checkout.sql').read_text().split("set local role service_role;")[0]
fixture = fixture.replace('begin;', '', 1).replace('pg_temp.', 'goods_transaction_test.')
fixture = fixture.replace('set local role authenticated;', 'grant execute on all functions in schema goods_transaction_test to authenticated,service_role;set local role authenticated;', 1)
kc = (root / 'helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.', 'goods_transaction_test.')
sql('begin;create schema goods_transaction_test;grant usage on schema goods_transaction_test to authenticated,service_role;' + kc + fixture
    + f"reset role;update private.operator_memberships set manager_role='owner' where profile_id='{admin}';commit;")
variant = sql("select id from public.goods_variants where good_id='transaction-check-a' and is_default;")
held = sql(f"select user_coupon_id from public.cart_coupon_selections where user_id='{buyer}';")
expected = sql(f"select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='{buyer}';")
quote_call = f"select public.quote_cart_goods_transaction('{buyer}',{literal(expected)},{literal(address)},'{{}}','{held}',2000);"

one = start('runtime-off', 'update private.goods_transaction_runtime set enabled=false where singleton;', 1.5)
wait_state('runtime-off', 'Timeout', one)
two = start('runtime-quote', 'set local role service_role;' + quote_call)
wait_state('runtime-quote', 'Lock', two)
finish(one);finish(two, 'transaction_runtime_disabled')
assert sql(f"select not exists(select 1 from private.goods_transaction_quotes where actor_id='{buyer}');") == 't'
sql('update private.goods_transaction_runtime set enabled=true where singleton;')
print('PASS runtime OFF/quote: actual row Lock wait, disabled state rechecked, zero quotes', flush=True)

# A quoted source holds the common actor/cart lock; mutations wait and then
# change the source, so an old expected selection cannot silently buy new rows.
one = start('quote', 'set local role service_role;' + quote_call, 1.5)
wait_state('quote', 'Timeout', one)
two = start('cart', actor(buyer) + f"select public.set_cart_item_quantity('transaction-check-a','{variant}',4);")
wait_state('cart', 'Lock', two)
finish(one);finish(two)
assert sql(f"select qty=4 from public.cart_items where user_id='{buyer}' and good_id='transaction-check-a';") == 't'
failed = start('stale-selection', 'set local role service_role;' + quote_call)
finish(failed, 'cart_snapshot_changed')
sql('begin;' + actor(buyer) + f"select public.set_cart_item_quantity('transaction-check-a','{variant}',3);commit;")
print('PASS quote/cart mutation: observed real Lock wait and rejected stale expected selection', flush=True)

# A quote expires while place is waiting for the actual catalog lock. Checking
# only before that wait would reserve stale prices. The second check is decisive.
quoted = json.loads(sql('begin;set local role service_role;' + quote_call + 'commit;').splitlines()[-1])
quote_id = quoted['quoteId']
sql(f"update private.goods_transaction_quotes set expires_at=clock_timestamp()+interval '1 second' where id='{quote_id}';")
place = f"select public.place_cart_goods_transaction('{buyer}',{literal(expected)},{literal(address)},'{quote_id}','bb140000-0000-4000-8000-000000000061','card');"
one = start('catalog', "select id from public.goods where id='transaction-check-a' for update;", 1.8)
wait_state('catalog', 'Timeout', one)
two = start('expired-place', 'set local role service_role;' + place)
wait_state('expired-place', 'Lock', two)
finish(one);finish(two, 'transaction_quote_expired')
assert sql(f"select not exists(select 1 from public.orders where user_id='{buyer}');") == 't'
print('PASS quote expiry after catalog Lock wait: no order or allocation committed', flush=True)

quoted = json.loads(sql('begin;set local role service_role;' + quote_call + 'commit;').splitlines()[-1])
quote_id = quoted['quoteId']
place = f"select public.place_cart_goods_transaction('{buyer}',{literal(expected)},{literal(address)},'{quote_id}','bb140000-0000-4000-8000-000000000062','card');"
one = start('place-first', 'set local role service_role;' + place, 1.5)
wait_state('place-first', 'Timeout', one)
two = start('place-replay', 'set local role service_role;' + place)
wait_state('place-replay', 'Lock', two)
a = finish(one)[0].strip();b = finish(two)[0].strip()
assert a == b
order_id = a
assert sql(f"select count(*)=1 from public.orders where user_id='{buyer}';") == 't'
assert sql(f"select count(*)=2 from private.order_price_allocations where order_id='{order_id}';") == 't'
sql(f"begin;set local role service_role;select public.cancel_order('{order_id}','TEST 경합취소');commit;")
sql('begin;' + actor(buyer) + f"select public.set_cart_item_quantity('transaction-check-a','{variant}',3);"
    + "select public.set_cart_item_quantity('transaction-check-b',(select id from public.goods_variants where good_id='transaction-check-b' and is_default),1);"
    + "select public.apply_cart_coupon_code('TRANSACTION10P');commit;")
print('PASS simultaneous same-key places: actual Lock wait, one order, one reservation, identical replay', flush=True)

# Production suspension RPC, cart RPC and quote RPC use the same outer actor
# order. Two waiters cannot hold profile/cart in reverse order while waiting.
one = start('suspend', actor(admin) + f"select public.admin_suspend_user('{buyer}','TEST 동시정지');", 1.8)
wait_state('suspend', 'Timeout', one)
two = start('suspended-cart', actor(buyer) + f"select public.set_cart_item_quantity('transaction-check-a','{variant}',4);")
three = start('suspended-quote', 'set local role service_role;' + quote_call)
wait_state('suspended-cart', 'Lock', two)
wait_state('suspended-quote', 'Lock', three)
finish(one);finish(two, 'account_suspended');finish(three, 'transaction_actor_unavailable')
assert sql(f"select qty=3 from public.cart_items where user_id='{buyer}' and good_id='transaction-check-a';") == 't'
print('PASS three-session suspension/cart/quote: both actual Lock waits, both rejected, no deadlock', flush=True)
print(json.dumps({'cases': 5, 'database': database, 'sourceDatabaseWrites': 0}, ensure_ascii=False), flush=True)

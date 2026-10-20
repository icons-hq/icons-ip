"""Clock-after-lock and whole-order checks in an explicitly disposable DB copy."""
import json
import os
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_goods_sale_period_concurrency_'):
    raise SystemExit('Use the disposable goods sale period database')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
base = Path(__file__).parent
buyer = 'a5e06400-0000-4000-8000-000000000002'
admin = 'a5e06400-0000-4000-8000-000000000001'
address = json.dumps(dict(recipientName='합성 수취인', phone='01000000000', postalCode='12345', address1='합성 주소'), ensure_ascii=False)
prefix = f'sale-period-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


assert sql("""
select not has_function_privilege('authenticated','public.place_order(jsonb,uuid,public.order_payment_method)','execute')
 and not has_function_privilege('service_role','public.place_order(jsonb,uuid,public.order_payment_method)','execute')
 and not has_function_privilege('authenticated','public.place_order(uuid,jsonb,uuid,public.order_payment_method)','execute')
 and has_function_privilege('service_role','public.place_order(uuid,jsonb,uuid,public.order_payment_method)','execute');
""") == 't', 'Checkout must retain the sealed legacy and server-only current ACLs'


def auth(user=buyer):
    return f"select set_config('request.jwt.claim.sub','{user}',true);set local role authenticated;"


def service():
    return 'set local role service_role;'


def key(n):
    return f'a5e06400-0000-4000-8000-{n:012d}'


def wait_state(name, expected, process):
    for _ in range(180):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(.02)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.8);commit;")
    one.stdin.close(); one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close(); two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_result, second_result = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_result[1])
    if not two.returncode or expected_error not in second_result[1]:
        raise RuntimeError(f'{label}: expected {expected_error}: {second_result}')
    print(f'PASS {label}: actual lock wait; {expected_error}')


# Keep the regression fixture contract in one place. It includes actual catalog
# RPC creation, explicit capabilities, CAS, preorder conflicts and KC review.
setup = (base / 'helpers/goods_kc_fixture.sql').read_text() + (base / 'goods_sale_period.sql').read_text().split("select 1/case when (select available_qty")[0]
setup += "reset role;select set_config('request.jwt.claim.sub','',true);"
# A clean CI/FRESH database has no owner cohort. Configure only this disposable
# clone's synthetic admin as owner so deferred owner-integrity checks also run.
setup += f"update private.operator_memberships set manager_role='owner' where profile_id='{admin}' and not exists(select 1 from private.operator_memberships where manager_role='owner');commit;"
sql(setup)
variant = sql("select id from public.goods_variants where good_id='sale-period-good';")
clone_variant = sql("select id from public.goods_variants where good_id='sale-period-clone';")
# The clone begins unpublished with zero stock; make a second explicit test good.
sql((base / 'helpers/goods_kc_fixture.sql').read_text() + """begin;
update public.goods set type='문구',image_path='public-media/sale-period-test.webp',notice_maker='합성',notice_origin='한국',notice_material='종이',notice_size='A5',notice_made_on='2026-10',notice_as_manager='합성 CS',notice_as_contact='02-0000' where id='sale-period-clone';
update public.goods_variants set stock_qty=20 where good_id='sale-period-clone';
insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) values(('47c47700'||left(md5('sale-period-clone'),24))::uuid,'authenticated','authenticated','sale-period-clone-kc@example.test','{"testFixture":"goods-kc"}',now(),now());
insert into private.operator_memberships(profile_id,manager_role) values(('47c47700'||left(md5('sale-period-clone'),24))::uuid,'primary');
select pg_temp.publish_goods_kc_fixture('sale-period-clone');commit;""")


def open_goods():
    sql("update public.goods set sale_starts_at=clock_timestamp()-interval '1 hour',sale_ends_at=clock_timestamp()+interval '1 hour' where id in('sale-period-good','sale-period-clone');")


def soon(good='sale-period-good'):
    sql(f"update public.goods set sale_starts_at=clock_timestamp()-interval '1 hour',sale_ends_at=clock_timestamp()+interval '1 second' where id='{good}';")


def hold(good='sale-period-good'):
    return f"select id from public.goods where id='{good}' for update;"


def cart(good='sale-period-good', quantity=1):
    option = variant if good == 'sale-period-good' else clone_variant
    return f"select public.set_cart_item_quantity('{good}','{option}',{quantity});"


def clear_cart():
    sql(f"delete from public.cart_items where user_id='{buyer}';")


def place(n):
    return f"select public.place_order('{buyer}'::uuid,'{address}'::jsonb,'{key(n)}'::uuid,'card'::public.order_payment_method);"


def create_order(n, mixed=False):
    open_goods(); clear_cart()
    sql('begin;' + auth() + cart() + (cart('sale-period-clone') if mixed else '') + service() + place(n) + 'commit;')
    return sql(f"select id from public.orders where user_id='{buyer}' and checkout_key='{key(n)}';")


def prepare(order):
    return f"select public.prepare_goods_payment_attempt('{buyer}','{order}','toss');"


open_goods(); soon()
race('cart-time', hold(), auth() + cart(), 'goods_sale_not_open')
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}';") == '0'
open_goods(); sql('begin;' + auth() + cart() + 'commit;'); soon()
race('checkout-time', hold(), service() + place(101), 'goods_sale_not_open')
assert sql(f"select count(*) from public.orders where checkout_key='{key(101)}';") == '0'
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}';") == '1'
assert sql(f"select stock_qty from public.goods_variants where id='{variant}';") == '20'

order = create_order(102); soon()
race('prepare-time', hold(), service() + prepare(order), 'goods_sale_not_open')
assert sql(f"select count(*) from public.payment_attempts where ref_id='{order}';") == '0'

order = create_order(103); sql('begin;' + service() + prepare(order) + 'commit;')
attempt = sql(f"select id from public.payment_attempts where ref_id='{order}';")
provider_id = sql(f"select provider_order_id from public.payment_attempts where id='{attempt}';")
sql(f"select public.bind_goods_payment_callback_nonce('{attempt}',repeat('a',64));")
soon()
race('claim-time', hold(), service() + f"select public.claim_goods_payment_attempt('toss','{provider_id}',repeat('a',64),'{key(203)}');", 'goods_sale_not_open')
assert sql(f"select state from public.payment_attempts where id='{attempt}';") == 'prepared'

order = create_order(104, mixed=True); soon('sale-period-clone')
race('whole-order-clock', hold('sale-period-good'), service() + prepare(order), 'goods_sale_not_open')
assert sql(f"select count(*) from public.payment_attempts where ref_id='{order}';") == '0'

# Delay after all line INSERT guards, at the canonical creator's final total
# update, to prove its last common-clock check is real and rollback-safe.
sql("""create function private.test_sale_period_final_wait() returns trigger language plpgsql as $$begin
 if new.checkout_key='a5e06400-0000-4000-8000-000000000105'::uuid and new.total>0 then
  perform pg_advisory_xact_lock(6400105);end if;return new;end$$;
create trigger test_sale_period_final_wait before update of total on public.orders for each row execute function private.test_sale_period_final_wait();""")
open_goods(); clear_cart(); sql('begin;' + auth() + cart() + 'commit;'); soon()
stock_before = sql(f"select stock_qty from public.goods_variants where id='{variant}';")
race('checkout-final-clock', 'select pg_advisory_xact_lock(6400105);', service() + place(105), 'goods_sale_not_open')
assert sql(f"select count(*) from public.orders where checkout_key='{key(105)}';") == '0'
assert sql(f"select stock_qty from public.goods_variants where id='{variant}';") == stock_before
assert sql(f"select count(*) from public.cart_items where user_id='{buyer}';") == '1'
sql('drop trigger test_sale_period_final_wait on public.orders;drop function private.test_sale_period_final_wait();')

# Use a fresh unpublished clone so catalog identity locks are irrelevant to CAS.
sql('begin;' + auth(admin) + f"select public.admin_clone_good('{key(301)}','sale-period-good','sale-period-cas','SALE-CAS','기간 CAS');commit;")
revision = int(sql("select sale_period_revision from public.goods where id='sale-period-cas';"))
payload = dict(id='sale-period-cas', previous_id='sale-period-cas', ip_id='sale-period-tests', name='기간 CAS', type='문구', price=10000,
               sale_period=dict(startsAt='2099-01-01T00:00:00Z', endsAt='2099-02-01T00:00:00Z', expectedRevision=revision))
save = "select public.admin_save_good('" + json.dumps(payload, ensure_ascii=False) + "');"
race('period-cas', auth(admin) + save, auth(admin) + save, 'goods_sale_period_changed')
assert sql("select sale_period_revision from public.goods where id='sale-period-cas';") == str(revision+1)

# Competing preorder activation and ordinary period save share the good lock in
# both directions. The loser must not leave a selected conflicting policy.
for n, direction in [(302, 'period-first'), (303, 'preorder-first')]:
    good = f'sale-period-{direction}'
    sql('begin;' + auth(admin) + f"select public.admin_clone_good('{key(n)}','sale-period-good','{good}','SALE-{n}','기간 경합');commit;")
    option = sql(f"select id from public.goods_variants where good_id='{good}';")
    period_payload = dict(payload, id=good, previous_id=good, name='기간 경합')
    period_payload['sale_period'] = dict(payload['sale_period'], expectedRevision=0)
    save_period = auth(admin) + "select public.admin_save_good('" + json.dumps(period_payload, ensure_ascii=False) + "');"
    activate = auth(admin) + f"select public.admin_save_goods_preorder('{good}','{option}',null,jsonb_build_object('state','active','capacityQty',2,'startsAt',now()-interval '1 hour','endsAt',now()+interval '1 hour','expectedShipDate',current_date+5,'approvalReference','TEST-ONLY period race'));"
    first, second = (save_period, activate) if direction == 'period-first' else (activate, save_period)
    race(direction, first, second, 'goods_sale_period_preorder_conflict')
    assert sql(f"select count(*) from public.goods g join public.goods_variants v on v.good_id=g.id where g.id='{good}' and g.sale_starts_at is not null and v.preorder_policy_id is not null;") == '0'

print('PASS committed readback: no stale cart/order/attempt, inventory unchanged, one CAS winner, no conflicting preorder')

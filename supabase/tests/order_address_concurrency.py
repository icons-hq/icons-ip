"""Address edits against retries, exports, dispatch and policy changes in a clone."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_order_address_concurrency_'):
    raise SystemExit('Use the disposable order address wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'order-address-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'order-address:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user', number)}',true);set local role authenticated;"


def change(order, operation, who=1, address='address_test.new_address()', reason='합성 동시 변경'):
    return actor(who) + f"select public.admin_change_order_address('{uid('op', operation)}','{uid('order', order)}',0,{address},'{reason}',true);"


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


root = Path(__file__).resolve().parents[1]
if sql("select to_regprocedure('public.admin_order_address_context(uuid)') is null;") == 't':
    sql((root / 'migrations/20261013101000_admin_order_address_changes.sql').read_text())
fixture = Path(__file__).with_name('admin_order_address_changes.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.address_id'):fixture.index('create temp table address_before')]
sql('begin;create schema address_test;grant usage on schema address_test to authenticated;' + fixture.replace('pg_temp.', 'address_test.') + 'commit;')
sql("create table address_test.before_money as select id,total,shipping_fee,discount_total,store_credit_total,shipping_fee_breakdown from public.orders where id in(select address_test.address_id('order',n) from generate_series(1,11)n);")
race('same-operation', change(1, 1), change(1, 1))
race('competing-operators', change(2, 2), change(2, 3, 2), 'order_address_changed')
race('different-payload', change(3, 4), change(3, 4, reason='다른 본문'), 'order_address_request_conflict')
race('read-waits-for-write', change(4, 5), actor() + f"select public.admin_get_order_address_change('{uid('op', 5)}');")


def export_versions(order):
    return sql(f"select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) from public.order_shipments where order_id='{uid('order', order)}';")


def mark_export(versions):
    return actor() + f"select public.admin_mark_shipments_exported('{versions}'::jsonb);"


race('export-before-edit', mark_export(export_versions(5)), change(5, 6), 'order_dispatched')
race('edit-before-stale-export', change(6, 7), mark_export(export_versions(6)), 'shipment_changed')
shipment = sql(f"select id from public.order_shipments where order_id='{uid('order', 7)}' order by id limit 1;")
race('dispatch-before-edit', actor() + f"select public.admin_update_shipment_status('{shipment}','shipping','hanjin','ADDRESSRACE7');", change(7, 8), 'order_not_ready')
race('claim-before-edit', f"select id from public.orders where id='{uid('order', 8)}' for update;insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,stage) values('{uid('order', 8)}','{uid('user', 5)}','합성 요청','cancel','requested');", change(8, 9), 'order_claim_open')
rule = json.dumps(dict(id=uid('rule', 3), postalFrom='90000', postalTo='90999', addressPrefix='', regionLabel='합성 경합 추가료', disposition='surcharge', amount=2500), ensure_ascii=False)
race('region-policy-before-edit', f"select id from public.fulfillment_origins where id='{uid('origin', 1)}' for update;update private.shipping_region_policies set configuration=jsonb_set(configuration,'{{rules}}',(configuration->'rules')||'{rule}'::jsonb) where id='{uid('policy', 1)}';", change(9, 10, address="address_test.new_address()||'{\"postalCode\":\"90000\"}'::jsonb"), 'order_address_shipping_fee_changed')
race('revoke-before-edit', f"select private.lock_operator_subjects(array['{uid('user', 2)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('user', 2)}';", change(10, 11, 2), 'operator_capability_required')
assert sql("select count(*) from private.order_address_changes where actor_id in(address_test.address_id('user',1),address_test.address_id('user',2));") == '5'
assert sql("select count(*) from address_test.before_money b join public.orders o using(id) where (b.total,b.shipping_fee,b.discount_total,b.store_credit_total,b.shipping_fee_breakdown) is distinct from (o.total,o.shipping_fee,o.discount_total,o.store_credit_total,o.shipping_fee_breakdown);") == '0'
assert sql(f"select count(*) from public.audit_log where id='{uid('op', 1)}';") == '1'
print('PASS immutable paid amounts, one receipt/audit per accepted request, all blocked writes absent', flush=True)

"""Claim conversion against receipt retries, approvals, collection and role revocation."""
if not __debug__:
    raise SystemExit('Refusing optimized Python: safety assertions must remain enabled')

import hashlib
import re
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
clone_lease = os.environ.get('ORDER_CLAIM_CONTACT_CLONE_LEASE')
leased_contact_clone = bool(re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}', database) and re.fullmatch(r'[0-9a-f]{64}', container)
    and clone_lease and clone_lease.replace('-', '') == database[-32:])
if not database.startswith('icons_claim_conversion_concurrency_') and not leased_contact_clone:
    raise SystemExit('Use the disposable claim conversion wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'claim-conversion-{os.getpid()}'


# Each dispatch connection owns its temporary shim; no public ACL is reopened.
PHYSICAL_RESHIPMENT_SHIM = """
-- Test-only access to the preserved physical engine. New dispatch through the
-- old public RPC is sealed; contact-v2 and public denial are covered separately
-- by order_claim_contact.sql. Keep the original JWT actor/capability checks.
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text,p_items jsonb) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,p_items);
$$;
create function pg_temp.record_order_claim_reshipment_physical(p_claim uuid,p_carrier text,p_tracking text) returns text
language sql security definer set search_path='' as $$
 select private.record_order_claim_reshipment_physical(p_claim,p_carrier,p_tracking,'[]'::jsonb);
$$;
revoke all on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function pg_temp.record_order_claim_reshipment_physical(uuid,text,text,jsonb),pg_temp.record_order_claim_reshipment_physical(uuid,text,text) to authenticated;
"""


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


if leased_contact_clone:
    identity = json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;'))
    if identity['lease'] != clone_lease or identity['container_id'] != container or identity['source_database'] != 'postgres':
        raise SystemExit('Disposable contact clone identity mismatch')


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'claim-conversion:{kind}:{number}'.encode()).hexdigest()))


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user', number)}',true);set local role authenticated;"


def convert(claim, operation, destination='exchange', who=1, agreement='합성 고객의 전환 및 비용 합의', revision=None):
    if revision is None:
        revision = sql(f"select claim_revision from public.order_cancellation_requests where id='{uid('claim', claim)}';")
    return actor(who) + f"select public.admin_convert_order_claim_type('{uid('claim', claim)}','{uid('op', operation)}',{revision},'{destination}','{agreement}',true,null);"


def decide(claim, decision='review'):
    return actor() + f"select public.admin_decide_order_claim('{uid('claim', claim)}','{decision}','합성 동시 처리 근거');"


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
if sql("select to_regprocedure('public.admin_convert_order_claim_type(uuid,uuid,integer,text,text,boolean,jsonb)') is null;") == 't':
    sql((root / 'migrations/20261013115843_order_claim_type_conversion.sql').read_text())
fixture = Path(__file__).with_name('order_claim_type_conversion.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.convert_id'):fixture.index('create temp table conversion_order_before')]
fixture = fixture.replace('generate_series(1,12)', 'generate_series(1,23)')
sql('begin;create schema conversion_test;grant usage on schema conversion_test to authenticated;' + fixture.replace('pg_temp.', 'conversion_test.') + 'commit;')
sql("update private.operator_memberships set manager_role='primary' where profile_id=conversion_test.convert_id('user',2);")
sql("update public.order_shipments set status='delivered',delivered_at=now()-interval '1 day' where order_id in(select conversion_test.convert_id('order',n)from generate_series(13,23)n);")
sql("create table conversion_test.before_money as select id,status,total,shipping_fee,discount_total,store_credit_total,shipping_fee_breakdown from public.orders where id in(select conversion_test.convert_id('order',n) from generate_series(1,23)n);")
race('same-operation', convert(2, 1), convert(2, 1))
race('two-actors', convert(4, 2), convert(4, 3, who=2), 'claim_changed')
race('changed-payload', convert(3, 4, 'return'), convert(3, 4, 'return', agreement='다른 합의 본문'), 'claim_conversion_request_conflict')
race('read-waits-for-write', convert(5, 5), actor() + f"select public.admin_read_order_claim_type_change('{uid('op',5)}');")
race('review-before-convert', decide(13), convert(13, 6), 'claim_changed')
race('convert-before-review', convert(14, 7), decide(14))

def withdraw(claim, operation):
    return actor(3) + f"select public.withdraw_my_order_claim('{uid('claim',claim)}','{uid('withdraw-op',operation)}',0,'합성 고객 철회 합의',true);"

race('withdraw-before-convert', withdraw(11, 1), convert(11, 8), 'claim_changed')
race('convert-before-withdraw', convert(12, 9), withdraw(12, 2), 'claim_changed')

for n in range(15, 21):
    if n in (19,20):
        sql(f"update public.order_cancellation_requests set claim_type='exchange' where id='{uid('claim',n)}';")
    sql('begin;' + decide(n, 'approve') + 'commit;')

def collect(claim):
    shipment = sql(f"select shipment_id from public.order_claim_collections where claim_id='{uid('claim', claim)}' order by shipment_id limit 1;")
    if not shipment: raise RuntimeError('Expected origin collection')
    return actor() + f"select public.admin_record_order_claim_origin_collection('{uid('claim', claim)}','{shipment}','합성 입고 확인');"

race('collection-before-convert', collect(15), convert(15, 10), 'claim_changed')
race('convert-before-collection', convert(16, 11), collect(16))
for n in range(17,21): sql('begin;' + collect(n) + 'commit;')

def refund(claim):
    return actor() + f"select public.admin_record_order_claim_refund('{uid('claim',claim)}','pg_cancel','filed','합성 로컬 접수');"

def reship(claim):
    items = sql(f"select jsonb_agg(jsonb_build_object('orderItemId',id,'variantId',variant_id)) from public.order_items where order_id='{uid('order',claim)}';")
    return PHYSICAL_RESHIPMENT_SHIM + actor() + f"select pg_temp.record_order_claim_reshipment_physical('{uid('claim',claim)}','hanjin','CONVERT{claim:08d}','{items}'::jsonb);"

race('refund-before-convert', refund(17), convert(17, 12), 'claim_changed')
race('convert-before-refund', convert(18, 13), refund(18), 'exchange_has_no_refund')
race('reship-before-convert', reship(19), convert(19, 14, 'return'), 'claim_changed')
race('convert-before-reship', convert(20, 15, 'return'), reship(20), 'claim_type_has_no_reshipment')
for n in (22,23):
    sql(f"update public.order_cancellation_requests set claim_type='exchange' where id='{uid('claim',n)}';update public.orders set payment_method='bank_transfer' where id='{uid('order',n)}';insert into private.claim_refund_accounts(claim_id,bank_name,account_number,account_holder,masked_account,masked_holder,purge_after)values('{uid('claim',n)}','합성은행','1234567890','합성고객','합성은행 ******7890','합*객',now()-interval '1 day');")
# Scope each purge so the other due fixture remains available for the reverse race.
def purge(claim):
    return f"update private.claim_refund_accounts set bank_name=null,account_number=null,account_holder=null,purged_at=clock_timestamp() where claim_id='{uid('claim',claim)}' and purged_at is null and purge_after<=clock_timestamp();"
race('purge-before-convert', purge(22), convert(22, 16, 'return'), 'claim_conversion_account_required')
race('convert-before-purge', convert(23, 17, 'return'), purge(23))
race('revoke-before-convert', f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('user',1)}';", convert(21, 18), 'operator_capability_required')
assert sql("select count(*)from private.order_claim_type_changes where order_id in(select id from conversion_test.before_money);") == '10'
assert sql("select count(*) from conversion_test.before_money b join public.orders o using(id) where (b.status,b.total,b.shipping_fee,b.discount_total,b.store_credit_total,b.shipping_fee_breakdown) is distinct from (o.status,o.total,o.shipping_fee,o.discount_total,o.store_credit_total,o.shipping_fee_breakdown);") == '0'
assert sql(f"select count(*)from public.audit_log where id='{uid('op',1)}';") == '1'
assert sql("select stock_qty from public.goods where id='claim-conversion-good';") == '100'
assert sql(f"select purged_at is null and account_number is not null and purge_after is null from private.claim_refund_accounts where claim_id='{uid('claim',23)}';") == 't'
print('PASS 10 accepted receipts; order/amount/stock preserved; account purge cannot race past reconversion', flush=True)

"""Real transaction races on a disposable clone, without contacting a payment provider."""
if not __debug__:
    raise SystemExit('Refusing optimized Python: safety assertions must remain enabled')

import hashlib
import json
import re
import os
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
clone_lease = os.environ.get('ORDER_CLAIM_CONTACT_CLONE_LEASE')
leased_contact_clone = bool(re.fullmatch(r'icons_goods_transaction_[0-9a-f]{32}', database) and re.fullmatch(r'[0-9a-f]{64}', container)
    and clone_lease and clone_lease.replace('-', '') == database[-32:])
if not database.startswith('icons_claim_reason_concurrency_') and not leased_contact_clone:
    raise SystemExit('Use the disposable claim reason wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'claim-reason-{os.getpid()}'


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
    return hashlib.md5(f'claim-reason:{kind}'.encode()).hexdigest()[:8] + f'-1111-4111-8111-{number:012d}'


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid('user',number)}',true);set local role authenticated;"


def revision(claim):
    return sql(f"select claim_revision from public.order_cancellation_requests where id='{uid('claim',claim)}';")


def change(claim, operation, who=1, description='합성 동시성 사유 정정', reason_type='defect'):
    return actor(who) + f"select public.admin_change_order_claim_reason('{uid('claim',claim)}','{uid('op',operation)}',{revision(claim)},'{uid('user',who)}','{reason_type}','{description}','합성 고객과 협의한 내부 근거',true,false);"


def decide(claim, decision='review'):
    return actor() + f"select public.admin_decide_order_claim('{uid('claim',claim)}','{decision}','합성 동시 처리 근거');"


def hold(claim):
    return actor() + f"select public.admin_change_order_claim_hold('{uid('claim',claim)}','{uid('hold',claim)}',{revision(claim)},'exchange','hold','합성 고객 확인 대기','{uid('user',1)}');"


def convert(claim):
    return actor() + f"select public.admin_convert_order_claim_type('{uid('claim',claim)}','{uid('convert',claim)}',{revision(claim)},'return','합성 고객의 전환 및 비용 합의',true,null);"


def withdraw(claim):
    return actor(3) + f"select public.withdraw_my_order_claim('{uid('claim',claim)}','{uid('withdraw',claim)}',{revision(claim)},'합성 고객의 철회 요청',true);"


def collect(claim):
    shipment = sql(f"select shipment_id from public.order_claim_collections where claim_id='{uid('claim',claim)}' order by shipment_id limit 1;")
    if not shipment:
        raise RuntimeError('Expected collection shipment')
    return actor() + f"select public.admin_record_order_claim_origin_collection('{uid('claim',claim)}','{shipment}','합성 입고 확인');"


def reship(claim):
    items = sql(f"select jsonb_agg(jsonb_build_object('orderItemId',id,'variantId',variant_id)) from public.order_items where order_id='{uid('order',claim)}';")
    return PHYSICAL_RESHIPMENT_SHIM + actor() + f"select pg_temp.record_order_claim_reshipment_physical('{uid('claim',claim)}','hanjin','REASON{claim:08d}','{items}'::jsonb);"


def finance_start(claim, refund=False):
    # These are synthetic service-side ledger writes under the same parent lock.
    # Exchange has no refund RPC; this deliberately tests the independent ledger
    # guard without changing the claim revision or making any provider request.
    lock = f"select id from public.orders where id='{uid('order',claim)}' for update;"
    if refund:
        return lock + f"insert into public.refunds(id,payment_id,amount,reason,status,cancellation_request_id) values('{uid('refund',claim)}','{uid('payment',claim)}',13000,'합성 환급 시작 근거','requested','{uid('claim',claim)}');"
    return lock + f"insert into public.order_cancellation_claims(order_id,requested_by,previous_status) values('{uid('order',claim)}','{uid('user',3)}','delivered');"


def revoke():
    return f"select private.lock_operator_subjects(array['{uid('user',1)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid('user',1)}';"


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
if sql("select to_regprocedure('public.admin_change_order_claim_reason(uuid,uuid,integer,uuid,text,text,text,boolean,boolean)') is null;") == 't':
    sql((root / 'migrations/20261020085323_order_claim_reason_changes.sql').read_text())
fixture = Path(__file__).with_name('order_claim_reason_changes.sql').read_text()
fixture = fixture[fixture.index('create function pg_temp.reason_id'):fixture.index('-- FIXTURE END:')]
fixture = fixture.replace('generate_series(1,28)', 'generate_series(1,53)')
sql('begin;create schema reason_test;grant usage on schema reason_test to authenticated;' + fixture.replace('pg_temp.', 'reason_test.') + 'commit;')
sql("update public.order_shipments set status='delivered',delivered_at='2020-01-01T00:00:00Z' where order_id in(select reason_test.reason_id('order',n)from generate_series(29,53)n);")
sql("create table reason_test.before_orders as select id,status,total,shipping_fee,discount_total,store_credit_total,shipping_fee_breakdown from public.orders where id in(select reason_test.reason_id('order',n)from generate_series(29,53)n);")
sql("insert into public.payments(id,user_id,purpose,ref_id,amount,status,payment_key,idempotency_key,provider) select reason_test.reason_id('payment',n),reason_test.reason_id('user',3),'order',reason_test.reason_id('order',n),13000,'paid','claim-reason-payment-'||n,'claim-reason-payment-'||n,'toss' from generate_series(49,50)n;")

race('same-operation', change(29,29), change(29,29))
race('changed-payload', change(30,30), change(30,30,description='다른 합성 정정 내용'), 'claim_reason_request_conflict')
race('two-actors', change(31,31), change(31,131,who=2), 'claim_changed')
race('read-waits-for-write', change(32,32), actor() + f"select public.admin_read_order_claim_reason_change('{uid('op',32)}');")
race('review-before-change', decide(33), change(33,33), 'claim_changed')
race('change-before-review', change(34,34), decide(34))
race('hold-before-change', hold(35), change(35,35), 'claim_changed')
race('change-before-hold', change(36,36), hold(36), 'claim_changed')
race('convert-before-change', convert(37), change(37,37), 'claim_changed')
race('change-before-convert', change(38,38), convert(38), 'claim_changed')
race('withdraw-before-change', withdraw(39), change(39,39), 'claim_changed')
race('change-before-withdraw', change(40,40), withdraw(40), 'claim_changed')
race('approve-before-change', decide(41,'approve'), change(41,41), 'claim_changed')
race('change-before-approve', change(42,42), decide(42,'approve'))
for number in range(43,47):
    sql('begin;' + decide(number,'approve') + 'commit;')
race('collection-before-change', collect(43), change(43,43), 'claim_changed')
race('change-before-collection', change(44,44), collect(44))
for number in (45,46):
    sql('begin;' + collect(number) + 'commit;')
race('reship-before-change', reship(45), change(45,45), 'claim_changed')
race('change-before-reship', change(46,46), reship(46))
race('cancel-ledger-before-change', finance_start(47), change(47,47), 'claim_reason_finance_started')
race('change-before-cancel-ledger', change(48,48), finance_start(48))
race('refund-ledger-before-change', finance_start(49,True), change(49,49), 'claim_reason_finance_started')
race('change-before-refund-ledger', change(50,50), finance_start(50,True))
race('revoke-before-change', revoke(), change(51,51), 'operator_capability_required')
sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('user',1)}';")
race('change-before-revoke', change(52,52), revoke())
sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{uid('user',1)}';")
race('no-op-retry', change(53,53,description='합성 최초 설명',reason_type='change_of_mind'), change(53,53,description='합성 최초 설명',reason_type='change_of_mind'))

assert sql("select count(*)from private.order_claim_reason_operations where order_id in(select id from reason_test.before_orders) and changed;") == '14'
assert sql("select count(*)from private.order_claim_reason_operations where order_id in(select id from reason_test.before_orders) and not changed;") == '1'
assert sql("select count(*)from public.audit_log where action='admin.order.claim_reason_changed' and target in(select 'order:'||id from reason_test.before_orders);") == '14'
assert sql(f"select count(*)from public.notifications where user_id='{uid('user',3)}' and dedupe_key like 'claim:reason_changed:%';") == '14'
assert sql("select count(*)from reason_test.before_orders b join public.orders o using(id) where (b.status,b.total,b.shipping_fee,b.discount_total,b.store_credit_total,b.shipping_fee_breakdown) is distinct from(o.status,o.total,o.shipping_fee,o.discount_total,o.store_credit_total,o.shipping_fee_breakdown);") == '0'
assert sql("select count(*)from public.order_cancellation_requests where id in(select reason_test.reason_id('claim',n)from unnest(array[33,35,37,39,41,43,45,47,49,51])n) and reason<>'합성 최초 설명';") == '0'
assert sql(f"select claim_revision=0 from public.order_cancellation_requests where id='{uid('claim',53)}';") == 't'
print('PASS 25 actual lock races; 14 changes, one no-op receipt, 14 audits and customer notices; blocked changes and order money preserved', flush=True)

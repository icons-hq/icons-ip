"""Two-session races between return-address changes and claim collection (S36-040·QNA-031).

- 상품 반품지 저장과 승인 스냅샷은 상품 행 잠금으로 직렬화된다. 먼저 끝난 쪽의 값이 스냅샷이다.
- 승인된 회수 묶음의 확인은 주소록 저장을 기다리지 않고, 스냅샷은 주소록 변경을 따라가지 않는다.
- 상품이 막 고른 주소는 동시에 지울 수 없다(return_address_in_use).
- 같은 배송 건의 두 묶음을 동시에 확인하면 배송 건 행에서 직렬화되어 회수 완료·알림이 한 번이다.
"""
import hashlib
import os
import subprocess
import time
import uuid

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_return_address_concurrency_'):
    raise SystemExit('Use the disposable return address wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'return-address-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(kind, number):
    return str(uuid.UUID(hashlib.md5(f'return-address-race:{kind}:{number}'.encode()).hexdigest()))


ACTOR = f"select set_config('request.jwt.claim.sub','{uid('user', 1)}',true);set local role authenticated;"
# 다른 운영자(같은 계정 잠금을 공유하지 않는다). 회수 확인이 주소록 저장을 기다리지 않는지 볼 때 쓴다.
OTHER_ACTOR = f"select set_config('request.jwt.claim.sub','{uid('user', 4)}',true);set local role authenticated;"


def address_id(name):
    return sql(f"select id from public.return_addresses where name='{name}';")


def save_policy(good, place):
    value = 'null' if place is None else f'"{address_id(place)}"'
    stamp = sql(f"select updated_at from public.goods where id='{good}';")
    return ACTOR + f"""select public.admin_save_good_claim_policy('{good}','{{"returnAddressId":{value}}}','{stamp}');"""


def approve(claim):
    return ACTOR + f"select public.admin_decide_order_claim('{uid('claim', claim)}','approve',null);"


def save_address(name, address):
    stamp = sql(f"select updated_at from public.return_addresses where name='{name}';")
    return ACTOR + (f"select public.admin_save_return_address('{address_id(name)}',"
                    f"jsonb_build_object('name','{name}','address','{address}','phone','02-0000-0000'),'{stamp}');")


def delete_address(name):
    stamp = sql(f"select updated_at from public.return_addresses where name='{name}';")
    return ACTOR + f"select public.admin_delete_return_address('{address_id(name)}','{stamp}');"


def record_bundle(claim, place, evidence, actor=ACTOR):
    condition = 'return_address_id is null' if place is None else f"return_address_id='{address_id(place)}'"
    bundle = sql(f"select id from public.order_claim_collection_bundles where claim_id='{uid('claim', claim)}' and {condition};")
    return actor + (f"select public.admin_record_order_claim_collection_bundle('{uid('claim', claim)}','{bundle}','{evidence}',"
                    "(clock_timestamp() at time zone 'Asia/Seoul')::date);")


def wait_state(name, expected, process):
    for _ in range(160):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def start(name, body, hold, lock_timeout='8s'):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    tail = f'select pg_sleep({hold});' if hold else ''
    process.stdin.write(f"load 'safeupdate';set application_name='{name}';begin;set local lock_timeout='{lock_timeout}';{body}{tail}commit;")
    process.stdin.close()
    process.stdin = None
    return process


def race(label, first, second, expected_error=None, second_waits=True):
    name = f'{prefix}-{label}'
    # 기다리지 않아야 하는 경합은 첫 세션을 더 오래 잡고, 둘째 세션은 잠금을 0.5초만 기다린다(기다리면 lock_timeout으로 실패).
    one = start(f'{name}-first', first, 1.5 if second_waits else 4)
    wait_state(f'{name}-first', 'Timeout', one)
    two = start(f'{name}-second', second, 0, '8s' if second_waits else '500ms')
    if second_waits:
        wait_state(f'{name}-second', 'Lock', two)
    else:
        # 기다리지 않아야 하는 쪽: 첫 세션이 아직 열려 있는 동안 끝나야 한다.
        second_out = two.communicate(timeout=10)
        early = one.poll() is None
        if not early or two.returncode:
            one.communicate(timeout=15)  # 정리(dropdb)가 열린 세션에 막히지 않게 첫 세션을 끝까지 기다린다.
            raise RuntimeError(second_out[1] if two.returncode else f'{label}: second finished only after the first session ended')
    first_out = one.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if second_waits:
        second_out = two.communicate(timeout=15)
        if expected_error:
            if not two.returncode or expected_error not in second_out[1]:
                raise RuntimeError(f'Expected {expected_error}: {second_out}')
        elif two.returncode:
            raise RuntimeError(second_out[1])
    print(f'PASS {label}: ' + ('actual lock wait; ' if second_waits else 'no lock wait; ')
          + ('rejected safely' if expected_error else 'committed'), flush=True)


# 커밋된 합성 데이터(일회용 DB). 1·4 primary 운영자, 2 고객, 3 owner.
users = ','.join(f"('{uid('user', n)}','authenticated','authenticated','return-address-race-{n}@example.test',now(),'{{}}','{{}}')" for n in (1, 2, 3, 4))
orders = ','.join(f"('{uid('order', n)}','{uid('user', 2)}','delivered',2000,0,'{{}}',now()-interval '4 days',now()-interval '3 days',now()-interval '5 days')"
                  for n in range(1, 5))
items = [(1, 1, 'race-good-a'), (2, 2, 'race-good-a'), (3, 3, 'race-good-a'), (4, 4, 'race-good-a'), (5, 4, 'race-good-b')]
item_rows = ','.join(
    f"('{uid('item', i)}','{uid('order', o)}','{g}',(select id from public.goods_variants where good_id='{g}' and is_default),1,1000,'{g}','문구','race-ip')"
    for i, o, g in items)
shipment_rows = ','.join(
    f"('{uid('shipment', n)}','{uid('order', n)}','{uid('origin', 1)}','RACE 김포',0,'{{}}','delivered','hanjin','RACE{n:08d}',now()-interval '4 days',now()-interval '3 days')"
    for n in range(1, 5))
link_rows = ','.join(f"('{uid('order', o)}','{uid('shipment', o)}','{uid('item', i)}',1)" for i, o, _ in items)
claim_rows = ','.join(f"('{uid('claim', n)}','{uid('order', n)}','{uid('user', 2)}','RACE 반품 {n}','return','requested','change_of_mind')" for n in range(1, 5))
sql(f"""begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) values {users};
update public.profiles set role=case when id='{uid('user', 2)}' then 'user'::public.user_role else 'admin'::public.user_role end
 where id in('{uid('user', 1)}','{uid('user', 2)}','{uid('user', 3)}','{uid('user', 4)}');
insert into private.operator_memberships(profile_id,manager_role) select '{uid('user', 3)}','owner' where not exists(select 1 from private.operator_memberships where manager_role='owner');
insert into private.operator_memberships(profile_id,manager_role) values('{uid('user', 1)}','primary'),('{uid('user', 4)}','primary');
update private.operator_access_state set configured=true where id;
insert into public.ips(id,title,vertical_key) values('race-ip','RACE 반품지','character');
insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active)
 values('{uid('origin', 1)}','race-gimpo','RACE 김포','hanjin',0,'RACE 김포 출고지 반품 주소',true);
insert into public.goods(id,ip_id,name,type,price,stock,stock_qty,origin_id) values
 ('race-good-a','race-ip','RACE A','문구',1000,'ok',20,'{uid('origin', 1)}'),('race-good-b','race-ip','RACE B','문구',1000,'ok',20,'{uid('origin', 1)}');
insert into public.return_addresses(name,address,phone) values('RACE 서울','RACE 서울 반품로 1','02-0000-0000'),
 ('RACE 부산','RACE 부산 반품로 2','051-000-0000'),('RACE 제주','RACE 제주 반품로 3','064-000-0000');
update public.goods set return_address_id=(select id from public.return_addresses where name='RACE 서울') where id='race-good-a';
insert into public.orders(id,user_id,status,total,shipping_fee,address,shipped_at,delivered_at,created_at) values {orders};
insert into public.order_items(id,order_id,good_id,variant_id,qty,unit_price,good_name_snapshot,good_type_snapshot,good_ip_id_snapshot) values {item_rows};
insert into public.order_shipments(id,order_id,origin_id,origin_name_snapshot,shipping_fee,shipping_fee_snapshot,status,carrier,tracking_number,shipped_at,delivered_at) values {shipment_rows};
insert into public.order_shipment_items(order_id,shipment_id,order_item_id,qty) values {link_rows};
insert into public.order_cancellation_requests(id,order_id,requested_by,reason,claim_type,stage,reason_type) values {claim_rows};
select set_config('request.jwt.claim.sub','{uid('user', 1)}',true);
select public.admin_decide_order_claim('{uid('claim', 3)}','approve',null);
select public.admin_decide_order_claim('{uid('claim', 4)}','approve',null);
commit;""")


def snapshot(claim):
    return sql(f"select string_agg(coalesce(p.name,'출고지')||':'||b.return_address_snapshot,',' order by b.return_address_id is not null,b.id) "
               f"from public.order_claim_collection_bundles b left join public.return_addresses p on p.id=b.return_address_id "
               f"where b.claim_id='{uid('claim', claim)}';")


race('policy-before-approval', save_policy('race-good-a', 'RACE 부산'), approve(1))
assert snapshot(1) == 'RACE 부산:RACE 부산 반품로 2', snapshot(1)
race('approval-before-policy', approve(2), save_policy('race-good-a', 'RACE 제주'))
assert snapshot(2) == 'RACE 부산:RACE 부산 반품로 2', snapshot(2)
assert sql("select p.name from public.goods g join public.return_addresses p on p.id=g.return_address_id where g.id='race-good-a';") == 'RACE 제주'
race('address-edit-during-collection', save_address('RACE 서울', 'RACE 서울 이전한 반품로 9'), record_bundle(3, 'RACE 서울', 'RACE 서울 입고', OTHER_ACTOR), second_waits=False)
assert snapshot(3) == 'RACE 서울:RACE 서울 반품로 1', snapshot(3)
assert sql(f"select stage from public.order_cancellation_requests where id='{uid('claim', 3)}';") == 'collected'
race('select-before-delete', save_policy('race-good-b', 'RACE 서울'), delete_address('RACE 서울'), 'return_address_in_use')
assert sql("select count(*) from public.return_addresses where name='RACE 서울';") == '1'
race('two-bundles-one-shipment', record_bundle(4, 'RACE 서울', 'RACE 서울 묶음 입고'), record_bundle(4, None, 'RACE 출고지 묶음 입고'))
assert sql(f"select stage||':'||(collected_at is not null) from public.order_cancellation_requests where id='{uid('claim', 4)}';") == 'collected:true'
assert sql(f"select count(*) from public.order_claim_collections where claim_id='{uid('claim', 4)}' and collected_at is not null;") == '1'
assert sql(f"select count(*) from public.audit_log where action='admin.order.claim_origin_collected' and diff->>'claimId'='{uid('claim', 4)}';") == '2'
assert sql(f"select count(*) from public.notifications where source_id='{uid('claim', 4)}' and dedupe_key like 'claim:collected%';") == '1'
print('PASS snapshots follow the committed order; collection never waits on the address book; one completion per shipment', flush=True)

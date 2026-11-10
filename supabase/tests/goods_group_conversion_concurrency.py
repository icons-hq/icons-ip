"""Observe both serialization orders using real RPCs in one leased clone."""
import json
from pathlib import Path
import os
import re
import subprocess
import sys
import time

container, database, destination = sys.argv[1:]
assert re.fullmatch(r'[0-9a-f]{64}', container)
assert re.fullmatch(r'icons_(?:group_edges|goods_transaction)_[0-9a-f]{32}', database)
out = Path(destination)
out.mkdir(parents=True, exist_ok=True)
cmd = ['docker', 'exec', '-i', container, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1']
def sql(source):
    result = subprocess.run(cmd, input=source, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()
lease = json.loads(sql('select to_jsonb(i) from private.operator_fixture_clone_identity i where singleton;'))
assert lease['container_id'] == container and lease['source_database'] == 'postgres' and lease['lease'].replace('-', '') == database[-32:]
prefix = 'group-race-' + str(os.getpid())
processes = []
cases = []
def uid(n):
    return 'a6150000-0000-4000-8000-' + str(n).zfill(12)
def literal(value):
    return "'" + value.replace("'", "''") + "'"
def actor(n=1):
    return 'select goods_group_edge_test.actor(' + str(n) + ');set local role authenticated;'
def start(label, source, hold=False):
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write("set application_name='" + prefix + '-' + label + "';begin;set local lock_timeout='12s';set local statement_timeout='18s';" + source + ('select pg_sleep(1.5);' if hold else '') + 'commit;')
    process.stdin.close()
    process.stdin = None
    processes.append(process)
    return process
def wait(label, event, process):
    for _ in range(120):
        if sql("select coalesce(wait_event_type,'') from pg_stat_activity where application_name='" + prefix + '-' + label + "';") == event:
            return
        if process.poll() is not None:
            raise RuntimeError(label + ' exited before ' + event + ': ' + str(process.communicate()))
        time.sleep(.02)
    raise RuntimeError(label + ' did not enter ' + event)
def finish(label, process, expected_error=None):
    output, error = process.communicate(timeout=20)
    (out / (label + '.log')).write_text(output + error)
    if expected_error:
        assert process.returncode and expected_error in error, (label, error, output)
    elif process.returncode:
        raise RuntimeError(label + ': ' + error)
    return output.strip()
def race(name, first_sql, second_sql, second_error=None):
    first = start(name + '-first', first_sql, True)
    wait(name + '-first', 'Timeout', first)
    second = start(name + '-second', second_sql)
    wait(name + '-second', 'Lock', second)
    first_result = finish(name + '-first', first)
    second_result = finish(name + '-second', second, second_error)
    cases.append({'case': name, 'observedWaitEventType': 'Lock', 'status': 'PASS'})
    print('PASS ' + name + ': observed Lock wait', flush=True)
    return first_result, second_result
def preview(n, who=1):
    return json.loads(sql('begin;' + actor(who) + 'select goods_group_edge_test.preview(' + str(n) + ',' + str(who) + ');commit;'))['previewId']
def confirm(preview_id, operation, who=1):
    return actor(who) + 'select goods_group_edge_test.confirm(' + literal(preview_id) + ',' + str(operation) + ',' + str(who) + ');'
def adjust(n, operation):
    return actor() + "select public.admin_adjust_stock('" + uid(operation) + "','group-edge-" + str(n) + "','" + uid(1001+n*10) + "',11,1,'TEST 동시 재고 조정');"
def role_change(role, operation):
    rev = json.loads(sql("select jsonb_build_array((select revision from private.operator_memberships where profile_id='" + uid(2) + "'),(select revision from private.operator_access_state where id));"))
    return actor() + "select public.admin_change_operator_role('" + uid(2) + "','" + role + "'," + str(rev[0]) + ',' + str(rev[1]) + ",'" + uid(operation) + "');"
try:
    sql("insert into public.fulfillment_origins(id,code,name,default_carrier,base_fee,return_address,is_active) values('" + uid(90) + "','group-edge-origin','TEST 경합 출고지','hanjin',3000,'TEST 합성 주소',true);update private.goods_transaction_runtime set enabled=true where singleton;")
    for n in range(30, 40):
        sql('select goods_group_edge_test.make_source(' + str(n) + ',' + ('true' if n in (30, 31) else 'false') + ');')
    sql("update public.goods set origin_id='" + uid(90) + "' where id in ('group-edge-30','group-edge-31');")
    address = '{"recipientName":"TEST 수취인","phone":"01000000000","postalCode":"12345","address1":"TEST 합성 주소"}'
    def checkout(n, buyer):
        sql('begin;' + actor(buyer) + "select public.set_cart_item_quantity('group-edge-" + str(n) + "','" + uid(1001+n*10) + "',1);commit;")
        expected = sql("select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,'input_revision',input_revision,'input_values',input_values)) from public.cart_items where user_id='" + uid(buyer) + "';")
        quote = json.loads(sql("set role service_role;select public.quote_cart_goods_transaction('" + uid(buyer) + "'," + literal(expected) + ',' + literal(address) + ",'{}',null,0);"))
        assert quote['state'] == 'quoted', quote
        return "set local role service_role;select public.place_cart_goods_transaction('" + uid(buyer) + "'," + literal(expected) + ',' + literal(address) + ",'" + quote['quoteId'] + "','" + uid(9000+n) + "','card');"
    quote30, quote31 = checkout(30, 3), checkout(31, 4)
    preview30, preview31 = preview(30), preview(31)
    race('checkout-before-conversion', quote30, confirm(preview30, 9030), 'goods_group_source_changed')
    assert sql("select count(*)=1 from public.orders where user_id='" + uid(3) + "' and status='pending';") == 't'
    assert sql("select stock_qty=10 and archived_at is null from public.goods_variants where id='" + uid(1301) + "';") == 't'
    race('conversion-before-checkout', confirm(preview31, 9031), quote31, 'transaction_quote_changed')
    assert sql("select count(*)=0 from public.orders where user_id='" + uid(4) + "';") == 't'
    preview32, preview33 = preview(32), preview(33)
    race('stock-adjust-before-conversion', adjust(32, 9132), confirm(preview32, 9032), 'goods_group_source_changed')
    assert sql("select stock_qty=12 and archived_at is null from public.goods_variants where id='" + uid(1321) + "';") == 't'
    race('conversion-before-stock-adjust', confirm(preview33, 9033), adjust(33, 9133), 'goods_variant_not_found')
    assert sql("select v.stock_qty=11 from private.goods_stock_successors s join public.goods_variants v on v.id=s.target_variant_id where s.source_variant_id='" + uid(1331) + "';") == 't'
    preview34 = preview(34)
    first, second = race('same-preview-same-operation', confirm(preview34, 9034), confirm(preview34, 9034))
    assert json.loads(first) == json.loads(second)
    assert sql("select count(*)=1 from private.goods_group_operations where operation_id='" + uid(9034) + "';") == 't'
    preview35 = preview(35)
    race('same-preview-different-operation', confirm(preview35, 9035), confirm(preview35, 9135), 'goods_group_source_changed')
    assert sql("select count(*)=1 from private.goods_group_operations where operation_id in('" + uid(9035) + "','" + uid(9135) + "');") == 't'
    preview36 = preview(36, 2)
    race('role-revocation-before-conversion', role_change('logistics', 9236), confirm(preview36, 9036, 2), 'operator_capability_required')
    sql('begin;' + role_change('deputy', 9336) + 'commit;')
    preview37 = preview(37, 2)
    race('conversion-before-role-revocation', confirm(preview37, 9037, 2), role_change('logistics', 9237))
    sql('begin;' + role_change('deputy', 9337) + 'commit;')
    preview38 = preview(38, 2)
    race('session-revocation-before-conversion', "delete from auth.sessions where id='" + uid(102) + "';", confirm(preview38, 9038, 2), 'goods_group_auth_changed')
    sql("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values('" + uid(102) + "','" + uid(2) + "',clock_timestamp(),clock_timestamp(),clock_timestamp()+interval '2 hours');")
    preview39 = preview(39, 2)
    race('conversion-before-session-revocation', confirm(preview39, 9039, 2), "delete from auth.sessions where id='" + uid(102) + "';")
    assert sql("select count(*)=0 from private.goods_group_members where good_id in('group-edge-36','group-edge-38');") == 't'
    assert sql("select count(*)=2 from private.goods_group_members where good_id in('group-edge-37','group-edge-39');") == 't'
    (out / 'result.json').write_text(json.dumps({'status': 'PASS', 'cases': cases, 'sourceDatabaseWrites': 0, 'database': database}, ensure_ascii=False, indent=2) + '\n')
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
            process.communicate(timeout=5)
    sql('select goods_group_edge_test.restore_owner();')

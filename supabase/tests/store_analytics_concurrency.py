"""Synthetic traffic races in the wrapper's disposable database only."""
import os
import subprocess
import time
from datetime import datetime

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_store_analytics_concurrency_'):
    raise SystemExit('Use the dedicated disposable wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'analytics-race-{os.getpid()}'
service = "select set_config('request.jwt.claim.role','service_role',true);set local role service_role;"

def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def uid(n):
    return f'bfc02100-0000-4000-8000-{n:012d}'

def record(session, event, kind='home', target='home'):
    return service + f"select public.record_store_analytics_event(repeat('{session}',64),'{uid(event)}','{kind}','{target}','direct','none','none');"

def wait_state(name, expected, process):
    for _ in range(160):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(.025)
    raise RuntimeError(f'{name} never reached {expected}')

def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f'{name}-first', 'Timeout', one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f'{name}-second', 'Lock', two)
    first_out, second_out = one.communicate(timeout=15), two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if expected_error:
        if not two.returncode or expected_error not in second_out[1]:
            raise RuntimeError(f'Expected {expected_error}: {second_out}')
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f'PASS {label}: real lock wait; ' + ('safe rejection' if expected_error else 'committed'))

sql('begin;' + service + "select public.set_store_analytics_collection(true,'analytics-v1');" + ''.join(f"select public.start_store_analytics_session(repeat('{n}',64),'analytics-v1');" for n in range(1,7)) + 'commit;')
race('same-event', record(1,101), record(1,101))
assert sql(f"select count(*) from private.store_analytics_events where id='{uid(101)}';") == '1'
race('payload-conflict', record(1,102), record(1,102,'shop','all'), 'analytics_event_conflict')
race('cross-session-id', record(1,103), record(2,103), 'duplicate key value')
assert sql("select event_count from private.store_analytics_sessions where token_hash=repeat('2',64);") == '0'
race('revoke-before-record', service + "select public.revoke_store_analytics_session(repeat('2',64));", record(2,104), 'analytics_session_unavailable')
race('record-before-revoke', record(3,105), service + "select public.revoke_store_analytics_session(repeat('3',64));")
assert sql(f"select count(*) from private.store_analytics_events where id='{uid(105)}';") == '0'
race('disable-before-record', service + "select public.set_store_analytics_collection(false,'analytics-v1');", record(4,106), 'analytics_disabled')
sql('begin;' + service + "select public.set_store_analytics_collection(true,'analytics-v1');commit;")
# Same minute row is precreated; both transactions wait on the same session.
while datetime.now().second > 54:
    time.sleep(.25)
sql("insert into private.store_analytics_rate_buckets(bucket,scope,requests) select date_trunc('minute',clock_timestamp()),'session:'||id::text,119 from private.store_analytics_sessions where token_hash=repeat('4',64);")
race('session-rate', record(4,107), record(4,108), 'analytics_rate_limited')
assert sql(f"select count(*) from private.store_analytics_events where id in('{uid(107)}','{uid(108)}');") == '1'
# Binding can never be moved to a competing session for the same owner/order.
sql(f"""begin;
insert into auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('{uid(1)}','authenticated','authenticated','analytics-race@example.test','{{}}','{{}}',now(),now());
{record(5,109)}reset role;
insert into public.orders(id,user_id,status,total,shipping_fee,address,payment_method,created_at,expires_at)
values('{uid(201)}','{uid(1)}','pending',1000,0,'{{"recipientName":"Synthetic","phone":"01000000000","postalCode":"00000","address1":"Synthetic only","address2":"Test"}}','card',clock_timestamp(),clock_timestamp()+interval '15 minutes');commit;""")
def bind(session):
    return service + f"select public.bind_store_analytics_order(repeat('{session}',64),'{uid(201)}','{uid(1)}');"
race('immutable-order-binding', bind(1), bind(5), 'analytics_order_binding_conflict')
assert sql(f"select count(*) from private.store_analytics_order_bindings where order_id='{uid(201)}';") == '1'
print('PASS final readback: no duplicate visit, no revoked event, one immutable order binding')

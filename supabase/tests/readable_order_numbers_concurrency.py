"""Concurrent allocation in an explicitly isolated local/CI database only."""
import concurrent.futures
import os
import re
import subprocess

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
scope = os.environ['READABLE_ORDER_TEST_SCOPE']
if scope == 'ci':
    assert os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
    assert container == 'supabase_db_icons-ip' and database == 'postgres'
else:
    assert scope == 'isolated-local'
    assert re.fullmatch(r'icons_order_excel_[a-f0-9]{32}', database)
    assert re.fullmatch(r'[a-f0-9]{64}', container)

def sql(statement):
    return subprocess.check_output(['docker', 'exec', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database,
                                    '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], text=True).strip()

assert sql("select count(*) from private.commerce_number_counters where business_date in ('2099-12-30','2099-12-31') and kind=1") == '0'
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        numbers = list(pool.map(lambda _: sql("select private.next_commerce_number('2099-12-30T15:00:00Z',1::smallint)"), range(64)))
    assert len(set(numbers)) == 64
    assert sorted(numbers) == ['209912311' + str(n).zfill(7) for n in range(1, 65)]
    print('64 concurrent database allocations: unique, consecutive and correct KST date')
    # 주문 시각을 넣은 20자리 발급(order_number_time.sql)도 같은 날짜 카운터를 원자적으로 나눠 쓴다.
    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        timed = list(pool.map(lambda _: sql("select private.next_timed_order_number('2099-12-29T15:04:00Z')"), range(64)))
    assert len(set(timed)) == 64
    assert sorted(timed) == ['2099123000041' + str(n).zfill(7) for n in range(1, 65)]
    print('64 concurrent timed allocations: unique, consecutive, KST date and HHMI')
finally:
    sql("delete from private.commerce_number_counters where business_date in ('2099-12-30','2099-12-31') and kind=1")

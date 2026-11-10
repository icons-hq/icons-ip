"""Exercise first-selection, mutation and purchase-invalidation locks in a clone."""
import json
import os
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_review_best_concurrency_'):
    raise SystemExit('Use the disposable review BEST wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'review-best-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(number, kind=0):
    return f'93500000-0000-4000-{8000 + kind:04d}-{number:012d}'


def actor(number=2):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"


def start(label, statements, delay=0):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local lock_timeout='8s';{statements}" + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close(); process.stdin = None
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
    result = process.communicate(timeout=15)
    if expected_error:
        if not process.returncode or expected_error not in result[1]:
            raise RuntimeError(f'Expected {expected_error}: {result}')
    elif process.returncode:
        raise RuntimeError(result[1])
    return result


def race(label, first, second, expected_error=None):
    one = start(label + '-first', first, 1.5)
    wait_state(label + '-first', 'Timeout', one)
    two = start(label + '-second', second)
    wait_state(label + '-second', 'Lock', two)
    finish(one); finish(two, expected_error)
    print(f'PASS {label}: actual lock wait; {expected_error or "committed"}', flush=True)


root = Path(__file__).parent
fixture = (root / 'review_best.sql').read_text().split('select 1/case when not has_table_privilege')[0]
fixture = fixture.replace('begin;', '', 1).replace("load 'safeupdate';", '', 1).replace('pg_temp.', 'review_best_test.')
kc = (root / 'helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.', 'review_best_test.')
sql('begin;create schema review_best_test;' + kc + fixture + f"reset role;update private.operator_memberships set manager_role='owner' where profile_id='{uid(1)}' and not exists(select 1 from private.operator_memberships where manager_role='owner');select set_config('request.jwt.claim.sub','',true);commit;")


def new_review(number):
    review = sql(f'select review_best_test.best_order({number},1);')
    fingerprint = sql(f"select private.review_event_review_fingerprint(r) from public.reviews r where id='{review}';")
    return review, fingerprint


def select_review(value, operation, revision=0):
    review, fingerprint = value
    return actor() + f"select public.admin_set_review_best('{review}',true,'구체적인 구매 경험 선정',{revision},'{fingerprint}','{uid(operation)}');"


def refund(number):
    return f"update public.payments set status='refunded' where id='{uid(number,2)}';"


def needs_review(value):
    review, _ = value
    return sql(f"select private.review_best_state(r)->>'state' from public.reviews r where id='{review}';") == 'needs_review'


value = new_review(21)
race('same-operation', select_review(value, 1021), select_review(value, 1021))
assert sql(f"select revision=1 from private.review_best_selections where review_id='{value[0]}';") == 't'
value = new_review(22)
race('competing-selection', select_review(value, 1022), select_review(value, 2022), 'best_review_revision_conflict')
value = new_review(23)
race('edit-before-selection', f"update public.reviews set body='선정 전에 바뀐 합성 원문' where id='{value[0]}';", select_review(value, 1023), 'best_review_changed')
value = new_review(24)
race('selection-before-edit', select_review(value, 1024), f"update public.reviews set body='선정 뒤 바뀐 합성 원문' where id='{value[0]}';")
assert needs_review(value)
value = new_review(25)
race('selection-before-hide', select_review(value, 1025), f"update public.reviews set status='hidden',hidden_reason='합성 비공개',hidden_at=now() where id='{value[0]}';")
assert needs_review(value)
value = new_review(26)
race('refund-before-first-selection', refund(26), select_review(value, 1026), 'purchase_ineligible')
value = new_review(27)
race('selection-before-refund', select_review(value, 1027), refund(27))
assert needs_review(value)
sql(f"update public.payments set status='paid' where id='{uid(27,2)}';")
assert needs_review(value)
value = new_review(28)
race('return-before-first-selection', f"insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,status,stage) values('{uid(28,1)}','{uid(7)}','합성 반품 완료','return','completed','completed');", select_review(value, 1028), 'purchase_ineligible')

# Reproduce the reviewed gap precisely: hold BEFORE the first INSERT, after
# eligibility checked. Only this disposable clone gets the synthetic trigger.
value = new_review(29)
sql("create function review_best_test.pause_first() returns trigger language plpgsql as $$begin perform pg_advisory_xact_lock(935099);return new;end$$;create trigger test_pause_first_best before insert on private.review_best_selections for each row execute function review_best_test.pause_first();")
holder = start('barrier', 'select pg_advisory_xact_lock(935099);', 2.0)
wait_state('barrier', 'Timeout', holder)
selector = start('first-insert', select_review(value, 1029))
wait_state('first-insert', 'Lock', selector)
refunder = start('first-refund', refund(29))
wait_state('first-refund', 'Lock', refunder)
finish(holder); finish(selector); finish(refunder)
sql(f"update public.payments set status='paid' where id='{uid(29,2)}';")
assert needs_review(value)
assert sql(f"select invalidated_at is not null from private.review_best_selections where review_id='{value[0]}';") == 't'
print('PASS first INSERT barrier: refund waits and restoration still requires reselection', flush=True)
sql('drop trigger test_pause_first_best on private.review_best_selections;')
value = new_review(30)
race('role-revoked', f"select private.lock_operator_subjects(array['{uid(2)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid(2)}';", select_review(value, 1030), 'operator_capability_required')
print(json.dumps({'cases': 10, 'database': database, 'financialLedgerWrites': 'only disposable synthetic fixtures'}, ensure_ascii=False), flush=True)

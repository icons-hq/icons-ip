"""Real lock waits for event payouts and source-review/order reversals in a clone."""
import json
import os
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_review_events_concurrency_'):
    raise SystemExit('Use the disposable review events wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'review-events-{os.getpid()}'


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(number, kind=0):
    return f'92000000-0000-4000-{8000 + kind:04d}-{number:012d}'


def actor(number=1):
    return f"select set_config('request.jwt.claim.sub','{uid(number)}',true);set local role authenticated;"


def publish(case, operation=None, who=1):
    return actor(who) + f"select public.admin_publish_review_event('{uid(200+case)}',2,'{uid(operation or 2000+case)}');"


def wait_state(name, expected, process):
    for _ in range(140):
        if sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';") == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f'{name} exited before {expected}: {process.communicate()}')
        time.sleep(0.025)
    raise RuntimeError(f'{name} never reached {expected}')


def race(label, first, second, expected_error=None):
    name = f'{prefix}-{label}'
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"load 'safeupdate';set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);reset role;insert into review_event_test.releases values('{label}',clock_timestamp());commit;")
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
if sql("select to_regprocedure('public.admin_publish_review_event(uuid,integer,uuid)') is null;") == 't':
    sql((root / 'migrations/20261020085245_review_events.sql').read_text())
fixture = Path(__file__).with_name('review_events.sql').read_text()
base = fixture[fixture.index('create function pg_temp.review_event_error'):fixture.index("select public.admin_save_review_event('92000000-0000-4000-8000-000000000101'")].replace('delete from private.operator_memberships;', 'delete from private.operator_memberships where true;')
helper = fixture[fixture.index('create function pg_temp.review_event_order'):fixture.index('select pg_temp.review_event_order(1,8')]
kc = (root / 'tests/helpers/goods_kc_fixture.sql').read_text().replace('pg_temp.', 'review_event_test.')
sql('begin;create schema review_event_test;grant usage,create on schema review_event_test to authenticated;' + kc + base.replace('pg_temp.', 'review_event_test.') + 'reset role;' + helper.replace('pg_temp.', 'review_event_test.') + 'commit;')
sql('create table review_event_test.releases(label text primary key,released_at timestamptz);')


def case(number):
    event = uid(200+number)
    sql(f"""begin;
    insert into private.review_events(id,title,description,target_type,starts_on,ends_on,announces_on,planned_winners,credit_amount,credit_validity_days,banner_style,created_by)
    values('{event}','동시성 합성 {number}','실제 잠금 대기 검증','goods',current_date-1,current_date+1,current_date+4,1,1000,10,'basic','{uid(1)}');
    insert into private.review_event_goods values('{event}','review-event-good-1');
    select review_event_test.review_event_order({100+number},8,1,1);
    update private.review_events set starts_on=current_date-5,ends_on=current_date-3,announces_on=current_date where id='{event}';
    select jsonb_agg(jsonb_build_object('id',entry.id,'reviewUpdatedAt',review.updated_at,'reviewFingerprint',private.review_event_review_fingerprint(review))) as entries
    from private.review_event_entries entry join public.reviews review on review.id=entry.review_id where entry.event_id='{event}' \\gset
    {actor()}select public.admin_select_review_event_entries('{event}',1,gen_random_uuid(),:'entries','별점과 무관한 구체적인 사용 후기');commit;""")
    return event


def hide(number):
    return f"update public.reviews set status='hidden',hidden_reason='합성 비공개',hidden_at=now() where order_id='{uid(100+number, 1)}';"


def refund(number):
    return f"update public.payments set status='refunded' where id='{uid(100+number, 2)}';"


def returned(number):
    return f"insert into public.order_cancellation_requests(order_id,requested_by,reason,claim_type,status,stage) values('{uid(100+number, 1)}','{uid(8)}','합성 반품 완료','return','completed','completed');"


def revoked(number):
    return sql(f"select count(*) from private.review_event_awards where event_id='{uid(200+number)}' and revoked_at is not null;")


case(1)
race('account-wait-validity', f"select private.lock_store_credit_account('{uid(8)}');", publish(1))
assert sql(f"select e.announced_at>=r.released_at and a.granted_at=e.announced_at and a.expires_at=e.announced_at+interval '10 days' from private.review_events e join private.review_event_awards a on a.event_id=e.id cross join review_event_test.releases r where e.id='{uid(201)}' and r.label='account-wait-validity';") == 't'
print('PASS announcement, grant time and full validity begin after account lock release', flush=True)
case(2)
race('same-operation', publish(2), publish(2))
case(3)
race('competing-publishers', publish(3), publish(3, 3003), 'review_event_changed')
case(4)
race('hidden-before-publish', hide(4), publish(4), 'review_event_entry_ineligible')
case(5)
race('publish-before-hidden', publish(5), hide(5))
assert revoked(5) == '1'
case(6)
race('refund-before-publish', refund(6), publish(6), 'review_event_entry_ineligible')
case(7)
race('publish-before-refund', publish(7), refund(7))
assert revoked(7) == '1'
case(8)
race('return-before-publish', returned(8), publish(8), 'review_event_entry_ineligible')
case(9)
race('publish-before-return', publish(9), returned(9))
assert revoked(9) == '1'
case(10)
race('review-edit-before-publish', f"update public.reviews set body='선정 이후 본문 수정' where order_id='{uid(110,1)}';", publish(10), 'review_event_review_changed')
case(11)
race('role-revoke-before-publish', f"select private.lock_operator_subjects(array['{uid(2)}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{uid(2)}';", publish(11, who=2), 'operator_capability_required')
case(12)
sql('begin;' + publish(12) + 'commit;')
entry = sql(f"select entry_id from private.review_event_awards where event_id='{uid(212)}';")
race('manual-revoke-before-hidden', actor() + f"select public.admin_revoke_review_event_award('{entry}','{uid(4012)}','합성 수동 회수');", hide(12))
assert revoked(12) == '1'
assert sql(f"select count(*) from public.audit_log where action='review_event.reward.reversed' and target='review_event_entry:{entry}';") == '1'
assert sql(f"select count(*) from private.review_event_awards where event_id='{uid(202)}';") == '1'
assert sql("select count(*) from private.review_event_awards a join private.store_credit_lots l on l.id=a.lot_id where a.revoked_at is not null and (l.available_amount<>0 or l.debt_amount<>0);") == '0'
assert sql("select count(*) from private.store_credit_lots where root_lot_id in(select lot_id from private.review_event_awards) and available_amount+reserved_amount+spent_amount+expired_amount+revoked_amount+offset_amount+transferred_amount<>issued_amount;") == '0'
print('PASS exact award conservation, one payout/reversal receipt, and no surviving invalid rewards', flush=True)

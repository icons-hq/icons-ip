"""Real overlapping sessions for single-reply CAS, receipts and authority fences."""
import json
import os
from pathlib import Path
import subprocess
import time

container = os.environ['SUPABASE_DB_CONTAINER']
database = os.environ['PGDATABASE']
if not database.startswith('icons_cs_single_reply_concurrency_'):
    raise SystemExit('Use the disposable single-reply wrapper')
command = ['docker', 'exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', database, '-v', 'ON_ERROR_STOP=1', '-qAt']
prefix = f'csr{os.getpid()}'
actor_id = '00000000-0000-4000-8000-000000063501'
buyer_id = '00000000-0000-4000-8000-000000063503'
other_actor_id = '00000000-0000-4000-8000-000000063502'
checks = []


def sql(statement):
    result = subprocess.run(command, input="load 'safeupdate';" + statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(number):
    return f'97500000-0000-4000-8000-{number:012d}'


def actor(identifier=actor_id):
    return f"select set_config('request.jwt.claim.sub','{identifier}',true);set local role authenticated;"


def start(label, statements, delay=0):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local lock_timeout='8s';{statements}" + (f'select pg_sleep({delay});' if delay else '') + 'commit;')
    process.stdin.close(); process.stdin = None
    return process


def hold(label, statements):
    process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    process.stdin.write(f"load 'safeupdate';set application_name='{prefix}-{label}';begin;set local lock_timeout='8s';{statements}select 1;\n")
    process.stdin.flush()
    return process


def release(process):
    process.stdin.write('commit;\n'); process.stdin.close(); process.stdin = None


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
    one = hold(label + '-first', first)
    wait_state(label + '-first', 'Client', one)
    two = start(label + '-second', second)
    wait_state(label + '-second', 'Lock', two)
    release(one)
    first_result = finish(one); second_result = finish(two, expected_error)
    checks.append({'case': label, 'observedLockWait': True, 'outcome': expected_error or 'committed'})
    print(f'PASS {label}: actual lock wait; {expected_error or "committed"}', flush=True)
    return first_result, second_result


root = Path(__file__).parent
fixture = (root / 'cs_single_reply_cas.sql').read_text().split('create temp table single_reply_receipts')[0].replace('begin;', '', 1)
sql('begin;' + fixture + 'commit;')


def target(surface, number):
    identifier = uid(number)
    if surface == 'product_question':
        sql(f"insert into public.product_questions(id,good_id,user_id,body) values('{identifier}','cs-single-reply','{buyer_id}','경합 검증 합성 상품 문의입니다.');")
    else:
        order = uid(number + 10000)
        sql(f"insert into public.orders(id,user_id,status,total,address,delivered_at) values('{order}','{buyer_id}','delivered',1000,'{{}}',now());insert into public.reviews(id,user_id,good_id,order_id,rating,body) values('{identifier}','{buyer_id}','cs-single-reply','{order}',5,'경합 검증 합성 리뷰입니다.');")
    return identifier


def save(surface, identifier, operation, expected=0, body='경합 검증 운영자 답변입니다.', owner=actor_id):
    return actor(owner) + f"select public.admin_save_cs_reply('{uid(operation)}','{owner}','{surface}','{identifier}','{body}',{expected});"


def assert_once(surface, identifier):
    action = 'product_question.answer' if surface == 'product_question' else 'admin.review.reply'
    target_name = 'product_questions:' if surface == 'product_question' else 'review:'
    assert sql(f"select count(*) from public.audit_log where action='{action}' and target='{target_name}{identifier}';") == '1'
    assert sql(f"select count(*) from public.notifications where source_id='{identifier}';") == '1'
    table = 'product_questions' if surface == 'product_question' else 'reviews'
    assert sql(f"select reply_source_revision from public.{table} where id='{identifier}';") == '1'


for surface, base in [('product_question', 100), ('review', 200)]:
    table = 'product_questions' if surface == 'product_question' else 'reviews'
    identifier = target(surface, base + 1)
    race(surface + '-different-operation', save(surface, identifier, base + 1000), save(surface, identifier, base + 2000, body='다른 운영자가 쓰는 답변입니다.', owner=other_actor_id), 'cs_reply_source_changed')
    assert_once(surface, identifier)
    identifier = target(surface, base + 2)
    first, second = race(surface + '-same-operation', save(surface, identifier, base + 1001), save(surface, identifier, base + 1001))
    assert next(line for line in first[0].splitlines() if line.startswith('{')) == next(line for line in second[0].splitlines() if line.startswith('{'))
    assert_once(surface, identifier)
    identifier = target(surface, base + 3)
    race(surface + '-stale-same-body', save(surface, identifier, base + 1002), save(surface, identifier, base + 2002, owner=other_actor_id), 'cs_reply_source_changed')
    assert_once(surface, identifier)
    identifier = target(surface, base + 4)
    race(surface + '-source-edit', f"update public.{table} set body='먼저 변경된 합성 고객 원문입니다.' where id='{identifier}';", save(surface, identifier, base + 1003), 'cs_reply_source_changed')
    identifier = target(surface, base + 5)
    hiding = "status='hidden'" if surface == 'product_question' else "status='hidden',hidden_reason='합성 블라인드',hidden_at=now()"
    race(surface + '-source-hide', f"update public.{table} set {hiding} where id='{identifier}';", save(surface, identifier, base + 1004), 'cs_reply_source_changed')
    identifier = target(surface, base + 6)
    race(surface + '-source-delete', f"delete from public.{table} where id='{identifier}';", save(surface, identifier, base + 1005), 'cs_reply_target_not_found')
    identifier = target(surface, base + 7)
    race(surface + '-metadata-only', f"update public.{table} set updated_at=clock_timestamp() where id='{identifier}';", save(surface, identifier, base + 1006))
    assert_once(surface, identifier)
    identifier = target(surface, base + 8)
    # Delay the original request BEFORE RPC entry (and its account fence). A
    # lookup can see no receipt while that original request is still queued.
    operation = uid(base + 1007)
    label = surface + '-delayed-original'
    holder = hold(label + '-barrier', f"select pg_advisory_xact_lock(hashtextextended('test_cs_before_entry:{operation}',0));")
    wait_state(label + '-barrier', 'Client', holder)
    original = start(label + '-original', f"select pg_advisory_xact_lock(hashtextextended('test_cs_before_entry:{operation}',0));" + save(surface, identifier, base + 1007))
    wait_state(label + '-original', 'Lock', original)
    missing = sql('begin;' + actor() + f"select public.admin_cs_reply_operation('{operation}','{actor_id}','{surface}','{identifier}','경합 검증 운영자 답변입니다.',0) is null;commit;")
    assert missing.splitlines()[-1] == 't'
    replay = start(label + '-retry', save(surface, identifier, base + 1007))
    second = finish(replay)
    assert original.poll() is None, 'The first request must still be delayed before entry'
    release(holder); finish(holder); first = finish(original)
    assert next(line for line in first[0].splitlines() if line.startswith('{')) == next(line for line in second[0].splitlines() if line.startswith('{'))
    assert_once(surface, identifier)
    checks.append({'case': label, 'observedLockWait': True, 'missingReceiptBeforeCommit': True, 'outcome': 'one write, identical receipts'})
    print(f'PASS {label}: absent receipt, delayed original, exact retry, one write', flush=True)
    identifier = target(surface, base + 9)
    race(surface + '-role-revoked', f"select private.lock_operator_subjects(array['{actor_id}'::uuid]);update private.operator_memberships set manager_role='logistics' where profile_id='{actor_id}';", save(surface, identifier, base + 1008), 'operator_capability_required')
    sql(f"update private.operator_memberships set manager_role='primary' where profile_id='{actor_id}';")

# BEST metadata has its own ledger and cannot create a reply-source conflict.
identifier = target('review', 301)
sql(f"insert into private.review_best_selections(review_id,selected,reason) values('{identifier}',false,'독립 BEST 상태 검증');")
holder = hold('best-independent', f"update private.review_best_selections set reason='다른 BEST 검토 메모',revision=revision+1 where review_id='{identifier}';")
wait_state('best-independent', 'Client', holder)
writer = start('reply-independent', save('review', identifier, 1301))
finish(writer)
assert holder.poll() is None, 'BEST transaction must still hold its independent row lock'
release(holder); finish(holder)
checks.append({'case': 'review-best-independent', 'noSharedRowLock': True, 'outcome': 'reply committed while BEST metadata lock held'})
print('PASS review-best-independent: reply commits during held BEST metadata lock', flush=True)
assert_once('review', identifier)
print(json.dumps({'cases': len(checks), 'database': database, 'checks': checks}, ensure_ascii=False), flush=True)

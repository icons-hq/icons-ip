"""Controlled concurrent transactions, called only by the owned-clone runner."""
import os
import signal
import subprocess
import time
import uuid


def main(cid, db, out, own, run, sql, quote):
    own()
    cases, children = [], []

    def check(value, message):
        if not value:
            raise RuntimeError(message)

    def start(body, name, hold=False):
        own()
        app = 'satisfaction_' + name + '_' + uuid.uuid4().hex[:8]
        child = subprocess.Popen(['docker', 'exec', '-i', cid, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', db, '-v', 'ON_ERROR_STOP=1'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
        children.append(child)
        child.stdin.write('set application_name=' + quote(app) + ";set statement_timeout='15s';set lock_timeout='12s';\n" + body + '\n')
        child.stdin.flush()
        if not hold:
            child.stdin.close()
            child.stdin = None
        return child, app

    def state(app, wanted):
        deadline = time.monotonic() + 8
        actual = ''
        while time.monotonic() < deadline:
            own()
            actual = sql(cid, db, "select coalesce(state,'')||'|'||coalesce(wait_event_type,'') from pg_stat_activity where datname=" + quote(db) + ' and application_name=' + quote(app))
            if wanted(actual):
                return actual
            time.sleep(.04)
        raise RuntimeError('Expected lock state absent ' + app + ':' + actual)

    def finish(child, label, expected=None):
        stdout, stderr = child.communicate(timeout=18)
        (out / ('race-' + label + '.log')).write_text(stdout + stderr)
        if expected:
            check(child.returncode != 0 and expected in stderr, label + ': expected ' + expected)
        else:
            check(child.returncode == 0, label + ': unexpected SQL failure; inspect log')
        return stdout

    def release(child, sql_body='commit;'):
        child.stdin.write(sql_body + '\n')
        child.stdin.close()
        child.stdin = None

    def request(n, op, answer, revision, desire='satisfied', reader=False):
        name = 'read_my_inquiry_satisfaction_operation' if reader else 'set_my_inquiry_satisfaction'
        return 'select public.' + name + '(satisfaction_test.id(%d),satisfaction_test.id(%d),satisfaction_test.id(2),satisfaction_test.id(102),%s,%d,%s);' % (
            op, 200 + n, answer, revision, 'null' if desire is None else quote(desire))

    def customer(body, end=True):
        return 'begin;select satisfaction_test.actor(2);set local role authenticated;' + body + ('commit;' if end else '')

    def answer(n):
        return "select public.admin_answer_inquiry(satisfaction_test.id(%d),'합성 경합 답변','{}');" % (200 + n)

    def admin(body, end=True):
        return 'begin;select satisfaction_test.actor(1);set local role authenticated;' + body + ('commit;' if end else '')

    def context(n):
        return sql(cid, db, 'select private.inquiry_satisfaction_current(satisfaction_test.id(%d))::text' % (200 + n))

    try:
        # Replaying one pending request waits, then reads its immutable receipt.
        req = request(1, 801, 'satisfaction_test.id(401)', 0)
        first, first_app = start(customer(req, False), 'same-op-first', True)
        state(first_app, lambda value: value.startswith('idle in transaction|'))
        second, second_app = start(customer(req), 'same-op-second')
        observed = state(second_app, lambda value: value.endswith('|Lock'))
        release(first); finish(first, 'same-op-first'); finish(second, 'same-op-second')
        check(sql(cid, db, "select count(*) from private.inquiry_satisfaction_operations where operation_id=satisfaction_test.id(801)") == '1', 'duplicate operation receipt')
        check(sql(cid, db, "select count(*) from public.audit_log where action='inquiry.satisfaction.changed' and diff->>'operationId'=satisfaction_test.id(801)::text") == '1', 'duplicate operation audit')
        cases.append(dict(name='same_operation_wait_and_replay', observed=observed, result='PASS'))

        req = request(1, 802, 'satisfaction_test.id(401)', 1, 'dissatisfied')
        first, app = start(customer(req, False), 'pending-write', True)
        state(app, lambda value: value.startswith('idle in transaction|'))
        reader, reader_app = start(customer(request(1, 802, 'satisfaction_test.id(401)', 1, 'dissatisfied', True)), 'pending-read')
        observed = state(reader_app, lambda value: value.endswith('|Lock'))
        release(first); finish(first, 'pending-write')
        result = finish(reader, 'pending-read')
        check('"operation": "completed"' in result and '"operation": "unresolved"' not in result, 'pending receipt falsely unresolved')
        cases.append(dict(name='receipt_waits_for_pending_commit', observed=observed, result='PASS'))

        # Staff obtains the parent first; a customer gets a retry, then stale-answer rejection.
        first, app = start(admin(answer(2), False), 'reply-first', True)
        state(app, lambda value: value.startswith('idle in transaction|'))
        writer, _ = start(customer(request(2, 803, 'satisfaction_test.id(402)', 0)), 'rating-behind-reply')
        finish(writer, 'rating-behind-reply', 'inquiry_satisfaction_retry')
        release(first); finish(first, 'reply-first')
        writer, _ = start(customer(request(2, 803, 'satisfaction_test.id(402)', 0)), 'stale-answer')
        finish(writer, 'stale-answer', 'inquiry_satisfaction_answer_changed')
        cases.append(dict(name='reply_before_rating', result='PASS'))

        # Customer obtains the parent first; established staff writer waits and resets only current state.
        first, app = start(customer(request(3, 804, 'satisfaction_test.id(403)', 0), False), 'rating-first', True)
        state(app, lambda value: value.startswith('idle in transaction|'))
        staff, staff_app = start(admin(answer(3)), 'reply-behind-rating')
        observed = state(staff_app, lambda value: value.endswith('|Lock'))
        release(first); finish(first, 'rating-first'); finish(staff, 'reply-behind-rating')
        check('"value": null' in context(3), 'new reply inherited an old rating')
        check(sql(cid, db, 'select count(*) from private.inquiry_satisfaction_operations where operation_id=satisfaction_test.id(804)') == '1', 'reply removed prior receipt')
        cases.append(dict(name='rating_before_reply', observed=observed, result='PASS'))

        # Two independent tabs use the same CAS snapshot; only the first operation may mutate.
        first, app = start(customer(request(4, 805, 'satisfaction_test.id(404)', 0), False), 'two-tabs-first', True)
        state(app, lambda value: value.startswith('idle in transaction|'))
        second, second_app = start(customer(request(4, 806, 'satisfaction_test.id(404)', 0, 'dissatisfied')), 'two-tabs-second')
        observed = state(second_app, lambda value: value.endswith('|Lock'))
        release(first); finish(first, 'two-tabs-first'); finish(second, 'two-tabs-second', 'inquiry_satisfaction_revision_conflict')
        cases.append(dict(name='two_tab_revision_conflict_on_closed_inquiry', observed=observed, result='PASS'))

        # Transaction start time is not insertion order. A genuinely older transaction replies last.
        early, early_app = start(admin('select now();', False), 'older-transaction', True)
        state(early_app, lambda value: value.startswith('idle in transaction|'))
        newer, _ = start(admin(answer(2)), 'newer-transaction')
        finish(newer, 'newer-transaction')
        release(early, answer(2) + 'commit;'); finish(early, 'older-transaction')
        check(sql(cid, db, 'select s.latest_answer_id<>(select id from public.inquiry_messages where inquiry_id=s.inquiry_id and author=\'staff\' order by created_at desc,id desc limit 1) from private.inquiry_satisfaction_state s where s.inquiry_id=satisfaction_test.id(202)') == 't', 'head relied on transaction timestamp maximum')
        cases.append(dict(name='actual_staff_insert_order_over_transaction_time', result='PASS'))

        def identity_race(label, change, expected):
            blocker, app = start('begin;' + change + ';select 1;', label + '-block', True)
            state(app, lambda value: value.startswith('idle in transaction|'))
            worker, _ = start(customer(request(1, 810, 'satisfaction_test.id(401)', 2)), label + '-write')
            finish(worker, label + '-retry', 'inquiry_satisfaction_retry')
            release(blocker); finish(blocker, label + '-commit')
            worker, _ = start(customer(request(1, 810, 'satisfaction_test.id(401)', 2)), label + '-after')
            finish(worker, label + '-after', expected)
            cases.append(dict(name=label, result='PASS'))

        identity_race('provider_ban', "update auth.users set banned_until=now()+interval '1 hour' where id=satisfaction_test.id(2)", 'inquiry_satisfaction_account_unavailable')
        run('update auth.users set banned_until=null where id=satisfaction_test.id(2);', 'restore-synthetic-ban')
        identity_race('session_revoke', 'delete from auth.sessions where id=satisfaction_test.id(102)', 'inquiry_satisfaction_auth_required')
        run("insert into auth.sessions(id,user_id,created_at,updated_at,not_after) values(satisfaction_test.id(102),satisfaction_test.id(2),now(),now(),now()+interval '1 hour');", 'restore-synthetic-session')

        # The production account-fence key must precede inquiry locks in the customer writer.
        change = "select private.lock_account_action_subject(satisfaction_test.id(2));insert into private.account_deletion_requests(deletion_event_id,subject_user_id,idempotency_key,status) values(satisfaction_test.id(911),satisfaction_test.id(2),satisfaction_test.id(912),'awaiting_email_intent');insert into private.account_action_fences(subject_user_id,deletion_event_id) values(satisfaction_test.id(2),satisfaction_test.id(911));"
        blocker, app = start('begin;' + change + 'select 1;', 'fence-block', True)
        state(app, lambda value: value.startswith('idle in transaction|'))
        writer, writer_app = start(customer(request(1, 811, 'satisfaction_test.id(401)', 2)), 'fence-write')
        observed = state(writer_app, lambda value: value.endswith('|Lock'))
        release(blocker); finish(blocker, 'fence-commit'); finish(writer, 'fence-write', 'inquiry_satisfaction_account_unavailable')
        check(sql(cid, db, 'select count(*) from private.inquiry_satisfaction_operations where operation_id in(satisfaction_test.id(810),satisfaction_test.id(811))') == '0', 'late identity write survived')
        cases.append(dict(name='account_fence_prevents_late_write', observed=observed, result='PASS'))
        return dict(status='PASS', cases=cases)
    finally:
        for child in children:
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    child.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(child.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    child.communicate(timeout=5)

"""Run only against a disposable database restored with all app migrations.

Example: SUPABASE_DB_CONTAINER=<local container> \
PGDATABASE=icons_operator_invite_concurrency_<suffix> python3 <this file>
No provider calls are made. The database is deliberately left for readback.
"""
import hashlib
import json
import os
import subprocess
import time

container = os.environ["SUPABASE_DB_CONTAINER"]
database = os.environ["PGDATABASE"]
if not database.startswith("icons_operator_invite_concurrency_"):
    raise SystemExit("Use a dedicated icons_operator_invite_concurrency_ database")
command = ["docker", "exec", "-i", container, "psql", "-X", "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAt"]
prefix = f"op-invite-{os.getpid()}"


def sql(statement):
    result = subprocess.run(command, input=statement, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def uid(n, kind="90"):
    return f"{kind}000000-0000-4000-8000-{n:012d}"


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def entry(n):
    return {"id": uid(n, "91"), "email": f"invitation-race-{n}@example.test", "name": f"Synthetic {n}", "managerRole": "deputy", "duty": "cs",
            "tokenHash": digest(f"synthetic-token-{n}"), "sourceDigest": digest(f"synthetic-source-{n}"), "recipientDigest": digest(f"synthetic-recipient-{n}")}


def json_sql(value):
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def actor(n):
    return f"select set_config('request.jwt.claim.sub','{uid(n)}',true);set local role authenticated;"


def accept(n, op):
    return f"select public.accept_operator_invitation('{digest(f'synthetic-token-{n}')}','{uid(op, '92')}');"


def wait_state(name, expected, process):
    for _ in range(100):
        state = sql(f"select coalesce(wait_event_type,'') from pg_stat_activity where application_name='{name}';")
        if state == expected:
            return
        if process.poll() is not None:
            raise RuntimeError(f"{name} ended before {expected}: {process.communicate()}")
        time.sleep(0.025)
    raise RuntimeError(f"{name} did not reach {expected}")


def race(label, first, second, second_error=None):
    name = f"{prefix}-{label}"
    one = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    one.stdin.write(f"set application_name='{name}-first';begin;set local lock_timeout='8s';{first}select pg_sleep(1.5);commit;")
    one.stdin.close()
    one.stdin = None
    wait_state(f"{name}-first", "Timeout", one)
    two = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    two.stdin.write(f"set application_name='{name}-second';begin;set local lock_timeout='8s';{second}commit;")
    two.stdin.close()
    two.stdin = None
    wait_state(f"{name}-second", "Lock", two)
    first_out = one.communicate(timeout=15)
    second_out = two.communicate(timeout=15)
    if one.returncode:
        raise RuntimeError(first_out[1])
    if second_error:
        if not two.returncode or second_error not in second_out[1]:
            raise RuntimeError(f"Expected {second_error}: {second_out}")
    elif two.returncode:
        raise RuntimeError(second_out[1])
    print(f"PASS {label}: second transaction waited and {'rejected' if second_error else 'completed once'}")


sql(f"""begin;
update private.operator_access_state set configured=false,revision=1 where id;
delete from private.operator_memberships;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','invitation-race-'||n||'@example.test',now(),'{{}}','{{}}',now(),now() from generate_series(1,9) n;
update public.profiles set role=case when id='{uid(1)}' then 'admin'::public.user_role when id='{uid(2)}' then 'staff'::public.user_role else 'user'::public.user_role end where id::text like '90000000-0000-4000-8000-%';
insert into private.operator_memberships(profile_id,manager_role) values('{uid(1)}','owner'),('{uid(2)}','primary');
update private.operator_access_state set configured=true where id;
{''.join(f"select private.insert_operator_invitation({json_sql(entry(n))},'{uid(2 if n == 5 else 1)}',clock_timestamp());" for n in (3,4,5,6,7))}
commit;""")
race("same-accept", actor(3) + accept(3, 101), actor(3) + accept(3, 102))
assert sql(f"select count(*) from public.audit_log where action='operator.invitation_accepted' and actor_id='{uid(3)}';") == "1"
race("cancel-before-accept", actor(1) + f"select public.admin_cancel_operator_invitation('{uid(4, '91')}',1,2,'{uid(103, '92')}');", actor(4) + accept(4, 104), "operator_invitation_unavailable")
race("inviter-demotion-before-accept", actor(1) + f"select public.admin_change_operator_role('{uid(2)}','deputy',1,3,'{uid(105, '92')}');", actor(5) + accept(5, 106), "operator_invitation_unavailable")
assert sql(f"select count(*) from private.operator_memberships where profile_id in ('{uid(4)}','{uid(5)}');") == "0"
race("email-change-before-accept", f"update auth.users set email='changed-race-6@example.test' where id='{uid(6)}';", actor(6) + accept(6, 110), "operator_invitation_unavailable")
race("accept-before-email-change", actor(7) + accept(7, 111), f"update auth.users set email='changed-race-7@example.test' where id='{uid(7)}';")
assert sql(f"select manager_role from private.operator_memberships where profile_id='{uid(7)}';") == "deputy"
sql("""begin;
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('90000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','invitation-race-'||n||'@example.test',now(),'{}','{}',now(),now() from generate_series(1000,1994) n;
update public.profiles set role='staff' where id::text like '90000000-0000-4000-8000-%' and right(id::text,12)::bigint between 1000 and 1994;
insert into private.operator_memberships(profile_id,manager_role) select id,'logistics' from public.profiles where id::text like '90000000-0000-4000-8000-%' and right(id::text,12)::bigint between 1000 and 1994;
commit;""")
create = lambda n, revision, op: actor(1) + f"select public.admin_create_operator_invitations({json_sql([entry(n)])},{revision},'{uid(op, '92')}');"
race("last-capacity-slot", create(8, 5, 107), create(9, 5, 108), "operator_access_changed")
result = subprocess.run(command, input="begin;" + create(9, 6, 109) + "commit;", capture_output=True, text=True)
assert result.returncode and "operator_limit" in result.stderr
assert sql("select (select count(*) from private.operator_memberships where manager_role<>'owner')+(select count(*) from private.operator_invitations where status='pending' and expires_at>clock_timestamp());") == "1000"
assert sql(f"select count(*) from public.audit_log where id::text like '92000000-0000-4000-8000-%';") == "5"
print("PASS capacity readback: 1000 total, one concurrent invite winner, five distinct lifecycle audits; no provider invoked")

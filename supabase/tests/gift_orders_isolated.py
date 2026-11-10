"""Gift/current/legacy/real-lock suites in one uniquely leased disposable clone."""
from __future__ import annotations

import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import uuid

from gift_order_test_support import checked_scope, inspect_source, validate_owned_clone

ROOT = Path(__file__).resolve().parents[2]
TEST_FILES = ["gift_order_domain.sql", "gift_order_transactions.sql", "gift_order_operations.sql", "gift_order_refunds.sql",
              "operator_capability_coverage.sql", "helpers/goods_kc_fixture.sql", "gift_order_concurrency.py",
              "gift_order_legacy.py", "gift_order_test_support.py", "order_claims.sql", "order_claim_withdrawal.sql",
              "order_claim_reason_changes.sql", "order_claim_type_conversion.sql", "admin_order_address_changes.sql",
              "gift_operations_console.sql"]
REQUIRED_VERSIONS = ["20261020085340", "20261020085341", "20261020085342", "20261020085343", "20261020085345",
                     "20261020085346", "20261020085347", "20261020085348", "20261020085354", "20261020085356"]


class InterruptedRun(Exception):
    def __init__(self, signum: int):
        super().__init__(f"Interrupted by signal {signum}")
        self.signum = signum


def interrupted(signum: int, _frame) -> None:
    raise InterruptedRun(signum)


def main() -> int:
    if len(sys.argv) != 1:
        raise ValueError("No migration arguments are accepted: apply the full chain before invoking this clone-only suite")
    scope = checked_scope()
    identity = inspect_source(os.environ.get("SUPABASE_DB_CONTAINER", ""), scope)
    container = identity["id"]
    lease = str(uuid.uuid4())
    database = "icons_gift_orders_" + uuid.UUID(lease).hex
    out = ROOT / "output/gift-order-tests" / uuid.UUID(lease).hex
    out.mkdir(parents=True, exist_ok=False)
    temporary = Path(tempfile.mkdtemp(prefix="icons-gift-orders-"))
    toc_path = "/tmp/" + database + ".list"
    environment = {**os.environ, "GIFT_ORDER_SOURCE_CONTAINER": identity["name"], "GIFT_ORDER_CLONE_LEASE": lease,
                   "SUPABASE_DB_CONTAINER": container, "SUPABASE_DB_DATABASE": database}
    report = {"status": "RUNNING", "scope": scope, "sourceContainer": identity,
              "sourceDatabase": "postgres", "database": database, "sourceDatabaseWrites": 0,
              "migrationsAppliedByWrapper": 0, "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
              "files": {str(Path("supabase/tests") / name): hashlib.sha256((ROOT / "supabase/tests" / name).read_bytes()).hexdigest()
                        for name in TEST_FILES}}
    report["files"].update({name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in
                            ["supabase/tests/gift_orders_isolated.sh", "supabase/tests/gift_orders_isolated.py",
                             "scripts/with-legacy-operator-fixtures.mjs", "supabase/tests/helpers/operator_access_fixture.sql"]})
    created = False
    database_oid = None
    source_before = None
    code = 1

    def execute(command: list[str], name: str, *, body: str | None = None, timeout: int = 180, env=None) -> str:
        process = subprocess.Popen(command, stdin=subprocess.PIPE if body is not None else subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                   cwd=ROOT, env=env, start_new_session=True)
        try:
            stdout, stderr = process.communicate(body, timeout=timeout)
        except BaseException:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                stdout, stderr = process.communicate(timeout=8)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                stdout, stderr = process.communicate()
            (out / (name + ".log")).write_text(stdout + stderr)
            raise
        (out / (name + ".log")).write_text(stdout + stderr)
        if process.returncode:
            raise RuntimeError(f"{name} failed (exit {process.returncode}); see {out / (name + '.log')}: {stderr[-1500:]}")
        return stdout.strip()

    def source_sql(body: str) -> str:
        # Every source SQL connection is explicitly read-only; pg_dump below is
        # the only other source reader. No source fixture/helper is installed.
        result = subprocess.run(["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "postgres",
                                 "-d", "postgres", "-v", "ON_ERROR_STOP=1"],
                                input="begin read only;\n" + body + "\ncommit;", text=True, capture_output=True, timeout=40, check=True)
        return result.stdout.strip()

    def ledger() -> dict:
        rows = json.loads(source_sql("select coalesce(jsonb_agg(to_jsonb(m) order by version),'[]') from supabase_migrations.schema_migrations m;"))
        serialized = json.dumps(rows, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return {"count": len(rows), "maximumVersion": max((row["version"] for row in rows), default=None),
                "sha256": hashlib.sha256(serialized.encode()).hexdigest()}

    def clone_sql(body: str, name: str) -> str:
        return execute(["docker", "exec", "-i", container, "psql", "-X", "-qAt", "-U", "supabase_admin",
                        "-d", database, "-v", "ON_ERROR_STOP=1"], name, body=body)

    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, interrupted)
    try:
        source_before = ledger()
        report["sourceLedgerBefore"] = source_before
        versions = "array[" + ",".join("'" + version + "'" for version in REQUIRED_VERSIONS) + "]"
        if source_sql("select not exists(select 1 from unnest(" + versions + ") v where not exists("
                      "select 1 from supabase_migrations.schema_migrations where version=v));") != "t":
            raise RuntimeError("Source is missing required applied migrations; this wrapper never applies them")
        dump = temporary / "base.dump"
        with dump.open("wb") as stream:
            subprocess.run(["docker", "exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "-Fc"],
                           stdout=stream, stderr=subprocess.PIPE, check=True, timeout=180)
        with dump.open("rb") as stream:
            toc = subprocess.run(["docker", "exec", "-i", container, "pg_restore", "-l"], stdin=stream,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30).stdout.decode()
        toc_file = temporary / "restore.list"
        toc_file.write_text("\n".join(line for line in toc.splitlines() if not any(word in line.split() for word in ("cron", "pg_cron"))) + "\n")
        if source_sql("select not exists(select 1 from pg_database where datname='" + database + "');") != "t":
            raise RuntimeError("Fresh clone name unexpectedly exists; refusing to claim it")
        # Register this unique, previously absent name before createdb so a
        # signal delivered after CREATE but before its response still cleans it.
        created = True
        execute(["docker", "exec", container, "createdb", "-U", "postgres", database], "create-clone")
        database_oid = source_sql("select oid from pg_database where datname='" + database + "';")
        execute(["docker", "cp", str(toc_file), container + ":" + toc_path], "copy-toc")
        with dump.open("rb") as stream:
            restored = subprocess.run(["docker", "exec", "-i", container, "pg_restore", "-U", "supabase_admin",
                                       "-d", database, "--exit-on-error", "-L", toc_path], stdin=stream,
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        (out / "restore.log").write_bytes(restored.stdout + restored.stderr)
        if restored.returncode:
            raise RuntimeError("Restore failed; see restore.log")
        clone_sql("""
create table private.operator_fixture_clone_identity(singleton boolean primary key check(singleton),lease uuid not null,
 container_id text not null,source_database text not null,created_at timestamptz not null);
alter table private.operator_fixture_clone_identity enable row level security;
revoke all on private.operator_fixture_clone_identity from public,anon,authenticated,service_role;
insert into private.operator_fixture_clone_identity values(true,'""" + lease + "','" + container + "', 'postgres',clock_timestamp());\n" + """
-- A pg_dump restore gives policy/role OIDs new numeric identities. Refresh only
-- these derived registry checksums inside the owned clone; no function changes.
do $$declare r record;begin
 for r in select signature from private.operator_internal_contracts loop
  perform private.register_operator_internal_contract(r.signature::regprocedure);end loop;
 for r in select * from private.operator_policy_contracts loop
  perform private.register_operator_policy_contract(format('%I.%I',r.schema_name,r.table_name)::regclass,r.policy_name,r.capability);end loop;
end$$;
update private.gift_runtime set enabled=false,privacy_ready=false where singleton;
update private.goods_transaction_runtime set enabled=false where singleton;
""", "clone-lease-and-derived-checksums")
        validate_owned_clone(container, database, environment)
        tests = {name: (ROOT / "supabase/tests" / name).read_text() for name in TEST_FILES if name.endswith(".sql")}
        helper = tests["helpers/goods_kc_fixture.sql"] + "\n"
        clone_sql(helper + tests["gift_order_domain.sql"], "gift-domain")
        domain_anchor = "-- These two pending rows"
        if tests["gift_order_domain.sql"].count(domain_anchor) != 1:
            raise RuntimeError("Gift domain continuation anchor changed")
        financial = tests["gift_order_domain.sql"].split(domain_anchor)[0] + tests["gift_order_transactions.sql"]
        operation_anchor = "select pg_temp.gift_assert(private.order_delivery_snapshot(:'order_id')->>'addressRevision'='1','private address revision advanced');"
        if financial.count(operation_anchor) != 1 or not financial.rstrip().endswith("rollback;"):
            raise RuntimeError("Gift financial continuation anchor changed")
        financial = financial.replace(operation_anchor, operation_anchor + "\n" + tests["gift_order_operations.sql"])
        financial = financial.rsplit("rollback;", 1)[0] + tests["gift_order_refunds.sql"] + "\nrollback;\n"
        clone_sql(helper + financial, "gift-financial-operations-and-refunds")
        clone_sql(tests["gift_operations_console.sql"], "gift-operations-console")
        report["giftOperationsConsole"] = "PASS"
        clone_sql(tests["operator_capability_coverage.sql"], "operator-coverage")
        # Legacy suites assert global claim counts. Only this owned clone is
        # emptied; the source data and all applied SQL remain untouched.
        validate_owned_clone(container, database, environment)
        clone_sql("truncate table public.orders cascade; update private.operator_access_state set configured=false where id;", "clone-only-legacy-baseline")
        execute(["node", "scripts/with-legacy-operator-fixtures.mjs", "--project", identity["project"], "--container", identity["name"],
                 "--database", database, "--clone-lease", lease, "--", "python3", "supabase/tests/gift_order_legacy.py", str(out / "legacy"), "legacy"],
                "legacy-wrapper", timeout=180, env={**environment, "OPERATOR_LEGACY_FIXTURE_TEST_SCOPE": "1"})
        clone_owner = str(uuid.uuid5(uuid.UUID(lease), "gift-current-operator-owner"))
        clone_sql("begin; "
                  "select 1/case when to_regclass('private.operator_legacy_fixture_control') is null and "
                  "to_regprocedure('private.capture_operator_legacy_fixture()') is null then 1 else 0 end; "
                  # Fresh/CI sources may not have completed manager onboarding.
                  # Keep the real owner invariant; create an explicit owner only
                  # in this leased clone before the current-capability suites.
                  "insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) "
                  "select '" + clone_owner + "','authenticated','authenticated','gift-clone-owner-" + uuid.UUID(lease).hex + "@example.test',"
                  "clock_timestamp(),'{\"testFixture\":\"gift-owned-clone\"}','{}' "
                  "where not exists(select 1 from private.operator_memberships where manager_role='owner'); "
                  "update public.profiles set role='admin',nickname='TEST 선물 clone 대표' where id='" + clone_owner + "'; "
                  "insert into private.operator_memberships(profile_id,manager_role) select '" + clone_owner + "','owner' "
                  "where exists(select 1 from auth.users where id='" + clone_owner + "') "
                  "and not exists(select 1 from private.operator_memberships where manager_role='owner'); "
                  "update private.operator_access_state set configured=true where id; commit;", "legacy-fixture-removed")
        execute(["python3", "supabase/tests/gift_order_legacy.py", str(out / "ordinary-current"), "current"],
                "ordinary-current-wrapper", timeout=180, env=environment)
        execute(["python3", "supabase/tests/gift_order_concurrency.py", container, database, str(out / "concurrency")],
                "concurrency-wrapper", timeout=180, env=environment)
        concurrency = json.loads((out / "concurrency/result.json").read_text())
        actual_waits = sum(row.get("observedLockWait") is True for row in concurrency["cases"])
        if concurrency["status"] != "PASS" or actual_waits != 12:
            raise RuntimeError("Expected all twelve actual lock races to pass")
        if any(hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected for name, expected in report["files"].items()):
            raise RuntimeError("Test or helper source changed while verification was running")
        report.update(status="PASS", actualLockRaceCases=actual_waits, concurrency=concurrency,
                      legacy=json.loads((out / "legacy/result.json").read_text()),
                      currentOrdinary=json.loads((out / "ordinary-current/result.json").read_text()))
        code = 0
    except InterruptedRun as error:
        report.update(status="INTERRUPTED", error=str(error))
        code = 128 + error.signum
    except Exception as error:
        report.update(status="FAIL", error=str(error))
        print(str(error), file=sys.stderr)
    finally:
        # Do not allow another signal to interrupt owned-resource cleanup.
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, signal.SIG_IGN)
        cleanup_errors = []
        if created:
            try:
                actual_oid = source_sql("select oid from pg_database where datname='" + database + "';")
                if actual_oid and database_oid is not None and actual_oid != database_oid:
                    raise RuntimeError("Disposable database OID changed; refusing to drop an unowned replacement")
                if actual_oid:
                    execute(["docker", "exec", container, "dropdb", "-U", "postgres", "--force", database], "drop-owned-clone")
                report["cloneRemoved"] = source_sql("select not exists(select 1 from pg_database where datname='" + database + "');") == "t"
                if not report["cloneRemoved"]:
                    raise RuntimeError("Owned clone still exists after drop")
            except Exception as error:
                cleanup_errors.append(str(error))
        else:
            report["cloneRemoved"] = True
        try:
            subprocess.run(["docker", "exec", container, "rm", "-f", toc_path], check=True, capture_output=True, timeout=20)
            report["containerTocRemoved"] = subprocess.run(["docker", "exec", container, "test", "!", "-e", toc_path], capture_output=True, timeout=20).returncode == 0
            if not report["containerTocRemoved"]:
                raise RuntimeError("Owned restore list remains")
        except Exception as error:
            cleanup_errors.append(str(error))
        try:
            shutil.rmtree(temporary)
            report["dumpRemoved"] = not temporary.exists()
        except Exception as error:
            cleanup_errors.append(str(error))
        try:
            source_after = ledger()
            report["sourceLedgerAfter"] = source_after
            report["sourcePreserved"] = source_before is not None and source_after == source_before
            if not report["sourcePreserved"]:
                raise RuntimeError("Source complete migration ledger changed or could not be verified")
        except Exception as error:
            cleanup_errors.append(str(error))
        if cleanup_errors:
            report.update(status="FAIL", cleanupErrors=cleanup_errors)
            code = 1
        (out / "result.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
        print(json.dumps({"status": report["status"], "result": str(out / "result.json"),
                          "actualLockRaceCases": report.get("actualLockRaceCases", 0), "sourcePreserved": report.get("sourcePreserved", False),
                          "cloneRemoved": report.get("cloneRemoved", False), "sourceDatabaseWrites": 0}, ensure_ascii=False))
    return code


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)

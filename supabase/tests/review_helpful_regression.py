"""Run helpful SQL, authenticated admin, DTO and race checks in one owned local clone.

No source DB writes, resets, role normalization, or migration application. The
source must already contain the helpful admin owner correction. Use the same
entrypoint for canonical CI and a migrated local database with mixed owners.
"""
from __future__ import annotations
if not __debug__:
    raise SystemExit('Optimized Python is not allowed')
import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import uuid
from pathlib import Path
from helpers.review_helpful_contract import quote, snapshot, sql

ROOT = Path(__file__).resolve().parents[2]
TESTS = ROOT / 'supabase/tests'
REQUIRED_VERSION = '20261015035229'
ADMIN = 'public.admin_search_reviews_helpful(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'
PREDECESSOR = 'public.admin_search_reviews_best(uuid,date,date,integer,text,boolean,boolean,boolean,text,text,text,integer,integer,text)'


def check(value, message):
    if not value:
        raise RuntimeError(message)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write(path, value):
    with path.open('w') as stream:
        os.chmod(path, 0o600)
        json.dump(value, stream, ensure_ascii=False, sort_keys=True, indent=2)
        stream.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--scope', choices=['ci', 'isolated-local'], required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    args = parser.parse_args()
    check(Path.cwd().resolve() == ROOT, 'Run from the repository root')
    check(re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+', args.container), 'Explicit local Supabase container required')
    check(not os.environ.get('DOCKER_HOST') or os.environ['DOCKER_HOST'].startswith('unix://'), 'Remote Docker is unsupported')
    check(subprocess.check_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip().startswith('unix://'), 'Local Docker context required')
    meta = json.loads(subprocess.check_output(['docker', 'inspect', args.container], text=True))[0]
    cid = meta['Id']
    check(meta['Name'] == '/' + args.container and meta['State']['Running'] and re.fullmatch('[0-9a-f]{64}', cid), 'Container identity mismatch')
    check(meta['Config']['Labels']['com.supabase.cli.project'] == args.container.removeprefix('supabase_db_'), 'Supabase project mismatch')
    source_paths = json.loads((TESTS / 'helpers/review_helpful_sources.json').read_text())
    check(len(source_paths['application']) == 18 and len(source_paths['supporting']) == 5, 'Reviewed application/support source set changed')
    application_files = {path: sha(ROOT / path) for path in source_paths['application'] + source_paths['supporting']}
    migration_files = {path.name: sha(path) for path in (ROOT / 'supabase/migrations').glob('*.sql')}
    test_paths = [Path(__file__), TESTS / 'helpers/goods_kc_fixture.sql', TESTS / 'helpers/review_helpful_fixture.sql',
        TESTS / 'helpers/review_helpful_contract.py', TESTS / 'helpers/review_helpful_sources.json',
        TESTS / 'review_helpful.sql', TESTS / 'review_helpful_admin_owner.sql', TESTS / 'review_helpful_concurrency.py',
        TESTS / 'review_helpful_contract.live.ts', TESTS / 'review-helpful-vitest.config.ts', TESTS / 'operator_capability_coverage.sql',
        ROOT / '.github/workflows/pipeline.yml', ROOT / 'scripts/admin-visual-fixture/customer-service.tsx']
    frozen = {path: path.read_bytes() for path in test_paths}
    lease = uuid.uuid4()
    db = 'icons_review_helpful_regression_' + lease.hex
    output = args.output_dir.resolve() / lease.hex
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    temporary = Path(tempfile.mkdtemp(prefix='icons-review-helpful-'))
    temporary.chmod(0o700)
    identity = dict(lease=str(lease), database=db, containerId=cid, sourceDatabase='postgres')
    write(temporary / 'owner.json', identity)
    remote = '/tmp/' + db + '.list'
    report = dict(status='RUNNING', scope=args.scope, **identity, sourceDatabaseWrites=0, namedApplied=False,
        applicationSourceFiles=application_files, applicationSourceCount=18, supportingSourceCount=5,
        migrationSourceFiles=migration_files, testSources={str(path.relative_to(ROOT)): hashlib.sha256(body).hexdigest() for path, body in frozen.items()}, cleanupErrors=[])
    source = None
    creation_attempted = False
    created = False
    leased = False
    oid = None
    passed = False

    def process(command, label, body=None, binary=False, environment=None):
        child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=not binary, start_new_session=True, env=environment)
        try:
            stdout, stderr = child.communicate(body, timeout=240)
        except BaseException:
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
            raise
        raw = stderr if label == 'dump' else stdout + stderr
        (output / (label + '.log')).write_bytes(raw if binary else raw.encode())
        check(child.returncode == 0, label + ' failed; inspect the saved log')
        return stdout

    def own(require_lease=True):
        check(created and oid, 'Clone identity has not been established')
        current = json.loads(subprocess.check_output(['docker', 'inspect', args.container], text=True))[0]
        check(current['Id'] == cid and current['State']['Running'], 'Source container identity changed')
        check(sql(cid, 'postgres', 'select oid::bigint from pg_database where datname=' + quote(db)) == oid, 'Clone OID changed')
        if require_lease:
            check(sql(cid, db, 'select current_database()=' + quote(db) + ' and exists(select 1 from helpful_regression_guard.identity where lease=' + quote(str(lease)) + ' and container_id=' + quote(cid) + ');') == 't', 'Clone lease changed')

    def run(body, label, require_lease=True):
        own(require_lease)
        return process(['docker', 'exec', '-i', cid, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', db,
            '-v', 'ON_ERROR_STOP=1'], label, body)

    try:
        source = snapshot(cid, 'postgres')
        check(any(row['version'] == REQUIRED_VERSION for row in source['ledger']), 'Apply the helpful owner correction before running this regression')
        check(sql(cid, 'postgres', 'select not exists(select 1 from pg_database where datname=' + quote(db) + ');') == 't', 'Unique clone name already exists')
        write(output / 'source-before.json', source)
        dump = process(['docker', 'exec', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', cid,
            'pg_dump', '-U', 'postgres', '-d', 'postgres', '-Fc'], 'dump', binary=True)
        dump_path = temporary / 'base.dump'
        dump_path.write_bytes(dump)
        dump_path.chmod(0o600)
        toc = process(['docker', 'exec', '-i', cid, 'pg_restore', '-l'], 'toc', dump, binary=True).decode()
        restore_list = temporary / 'restore.list'
        restore_list.write_text('\n'.join(line for line in toc.splitlines() if not {'cron', 'pg_cron'} & set(line.split())) + '\n')
        creation_attempted = True
        process(['docker', 'exec', cid, 'createdb', '-U', 'postgres', db], 'create')
        created = True
        oid = sql(cid, 'postgres', 'select oid::bigint from pg_database where datname=' + quote(db))
        check(oid.isdecimal(), 'Clone OID missing')
        report['databaseOid'] = int(oid)
        process(['docker', 'cp', str(restore_list), cid + ':' + remote], 'copy')
        process(['docker', 'exec', '-i', cid, 'pg_restore', '-U', 'supabase_admin', '-d', db,
            '--exit-on-error', '-L', remote], 'restore', dump, binary=True)
        check(snapshot(cid, db) == source, 'Restore did not preserve the complete source contract')
        run('create schema helpful_regression_guard;revoke all on schema helpful_regression_guard from public,anon,authenticated,service_role;'
            'create table helpful_regression_guard.identity(lease uuid,container_id text);revoke all on helpful_regression_guard.identity from public,anon,authenticated,service_role;'
            'insert into helpful_regression_guard.identity values(' + quote(str(lease)) + ',' + quote(cid) + ');', 'lease', False)
        leased = True
        # OIDs differ after restore. Rebind only clone registry fingerprints; never
        # adjust function owners, helper ACLs, RLS, or business records to pass.
        run("do $$declare e record;begin for e in select signature from private.operator_internal_contracts loop perform private.register_operator_internal_contract(e.signature::regprocedure);end loop;for e in select * from private.operator_policy_contracts loop perform private.register_operator_policy_contract(format('%I.%I',e.schema_name,e.table_name)::regclass,e.policy_name,e.capability);end loop;end$$;", 'clone-rebind')
        baseline = snapshot(cid, db)
        write(output / 'clone-baseline.json', baseline)
        functions = {f['signature']: f for f in baseline['schema']['functions']}
        report['adminReaderOwner'] = functions[ADMIN]['owner']
        report['predecessorOwner'] = functions[PREDECESSOR]['owner']
        check(functions[ADMIN]['owner'] == functions[PREDECESSOR]['owner'], 'New admin reader must retain its predecessor execution boundary')
        kc = frozen[TESTS / 'helpers/goods_kc_fixture.sql'].decode()
        fixture = frozen[TESTS / 'helpers/review_helpful_fixture.sql'].decode()
        coverage = frozen[TESTS / 'operator_capability_coverage.sql'].decode()
        run(coverage, 'coverage-before')
        output_sql = run('begin;\n' + kc + '\n' + fixture + '\n' + frozen[TESTS / 'review_helpful.sql'].decode(), 'focused-sql')
        check(snapshot(cid, db) == baseline, 'Functional fixture did not roll back exactly')
        captures = [json.loads(line.removeprefix('REVIEW_HELPFUL_DTO:')) for line in output_sql.splitlines() if line.startswith('REVIEW_HELPFUL_DTO:')]
        check(len(captures) == 6, 'Actual SQL DTO capture set changed')
        write(output / 'actual-dto.json', captures)
        run('begin;\n' + kc + '\n' + frozen[TESTS / 'review_helpful_admin_owner.sql'].decode(), 'authenticated-admin')
        check(snapshot(cid, db) == baseline, 'Authenticated admin fixture did not roll back exactly')
        environment = os.environ.copy()
        environment['REVIEW_HELPFUL_DTO_FILE'] = str(output / 'actual-dto.json')
        process(['node', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', str(TESTS / 'review-helpful-vitest.config.ts'), '--reporter=verbose'], 'dto-bridge', environment=environment)
        run(coverage, 'coverage-after')
        check(snapshot(cid, db) == baseline, 'Coverage changed clone state')
        run('begin;\n' + kc + '\n' + fixture + '\ncommit;', 'race-fixture')
        spec = importlib.util.spec_from_file_location('helpful_concurrency', TESTS / 'review_helpful_concurrency.py')
        races = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(races)
        race_result = races.main(cid, db, output, own, run, sql, quote)
        check(race_result['status'] == 'PASS', 'Concurrent behavior failed')
        write(output / 'concurrency.json', race_result)
        report.update(focusedSql='PASS', sqlAssertions=(output / 'focused-sql.log').read_text().count('NOTICE:  PASS '),
            authenticatedAdmin='PASS', authenticatedAdminAssertions=(output / 'authenticated-admin.log').read_text().count('NOTICE:  PASS '),
            actualSqlDtoBridge='PASS', actualDtoCaptures=6, concurrencyCases=len(race_result['cases']),
            fixtureRollback='PASS', coverage='PASS', existingHelperOwnersAndAclsPreserved=True)
        passed = True
    except BaseException as error:
        report['error'] = type(error).__name__ + ': ' + str(error)
    finally:
        try:
            current_oid = sql(cid, 'postgres', 'select oid::bigint from pg_database where datname=' + quote(db))
            if current_oid:
                check(creation_attempted, 'Unowned clone cleanup refused')
                if oid is None:
                    oid = current_oid
                    created = True
                    report['creationOutcomeRecoveredForCleanup'] = True
                check(current_oid == oid, 'Cleanup OID changed')
                own(leased)
                process(['docker', 'exec', cid, 'dropdb', '-U', 'postgres', '--force', db], 'drop')
            check(sql(cid, 'postgres', 'select not exists(select 1 from pg_database where datname=' + quote(db) + ');') == 't', 'Clone remains')
            report['databaseRemoved'] = True
        except BaseException as error:
            report['cleanupErrors'].append('clone: ' + str(error))
        try:
            process(['docker', 'exec', cid, 'rm', '-f', remote], 'remove-list')
            check(json.loads((temporary / 'owner.json').read_text()) == identity and not temporary.is_symlink(), 'Temporary directory ownership changed')
            shutil.rmtree(temporary)
            report['temporaryFilesRemoved'] = not temporary.exists()
        except BaseException as error:
            report['cleanupErrors'].append('temporary: ' + str(error))
        if source is not None:
            try:
                final = snapshot(cid, 'postgres')
                write(output / 'source-after.json', final)
                report['sourceWholeBaselineUnchanged'] = source == final
                check(source == final, 'Source database changed during the test')
            except BaseException as error:
                report['cleanupErrors'].append('source: ' + str(error))
        report['applicationSourcesUnchanged'] = all(sha(ROOT / path) == digest for path, digest in application_files.items())
        report['migrationSourcesUnchanged'] = migration_files == {path.name: sha(path) for path in (ROOT / 'supabase/migrations').glob('*.sql')}
        report['testSourcesUnchanged'] = all(path.read_bytes() == body for path, body in frozen.items())
        report['status'] = 'PASS' if passed and not report['cleanupErrors'] and all(report[k] for k in ('applicationSourcesUnchanged', 'migrationSourcesUnchanged', 'testSourcesUnchanged')) else 'FAILED'
        write(output / 'result.json', report)
        print(output / 'result.json', flush=True)
    return 0 if report['status'] == 'PASS' else 1


if __name__ == '__main__':
    def interrupted(signum, frame):
        raise SystemExit(128 + signum)
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    raise SystemExit(main())

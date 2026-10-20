"""Run inquiry satisfaction SQL/DTO/race probes in a newly leased disposable clone.

The optional reviewed DRAFT is applied only in that clone. No source DB writes,
named application, resets, old function owner/ACL repairs or formal migrations.
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
REQUIRED_VERSION = '20261015052828'
ADMIN = 'public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)'
PREDECESSOR = 'public.admin_search_inquiries(text,text,date,date,text,text,integer,integer)'
TARGETS = {
    'own': ('supabase_db_icons-ip-smartstore-20261012', '09759fdefa8b8addb60eb646e109a5ffe8ee866f46a0dfd8cbe21b34e50b9160', 59622, 280),
    'canonical': ('supabase_db_icons-ip-chain-20261014-feb855bd', '3178a8e2c320af8c1384b0c2089ec0ae007c7afd0408d45052b1cfc7112e1725', 59922, 348),
}


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


def validate_additions(before, after):
    check(before['ledger'] == after['ledger'], 'DRAFT changed migration ledger')
    old_functions = {row['signature']: row for row in before['schema']['functions']}
    new_functions = {row['signature']: row for row in after['schema']['functions']}
    check(all(new_functions.get(key) == row for key, row in old_functions.items()), 'DRAFT changed existing function definition/owner/ACL')
    added = set(new_functions) - set(old_functions)
    expected = {
        'private.inquiry_satisfaction_viewer()', 'private.inquiry_satisfaction_active(uuid)', 'private.inquiry_satisfaction_current(uuid)',
        'private.inquiry_satisfaction_staff_insert()', 'private.inquiry_satisfaction_request(uuid,uuid,uuid,uuid,uuid,bigint,text,boolean)',
        'public.get_my_inquiry_satisfaction(uuid)', 'public.set_my_inquiry_satisfaction(uuid,uuid,uuid,uuid,uuid,bigint,text)',
        'public.read_my_inquiry_satisfaction_operation(uuid,uuid,uuid,uuid,uuid,bigint,text)',
        'public.admin_inquiry_satisfaction_console(text,text,date,date,text,text,integer,integer,text)', 'public.admin_inquiry_satisfaction_detail(uuid)'}
    check(added == expected, 'Unexpected added functions')
    check(before['schema']['policies'] == after['schema']['policies'], 'Existing RLS policies changed')
    old_tables = {row['table']: row for row in before['schema']['tables']}
    new_tables = {row['table']: row for row in after['schema']['tables']}
    check(set(new_tables) - set(old_tables) == {'private.inquiry_satisfaction_state', 'private.inquiry_satisfaction_operations'}, 'Unexpected added relations')
    for name, row in old_tables.items():
        actual = dict(new_tables.get(name, {}))
        if name == 'public.inquiry_messages':
            extra = [trigger for trigger in actual.get('triggers', []) if trigger not in row['triggers']]
            check(len(extra) == 1 and 'inquiry_satisfaction_staff_insert' in extra[0], 'Unexpected message trigger change')
            actual['triggers'] = [trigger for trigger in actual['triggers'] if trigger not in extra]
        check(actual == row, 'Existing relation changed: ' + name)
    check(all(after['rows'].get(name) == value for name, value in before['rows'].items()), 'DRAFT backfilled or changed business rows')
    check(all(after['rows'][name]['count'] == 0 for name in set(new_tables) - set(old_tables)), 'DRAFT backfilled new state')
    for group in ['internals', 'rpc', 'policies']:
        check(all(row in (after['registry'][group] or []) for row in before['registry'][group] or []), 'DRAFT changed existing registry ' + group)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    target_group = parser.add_mutually_exclusive_group(required=True)
    target_group.add_argument('--container', help='CI local Supabase only; isolated-local uses the fixed target')
    target_group.add_argument('--target', choices=TARGETS)
    parser.add_argument('--scope', choices=['ci', 'isolated-local'], required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--draft', type=Path)
    parser.add_argument('--draft-sha256')
    args = parser.parse_args()
    expected_cid = expected_port = expected_count = None
    if args.scope == 'isolated-local':
        check(args.target in TARGETS, 'isolated-local requires a fixed OWN or CANON target')
        args.container, expected_cid, expected_port, expected_count = TARGETS[args.target]
    else:
        check(args.container and not args.target, 'CI requires its explicit local container')
    check(Path.cwd().resolve() == ROOT, 'Run from the repository root')
    check(re.fullmatch(r'supabase_db_[A-Za-z0-9_-]+', args.container), 'Explicit local Supabase container required')
    check(not os.environ.get('DOCKER_HOST') or os.environ['DOCKER_HOST'].startswith('unix://'), 'Remote Docker is unsupported')
    check(subprocess.check_output(['docker', 'context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'], text=True).strip().startswith('unix://'), 'Local Docker context required')
    meta = json.loads(subprocess.check_output(['docker', 'inspect', args.container], text=True))[0]
    cid = meta['Id']
    check(meta['Name'] == '/' + args.container and meta['State']['Running'] and re.fullmatch('[0-9a-f]{64}', cid), 'Container identity mismatch')
    check(meta['Config']['Labels']['com.supabase.cli.project'] == args.container.removeprefix('supabase_db_'), 'Supabase project mismatch')
    if expected_cid:
        check(cid == expected_cid and {port['HostPort'] for port in meta['NetworkSettings']['Ports']['5432/tcp']} == {str(expected_port)}, 'Fixed target CID or port changed')
    source_paths = json.loads((TESTS / 'helpers/inquiry_satisfaction_sources.json').read_text())
    check(len(source_paths['application']) == 13, 'Reviewed application source set changed')
    application_files = {path: sha(ROOT / path) for path in source_paths['application']}
    migration_files = {path.name: sha(path) for path in (ROOT / 'supabase/migrations').glob('*.sql')}
    test_paths = [Path(__file__), TESTS / 'helpers/inquiry_satisfaction_fixture.sql',
        TESTS / 'helpers/review_helpful_contract.py', TESTS / 'helpers/inquiry_satisfaction_sources.json',
        TESTS / 'inquiry_satisfaction.sql', TESTS / 'inquiry_satisfaction_concurrency.py',
        TESTS / 'inquiry_satisfaction_contract.live.ts', TESTS / 'inquiry-satisfaction-vitest.config.ts',
        TESTS / 'operator_capability_coverage.sql']
    draft = args.draft.resolve() if args.draft else None
    check(bool(draft) == bool(args.draft_sha256), 'DRAFT path and approved SHA-256 must be supplied together')
    if draft:
        check(draft == ROOT / 'output/inquiry-satisfaction-implementation-20261015/inquiry-satisfaction.DRAFT.sql', 'Only the reviewed satisfaction DRAFT path is allowed')
        check(re.fullmatch('[0-9a-f]{64}', args.draft_sha256) and sha(draft) == args.draft_sha256, 'Approved DRAFT SHA-256 differs')
        check(args.scope == 'isolated-local', 'CI requires the formal migration; DRAFT is clone review only')
        prefix_path = ROOT / 'output/inquiry-satisfaction-implementation-20261015/source-prefix-348.json'
        check(migration_files == json.loads(prefix_path.read_text()) and len(migration_files) == 348, 'Reviewed 348 migration source prefix changed')
        test_paths.append(prefix_path)
        test_paths.append(draft)
    frozen = {path: path.read_bytes() for path in test_paths}
    lease = uuid.uuid4()
    db = 'icons_inquiry_satisfaction_' + lease.hex
    output = args.output_dir.resolve() / lease.hex
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    temporary = Path(tempfile.mkdtemp(prefix='icons-inquiry-satisfaction-'))
    temporary.chmod(0o700)
    identity = dict(lease=str(lease), database=db, containerId=cid, sourceDatabase='postgres')
    write(temporary / 'owner.json', identity)
    remote = '/tmp/' + db + '.list'
    report = dict(status='RUNNING', scope=args.scope, **identity, sourceDatabaseWrites=0, namedApplied=False,
        applicationSourceFiles=application_files, applicationSourceCount=13, draftAppliedToClone=bool(draft),
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
            check(sql(cid, db, 'select current_database()=' + quote(db) + ' and exists(select 1 from satisfaction_regression_guard.identity where lease=' + quote(str(lease)) + ' and container_id=' + quote(cid) + ');') == 't', 'Clone lease changed')

    def run(body, label, require_lease=True):
        own(require_lease)
        return process(['docker', 'exec', '-i', cid, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', db,
            '-v', 'ON_ERROR_STOP=1'], label, body)

    try:
        source = snapshot(cid, 'postgres')
        check(any(row['version'] == REQUIRED_VERSION for row in source['ledger']), 'Required baseline 348 is absent')
        if draft:
            check(len(source['ledger']) == expected_count and source['ledger'][-1]['version'] == REQUIRED_VERSION, 'DRAFT review requires target-specific named 348 baseline')
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
        run('create schema satisfaction_regression_guard;revoke all on schema satisfaction_regression_guard from public,anon,authenticated,service_role;'
            'create table satisfaction_regression_guard.identity(lease uuid,container_id text);revoke all on satisfaction_regression_guard.identity from public,anon,authenticated,service_role;'
            'insert into satisfaction_regression_guard.identity values(' + quote(str(lease)) + ',' + quote(cid) + ');', 'lease', False)
        leased = True
        # OIDs differ after restore. Rebind only clone registry fingerprints; never
        # adjust function owners, helper ACLs, RLS, or business records to pass.
        run("do $$declare e record;begin for e in select signature from private.operator_internal_contracts loop perform private.register_operator_internal_contract(e.signature::regprocedure);end loop;for e in select * from private.operator_policy_contracts loop perform private.register_operator_policy_contract(format('%I.%I',e.schema_name,e.table_name)::regclass,e.policy_name,e.capability);end loop;end$$;", 'clone-rebind')
        baseline = snapshot(cid, db)
        write(output / 'clone-baseline.json', baseline)
        fixture = frozen[TESTS / 'helpers/inquiry_satisfaction_fixture.sql'].decode()
        coverage = frozen[TESTS / 'operator_capability_coverage.sql'].decode()
        if draft:
            # Seed real legacy answers before feature creation, without disabling triggers.
            run('begin;\n' + fixture + '\ncommit;', 'legacy-fixture')
            before_draft = snapshot(cid, db)
            run('begin;\n' + frozen[draft].decode() + '\ncommit;', 'reviewed-draft')
            after_draft = snapshot(cid, db)
            validate_additions(before_draft, after_draft)
            write(output / 'draft-before.json', before_draft)
            write(output / 'draft-after.json', after_draft)
            baseline = after_draft
        functions = {f['signature']: f for f in baseline['schema']['functions']}
        check(ADMIN in functions, 'Satisfaction migration or an explicitly reviewed clone DRAFT is required')
        report['adminReaderOwner'] = functions[ADMIN]['owner']
        report['predecessorOwner'] = functions[PREDECESSOR]['owner']
        check(functions[ADMIN]['owner'] == functions[PREDECESSOR]['owner'], 'New admin reader execution owner differs from predecessor')
        run(coverage, 'coverage-before')
        output_sql = run('begin;\n' + ('' if draft else fixture) + '\n' + frozen[TESTS / 'inquiry_satisfaction.sql'].decode(), 'focused-sql')
        check(snapshot(cid, db) == baseline, 'Functional fixture did not roll back exactly')
        captures = [json.loads(line.removeprefix('INQUIRY_SATISFACTION_DTO:')) for line in output_sql.splitlines() if line.startswith('INQUIRY_SATISFACTION_DTO:')]
        check(len(captures) == 4, 'Actual SQL DTO capture set changed')
        write(output / 'actual-dto.json', captures)
        environment = os.environ.copy()
        environment['INQUIRY_SATISFACTION_DTO_FILE'] = str(output / 'actual-dto.json')
        process(['node', str(ROOT / 'node_modules/vitest/vitest.mjs'), 'run', '--config', str(TESTS / 'inquiry-satisfaction-vitest.config.ts'), '--reporter=verbose'], 'dto-bridge', environment=environment)
        run(coverage, 'coverage-after')
        check(snapshot(cid, db) == baseline, 'Coverage changed clone state')
        if not draft:
            run('begin;\n' + fixture + '\ncommit;', 'race-fixture')
        spec = importlib.util.spec_from_file_location('satisfaction_concurrency', TESTS / 'inquiry_satisfaction_concurrency.py')
        races = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(races)
        race_result = races.main(cid, db, output, own, run, sql, quote)
        check(race_result['status'] == 'PASS', 'Concurrent behavior failed')
        write(output / 'concurrency.json', race_result)
        report.update(focusedSql='PASS', sqlAssertions=(output / 'focused-sql.log').read_text().count('NOTICE:  PASS '),
            actualSqlDtoBridge='PASS', actualDtoCaptures=4, concurrencyCases=len(race_result['cases']),
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

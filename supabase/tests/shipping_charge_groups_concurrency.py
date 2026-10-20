"""Real shipping-charge lock/CAS races, only in an explicitly leased local clone.

Source preparation does not authorize execution. The parent verification runner
owns clone creation, complete source snapshots and final clone cleanup.
"""
from __future__ import annotations
if not __debug__:
    raise SystemExit('Optimized Python is not allowed for database fixture tools')

import json
import os
import re
import subprocess
import time
import uuid
from pathlib import Path


def quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def js(value) -> str:
    return quote(json.dumps(value, ensure_ascii=False, separators=(',', ':'))) + '::jsonb'


def ident(number: int) -> str:
    return 'a7160000-0000-4000-8000-' + str(number).zfill(12)


ACTOR, SESSION, DEPUTY, DEPUTY_SESSION, BUYER = ident(1), ident(11), ident(2), ident(12), ident(3)
CONTEXT_KEYS = ('operationId', 'command', 'groupId', 'expectedRevision', 'expectedActorId', 'expectedSessionId')
GUARD_KEYS = ('id', 'updatedAt', 'ownerGoodId', 'ownerUpdatedAt', 'familyGoodIds', 'transactionRevision',
              'deliveryVersionId', 'originId', 'assignmentRevision', 'assignmentVersionId', 'groupId', 'groupRevision')
VALUE_KEYS = ('name', 'enabled', 'archived', 'isDefault', 'calculationMode', 'regional')
ADDRESS = {'recipientName': 'TEST 수취인', 'phone': '01000000000', 'postalCode': '12345', 'address1': 'TEST 경합 주소'}
EXPECTED_RACES = (
    'quote-before-group-save', 'save-before-quote', 'save-before-stale-place',
    'first-assignment-before-quote', 'origin-edit-before-assignment', 'clear-before-origin-move',
    'concurrent-default-switch', 'assignment-before-disable', 'archive-before-assignment',
    'hundred-target-stale-atomic', 'template-versus-standalone', 'family-topology-versus-assignment',
    'seal-before-late-assignment', 'write-before-operation-read', 'runtime-off-before-assignment',
)


def auth(actor=ACTOR, session=SESSION, role='authenticated') -> str:
    return ('set local role ' + role + ';' if role else '') + 'set local request.jwt.claim.sub=' + quote(actor) + ';' + \
        'set local request.jwt.claims=' + quote(json.dumps({'sub': actor, 'role': 'authenticated', 'session_id': session})) + ';'


class OwnedClone:
    def __init__(self):
        self.cid = os.environ['SUPABASE_DB_CONTAINER']
        self.db = os.environ['PGDATABASE']
        self.lease = uuid.UUID(os.environ['SHIPPING_CHARGE_GROUPS_LEASE'])
        assert re.fullmatch(r'[0-9a-f]{64}', self.cid)
        assert self.db == 'icons_goods_transaction_' + self.lease.hex
        metadata = json.loads(subprocess.check_output(['docker', 'inspect', self.cid], text=True))[0]
        assert metadata['Id'] == self.cid and metadata['State']['Running']
        assert re.fullmatch(r'/supabase_db_icons-ip(?:-[a-z0-9]+)*', metadata['Name'])
        assert metadata['Config']['Labels']['com.supabase.cli.project'] == metadata['Name'].removeprefix('/supabase_db_')
        self.cmd = ['docker', 'exec', '-i', self.cid, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', self.db,
                    '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose']
        result = subprocess.run(self.cmd, input="begin read only;select jsonb_build_object('identity',to_jsonb(i),"
                                "'oid',(select oid::bigint from pg_database where datname=current_database()),'database',current_database()) "
                                "from private.operator_fixture_clone_identity i where singleton;rollback;",
                                capture_output=True, text=True, timeout=20)
        assert result.returncode == 0, result.stderr
        identity = json.loads(result.stdout.strip())
        assert identity['identity']['lease'] == str(self.lease)
        assert identity['identity']['container_id'] == self.cid and identity['identity']['source_database'] == 'postgres'
        assert identity['database'] == self.db and type(identity['oid']) is int and identity['oid'] > 0
        self.oid = identity['oid']
        self.prefix = 'sc-race-' + uuid.uuid4().hex[:8]
        self.processes: list[subprocess.Popen] = []
        self.passed: list[str] = []
        self.guard = "do $lease$begin if current_database()<>" + quote(self.db) + \
            " or (select oid::bigint from pg_database where datname=current_database())<>" + str(self.oid) + \
            " or not exists(select 1 from private.operator_fixture_clone_identity where singleton and lease=" + quote(str(self.lease)) + \
            "::uuid and container_id=" + quote(self.cid) + " and source_database='postgres') then raise exception 'clone_identity_changed';end if;end $lease$;"

    def sql(self, body: str) -> str:
        result = subprocess.run(self.cmd, input=self.guard + body, capture_output=True, text=True, timeout=30)
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout.strip()

    def document(self, body: str):
        output = self.sql(body)
        values = [json.loads(line) for line in output.split('\n') if line.startswith(('{', '['))]
        assert values, output
        return values[-1]

    def start(self, label: str, body: str, delay=0):
        application = self.prefix + '-' + label
        assert len(application.encode()) <= 63
        process = subprocess.Popen(self.cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.processes.append(process)
        process.stdin.write(self.guard + 'set application_name=' + quote(application) + ";begin;set local lock_timeout='8s';" + body +
                            (f'select pg_sleep({delay});' if delay else '') + 'commit;')
        process.stdin.close()
        process.stdin = None
        return process

    def wait(self, label, event, process):
        deadline = time.monotonic() + 12
        while time.monotonic() < deadline:
            observed = self.sql("begin read only;select coalesce(wait_event_type,'') from pg_stat_activity where application_name=" +
                                quote(self.prefix + '-' + label) + ';rollback;')
            if observed == event:
                return
            if process.poll() is not None:
                raise RuntimeError(label + ' ended before ' + event + ': ' + str(process.communicate()))
            time.sleep(.025)
        raise RuntimeError(label + ' never reached ' + event)

    def finish(self, process, error=None):
        output, stderr = process.communicate(timeout=15)
        assert '40P01' not in stderr and 'deadlock' not in stderr.lower(), stderr
        if error:
            assert process.returncode and error in stderr, (output, stderr)
            return None
        assert process.returncode == 0, stderr
        values = [json.loads(line) for line in output.split('\n') if line.startswith(('{', '['))]
        return values[-1] if values else output.strip()

    def done(self, name):
        assert name == EXPECTED_RACES[len(self.passed)], 'Unexpected or repeated race'
        self.passed.append(name)
        print('PASS ' + name, flush=True)

    def pair(self, name, first_body, second_body, error=None, equal=False):
        first = self.start(name + '-first', first_body, 1.4)
        self.wait(name + '-first', 'Timeout', first)
        second = self.start(name + '-second', second_body)
        self.wait(name + '-second', 'Lock', second)
        before, after = self.finish(first), self.finish(second, error)
        if equal:
            assert before == after
        self.done(name)
        return before, after

    def contention(self, name, held_body, request_body, retry_error, after_error=None):
        first = self.start(name + '-holder', held_body, 1.4)
        self.wait(name + '-holder', 'Timeout', first)
        second = self.start(name + '-writer', request_body)
        self.finish(second, retry_error)
        assert first.poll() is None, 'NOWAIT contention was not observed while holder remained active'
        result = self.finish(first)
        if after_error:
            self.finish(self.start(name + '-retry', request_body), after_error)
        self.done(name)
        return result

    def close(self):
        for process in self.processes:
            if process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)
        assert all(process.poll() is not None for process in self.processes), 'Owned client process remains'
        assert self.sql("begin read only;select count(*) from pg_stat_activity where application_name like " +
                        quote(self.prefix + '-%') + ";rollback;") == '0', 'Owned database session remains'


def context(operation, command, group_number, revision, actor=ACTOR, session=SESSION):
    return dict(operationId=ident(operation), command=command, groupId=ident(group_number) if group_number else None,
                expectedRevision=revision, expectedActorId=actor, expectedSessionId=session)


def values(mode='min', enabled=True, default=False):
    return dict(name='TEST 경합 그룹', enabled=enabled, archived=False, isDefault=default,
                calculationMode=mode, regional={'mode': 'inherit', 'policy': None})


def save_request(clone, operation, group_number, group_values=None, actor=ACTOR, session=SESSION, origin_number=101):
    listing = clone.document('begin;' + auth(actor, session) + 'select public.admin_list_shipping_charge_groups(' +
                             quote(ident(origin_number)) + ",'','all',1," + quote(actor) + ',' + quote(session) + ');commit;')
    origin = listing['origins'][0]
    current = next((row for row in listing['groups'] if row['id'] == ident(group_number)), None)
    return {**context(operation, 'save', group_number, current['revision'] if current else 0, actor, session),
            'originId': origin['id'], 'originUpdatedAt': origin['updatedAt'], 'expectedDefaultGroupId': origin['defaultGroupId'],
            'expectedDefaultGroupRevision': origin['defaultGroupRevision'],
            'values': group_values or {key: current[key] for key in VALUE_KEYS}, 'attestRegional': False}


def preview(clone, ids, group_number=201, actor=ACTOR, session=SESSION):
    return clone.document('begin;' + auth(actor, session) + 'select public.admin_preview_shipping_charge_group_assignment(' +
                          (quote(ident(group_number)) if group_number else 'null') + ',array[' + ','.join(map(quote, ids)) + ']::text[],' +
                          quote(actor) + ',' + quote(session) + ');commit;')


def assignment_request(operation, document):
    group = document['group']
    return {**context(operation, 'assign', int(group['id'][-12:]) if group else None, group['revision'] if group else 0,
                      document['actorId'], document['sessionId']), 'origins': document['origins'],
            'goods': [{key: row[key] for key in GUARD_KEYS} for row in document['goods']]}


def operation_body(request):
    name = 'admin_save_shipping_charge_group' if request['command'] == 'save' else 'admin_assign_shipping_charge_group'
    return auth(request['expectedActorId'], request['expectedSessionId']) + 'select public.' + name + '(' + js(request) + ');'


def seal_body(request):
    return auth(request['expectedActorId'], request['expectedSessionId']) + 'select public.admin_seal_shipping_charge_group_operation(' + \
        js({key: request[key] for key in CONTEXT_KEYS}) + ');'


def absent(clone, operation, table='private.shipping_charge_group_operations'):
    assert clone.sql('begin read only;select count(*) from ' + table + ' where operation_id=' + quote(ident(operation)) + ';rollback;') == '0'


def cart(clone, ids):
    previous = clone.document('begin read only;select coalesce(jsonb_agg(jsonb_build_object(\'goodId\',good_id,\'variantId\',variant_id)),\'[]\') '
                              'from public.cart_items where user_id=' + quote(BUYER) + ';rollback;')
    variants = clone.document('begin read only;select jsonb_object_agg(good_id,id) from public.goods_variants where is_default and good_id in(' +
                              ','.join(map(quote, ids)) + ');rollback;')
    body = auth(BUYER, ident(15))
    for row in previous:
        body += 'select public.set_cart_item_quantity(' + quote(row['goodId']) + ',' + quote(row['variantId']) + ',0);'
    for good_id in ids:
        body += 'select public.set_cart_item_quantity(' + quote(good_id) + ',' + quote(variants[good_id]) + ',1);'
    clone.sql('begin;' + body + 'commit;')
    return clone.document("begin read only;select jsonb_agg(jsonb_build_object('good_id',good_id,'variant_id',variant_id,'qty',qty,"
                          "'input_revision',input_revision,'input_values',input_values) order by good_id) from public.cart_items where user_id=" + quote(BUYER) + ';rollback;')


def quote_body(selection):
    return auth(BUYER, ident(15), 'service_role') + 'select public.quote_cart_goods_transaction(' + quote(BUYER) + ',' + js(selection) + ',' + \
        js(ADDRESS) + ",'{}',null,0);"


def place_body(selection, quoted, checkout_number):
    return auth(BUYER, ident(15), 'service_role') + 'select public.place_cart_goods_transaction(' + quote(BUYER) + ',' + js(selection) + ',' + \
        js(ADDRESS) + ',' + quote(quoted['quoteId']) + ',' + quote(ident(checkout_number)) + ",'card');"


def run():
    clone = OwnedClone()
    try:
        assert clone.sql("begin read only;select count(*) from supabase_migrations.schema_migrations where version in('20261014121521','20261014122555','20261015001607');rollback;") == '3'
        assert clone.sql('begin read only;select count(*) from auth.users where id=' + quote(ACTOR) + ';rollback;') == '0'
        tests = Path(__file__).resolve().parent
        fixture_source = (tests / 'shipping_charge_groups.sql').read_text()
        fixture_marker = '-- SHIPPING_CHARGE_GROUP_FIXTURE_END'
        assert fixture_source.count(fixture_marker) == 1, 'Expected exactly one fixture boundary marker'
        fixture = fixture_source.split(fixture_marker)[0]
        clone.sql((tests / 'helpers/goods_kc_fixture.sql').read_text() + fixture + '\ncommit;')
        clone.sql('update private.goods_transaction_runtime set enabled=true where singleton;')
        for number, mode, default in ((201, 'min', True), (202, 'max', False), (204, 'min', False), (205, 'min', False), (206, 'min', False)):
            clone.sql('begin;' + operation_body(save_request(clone, 700 + number, number, values(mode, default=default))) + 'commit;')
        first = assignment_request(710, preview(clone, ['sc-good-001', 'sc-good-002']))
        clone.sql('begin;' + operation_body(first) + 'commit;')
        published = ['sc-good-001', 'sc-good-002', 'sc-good-010', 'sc-good-011']
        ids_sql = ','.join(map(quote, published))
        clone.sql((tests / 'helpers/goods_kc_fixture.sql').read_text() + "begin;insert into auth.users(id,aud,role,email,raw_app_meta_data,created_at,updated_at) "
                  "select ('47c47700'||left(md5(id),24))::uuid,'authenticated','authenticated','sc-race-kc-'||md5(id)||'@example.test',"
                  "'{\"testFixture\":\"goods-kc\"}',now(),now() from public.goods where id in(" + ids_sql + ");"
                  "insert into private.operator_memberships(profile_id,manager_role) select ('47c47700'||left(md5(id),24))::uuid,'primary' from public.goods where id in(" + ids_sql + ');' +
                  'select pg_temp.publish_goods_kc_fixture(id) from public.goods where id in(' + ids_sql + ');commit;')

        selection = cart(clone, ['sc-good-001', 'sc-good-002'])
        request = save_request(clone, 711, 201, values('max', default=True), DEPUTY, DEPUTY_SESSION)
        clone.contention('quote-before-group-save', quote_body(selection), operation_body(request), 'shipping_charge_group_retry')
        absent(clone, 711)
        clone.sql('begin;' + operation_body(request) + 'commit;')

        request = save_request(clone, 712, 201, values('min', default=True), DEPUTY, DEPUTY_SESSION)
        saved, quoted = clone.pair('save-before-quote', operation_body(request), quote_body(selection))
        assert quoted['state'] == 'quoted' and quoted['display']['shipping'][0]['chargeDetails']['groups'][0]['revision'] == saved['group']['revision']

        quoted = clone.document('begin;' + quote_body(selection) + 'commit;')
        request = save_request(clone, 713, 201, values('max', default=True), DEPUTY, DEPUTY_SESSION)
        clone.pair('save-before-stale-place', operation_body(request), place_body(selection, quoted, 801), 'transaction_quote_changed')
        assert clone.sql('begin read only;select count(*) from public.orders where checkout_key=' + quote(ident(801)) + ';rollback;') == '0'

        selection = cart(clone, ['sc-good-010'])
        request = assignment_request(714, preview(clone, ['sc-good-010'], 202, DEPUTY, DEPUTY_SESSION))
        _, quoted = clone.pair('first-assignment-before-quote', operation_body(request), quote_body(selection))
        assert quoted['display']['shipping'][0]['chargeDetails']['groups'][0]['groupId'] == ident(202)

        request = assignment_request(716, preview(clone, ['sc-good-012'], 201, DEPUTY, DEPUTY_SESSION))
        clone.contention('origin-edit-before-assignment', "update public.goods set origin_id=" + quote(ident(102)) + " where id='sc-good-012';",
                         operation_body(request), 'shipping_charge_group_retry', 'shipping_charge_group_goods_changed')
        absent(clone, 716)

        clone.sql('begin;' + operation_body(assignment_request(717, preview(clone, ['sc-good-013']))) + 'commit;')
        request = assignment_request(718, preview(clone, ['sc-good-013'], None, DEPUTY, DEPUTY_SESSION))
        clone.pair('clear-before-origin-move', operation_body(request), "update public.goods set origin_id=" + quote(ident(102)) + " where id='sc-good-013';")
        assert clone.sql("begin read only;select group_id is null from private.shipping_charge_group_assignments where owner_good_id='sc-good-013';rollback;") == 't'

        first_default = save_request(clone, 719, 202, values('max', default=True))
        second_default = save_request(clone, 720, 204, values('min', default=True), DEPUTY, DEPUTY_SESSION)
        clone.contention('concurrent-default-switch', operation_body(first_default), operation_body(second_default),
                         'shipping_charge_group_retry', 'shipping_charge_group_default_changed')
        absent(clone, 720)
        assert clone.sql('begin read only;select count(*) from private.shipping_charge_groups where origin_id=' + quote(ident(101)) + ' and is_default;rollback;') == '1'

        request = assignment_request(721, preview(clone, ['sc-good-014'], 205, DEPUTY, DEPUTY_SESSION))
        disable = save_request(clone, 722, 205, values('min', enabled=False))
        clone.contention('assignment-before-disable', operation_body(request), operation_body(disable), 'shipping_charge_group_retry', 'shipping_charge_group_has_assignments')
        absent(clone, 722)

        request = assignment_request(723, preview(clone, ['sc-good-015'], 206, DEPUTY, DEPUTY_SESSION))
        disable = save_request(clone, 724, 206, {**values('min', enabled=False), 'archived': True})
        clone.contention('archive-before-assignment', operation_body(disable), operation_body(request), 'shipping_charge_group_retry', 'shipping_charge_group_changed')
        absent(clone, 723)

        ids = ['sc-good-' + str(n).zfill(3) for n in range(11, 111)]
        # Earlier origin races intentionally moved two goods. Return them while
        # unassigned, then capture the real 100-target preview.
        clone.sql("update public.goods set origin_id=" + quote(ident(101)) + " where id in('sc-good-012','sc-good-013');")
        request = assignment_request(725, preview(clone, ids, 201, DEPUTY, DEPUTY_SESSION))
        before = clone.sql("begin read only;select md5(coalesce(string_agg(to_jsonb(a)::text,'|' order by owner_good_id),'')) from private.shipping_charge_group_assignments a;rollback;")
        clone.contention('hundred-target-stale-atomic', "update public.goods set individual_fee=1234 where id='sc-good-110';",
                         operation_body(request), 'shipping_charge_group_retry', 'shipping_charge_group_goods_changed')
        absent(clone, 725)
        assert before == clone.sql("begin read only;select md5(coalesce(string_agg(to_jsonb(a)::text,'|' order by owner_good_id),'')) from private.shipping_charge_group_assignments a;rollback;")

        template_id = ident(250)
        template = dict(operationId=ident(750), command='save', templateId=template_id, expectedRevision=0,
                        expectedActorId=ACTOR, expectedSessionId=SESSION, name='TEST 경합 템플릿', enabled=True,
                        settings=dict(originId=ident(101), feeType='individual', individualFee=2500,
                                      claimPolicy=dict(returnAllowed=True, exchangeAllowed=True, restrictionReason=None, returnFee=0,
                                                       returnFreeShippingFee=None, exchangeFee=6000),
                                      delivery={'mode': 'preserve'}, chargeGroup={'mode': 'assign', 'groupId': ident(202)}))
        clone.sql('begin;' + auth() + 'select public.admin_save_shipping_settings_template_v3(' + js(template) + ');commit;')
        template_preview = clone.document('begin;' + auth() + 'select public.admin_preview_shipping_settings_template_v3(' + quote(template_id) +
                                          ",array['sc-good-016']," + quote(ACTOR) + ',' + quote(SESSION) + ');commit;')
        template_guard_keys = tuple(key for key in GUARD_KEYS if key != 'originId')
        template_request = {**{key: template[key] for key in ('templateId', 'expectedActorId', 'expectedSessionId')},
                            'operationId': ident(751), 'command': 'apply', 'expectedRevision': template_preview['template']['revision'],
                            'originUpdatedAt': template_preview['origin']['updatedAt'], 'collectRevision': template_preview['origin']['collectRevision'],
                            'collectVersionId': template_preview['origin']['collectVersionId'],
                            'targetGroup': {key: template_preview['targetGroup'][key] for key in ('id', 'revision')},
                            'goods': [{key: row[key] for key in template_guard_keys} for row in template_preview['goods']]}
        standalone = assignment_request(726, preview(clone, ['sc-good-016'], 201, DEPUTY, DEPUTY_SESSION))
        clone.pair('template-versus-standalone', auth() + 'select public.admin_apply_shipping_settings_template_v3(' + js(template_request) + ');',
                   operation_body(standalone), 'shipping_charge_group_goods_changed')
        absent(clone, 726)

        request = assignment_request(727, preview(clone, ['sc-family-owner'], 201, DEPUTY, DEPUTY_SESSION))
        held = auth(role=None) + "select pg_advisory_xact_lock(hashtextextended('goods-stock-successor-topology:v1',0));" + \
            "insert into public.goods(id,code,ip_id,name,type,price,stock,origin_id,shipping_fee_type,individual_fee) values(" + \
            "'sc-family-race-added','SC-FAMILY-RACE-ADDED','shipping-charge-ip','TEST 추가 공유상품','문구',10000,'ok'," + quote(ident(101)) + ", 'individual',5000);" + \
            "select private.bind_goods_aggregation('sc-family-owner',array['sc-family-race-added']," + quote(ident(752)) + ',' + quote(ACTOR) + ');'
        clone.pair('family-topology-versus-assignment', held, operation_body(request), 'shipping_charge_group_goods_changed')
        absent(clone, 727)

        request = assignment_request(728, preview(clone, ['sc-good-017']))
        sealed, receipt = clone.pair('seal-before-late-assignment', seal_body(request), operation_body(request), equal=True)
        assert sealed['state'] == receipt['state'] == 'sealed'
        read_request = assignment_request(729, preview(clone, ['sc-good-018']))
        reader = auth() + 'select public.admin_read_shipping_charge_group_operation(' + js({key: read_request[key] for key in CONTEXT_KEYS}) + ');'
        clone.pair('write-before-operation-read', operation_body(read_request), reader, equal=True)

        request = assignment_request(730, preview(clone, ['sc-good-019'], 201, DEPUTY, DEPUTY_SESSION))
        clone.contention('runtime-off-before-assignment', 'update private.goods_transaction_runtime set enabled=false where singleton;',
                         operation_body(request), 'shipping_charge_group_retry', 'checkout_contract_upgrade_required')
        absent(clone, 730)
        clone.sql('update private.goods_transaction_runtime set enabled=true where singleton;')
        assert tuple(clone.passed) == EXPECTED_RACES and len(clone.passed) == 15
    finally:
        clone.close()
    destination = Path(os.environ['SHIPPING_CHARGE_GROUPS_OUTPUT']) / 'shipping-charge-concurrency-result.json'
    allowed_output = tests.parent.parent / 'output/shipping-charge-groups-qa-20261015'
    assert destination.parent.resolve().is_relative_to(allowed_output.resolve())
    assert destination.parent.is_dir() and not destination.exists()
    result = dict(status='PASS', database=clone.db, databaseOid=clone.oid, lease=str(clone.lease),
                  sourceDatabaseWrites=0, actualRaces=clone.passed, count=len(clone.passed), noDeadlocks=True,
                  fixtureTransaction='committed_in_owned_clone', cleanupResponsibility='parent_drop_owned_database',
                  ownedClientProcessesRemaining=0, ownedDatabaseSessionsRemaining=0)
    with destination.open('x') as stream:
        os.chmod(destination, 0o600)
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': 'PASS', 'actualRaces': len(clone.passed), 'result': str(destination)}), flush=True)


if __name__ == '__main__':
    run()

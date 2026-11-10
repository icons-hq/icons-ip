import { expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const transport = vi.hoisted(() => ({ actor: '', session: '', calls: [] as string[], last: null as unknown }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: {
  getUser: async () => ({ data: { user: { id: transport.actor } }, error: null }),
  getClaims: async () => ({ data: { claims: { sub: transport.actor, session_id: transport.session } }, error: null }),
} }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: () => ({ rpc: async (name: string, args: unknown) => {
  transport.calls.push(name);
  const response = await fetch(`${process.env.CC_POSTGREST_ORIGIN}/rpc/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CC_SERVICE_TOKEN}` }, body: JSON.stringify(args) });
  const value = await response.json(); transport.last = value; return response.ok ? { data: value, error: null } : { data: null, error: value };
} }) }));
import * as contextRoute from '@/app/api/admin/claim-contact/context/route';
import * as changeRoute from '@/app/api/admin/claim-contact/change/route';
import * as operationRoute from '@/app/api/admin/claim-contact/operation/route';
import * as reshipRoute from '@/app/api/admin/claim-contact/reshipment/route';
import * as historyRoute from '@/app/api/admin/claim-contact/history/route';
import * as customerRoute from '@/app/api/orders/claim-contact/history/route';
import { loadClaimContactCodec } from '@/lib/claim-contact/crypto.server';
import { parseClaimContactContract, type ContextResponse, type RetentionScope } from '@/lib/claim-contact/contracts';
const fixture = JSON.parse(process.env.CC_INTEGRATION_FIXTURE_JSON!);
const order = (n: number) => fixture.orders[n - 1];
const claim = (n: number) => fixture.claims[n - 1];
function sql(query: string) { return execFileSync('docker', ['exec', '-i', fixture.containerId, 'psql', '-X', '-qAt', '-U', 'supabase_admin', '-d', fixture.database, '-v', 'ON_ERROR_STOP=1', '-c', query], { encoding: 'utf8' }).trim(); }
function actor(n: number) { transport.actor = fixture.users[n - 1]; transport.session = fixture.sessions[n - 1]; }
async function post(route: { POST: (r: Request) => Promise<Response> }, path: string, input: unknown, expected = 200) {
  const response = await route.POST(new Request(`http://127.0.0.1:48111${path}`, { method: 'POST', headers: { host: '127.0.0.1:48111', origin: 'http://127.0.0.1:48111', 'content-type': 'application/json' }, body: JSON.stringify(input) }));
  const value = await response.json(); expect(response.status, JSON.stringify({ response: value, lastDb: transport.last })).toBe(expected);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store, max-age=0'); expect(response.headers.get('Vary')).toBe('Cookie');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer'); return value;
}
const contextRequest = (n: number, command = 'change') => ({ requestId: randomUUID(), orderId: order(n), claimId: claim(n), target: 'reshipment', command });
const historyRequest = (n: number) => ({ requestId: randomUUID(), orderId: order(n), claimId: claim(n), limit: 20, cursor: null });
const operationRequest = (n: number, context: Pick<ContextResponse, 'claimRevision'>, operationId: string) => ({ requestId: randomUUID(), orderId: order(n), claimId: claim(n), operationId, command: 'change', target: 'reshipment', expectedClaimType: 'exchange', expectedClaimRevision: context.claimRevision, sealIfAbsent: false });
it('runs actual route + service + AES + PostgREST + SQL save/history/replay/seal/purge', async () => {
  actor(1);
  const context = await post(contextRoute, '/api/admin/claim-contact/context', contextRequest(1));
  expect(parseClaimContactContract('ContextResponse', context)).not.toBeNull(); expect(context.address.postalCode).toBe(' 1234 '); expect(context.address.address1).toBe(' 원본 기본 주소 ');
  const operationId = randomUUID();
  const input = { requestId: randomUUID(), orderId: order(1), claimId: claim(1), target: 'reshipment', operationId, signedContext: context.signedContext,
    contact: { recipientName: '실제 암호문 합성 수취인', phone: '01088887777', address2: '새 상세 101호' }, agreement: '합성 고객과 변경 합의 완료', customerConfirmed: true, handoffNotStartedConfirmed: true };
  const saved = await post(changeRoute, '/api/admin/claim-contact/change', input);
  expect(saved.receipt.state).toBe('saved'); expect(saved.receipt.changedFields).toEqual(['recipientName', 'phone', 'address2']);
  const updated = await post(contextRoute, '/api/admin/claim-contact/context', contextRequest(1));
  expect(updated.address).toMatchObject(input.contact); expect(updated.address.postalCode).toBe(context.address.postalCode);
  const history = await post(historyRoute, '/api/admin/claim-contact/history', historyRequest(1));
  expect(history.entries[0].after).toMatchObject(input.contact); expect(history.entries[0].agreement).toBe(input.agreement);
  const encrypted = JSON.parse(sql(`select jsonb_build_object('plan',sealed_plan,'history',(select history from private.order_claim_contact_operations where id='${operationId}')) from private.order_claim_contact_plans where claim_id='${claim(1)}' and target='reshipment'`));
  expect(encrypted.plan.piiVersion).not.toBe(encrypted.history.piiVersion); expect(JSON.stringify(encrypted)).not.toContain(input.contact.recipientName); expect(JSON.stringify(encrypted)).not.toContain(input.agreement);
  const codec = loadClaimContactCodec();
  expect(codec.openAddress(encrypted.plan.address, { orderId: order(1), claimId: claim(1), target: 'reshipment', recordKind: 'plan', recordId: encrypted.plan.planId, piiVersion: encrypted.plan.piiVersion }, encrypted.plan.keyVersion)).toEqual(updated.address);
  actor(2);
  const customer = await post(customerRoute, '/api/orders/claim-contact/history', historyRequest(1));
  expect(customer.entries[0].agreement).toBeNull(); expect(customer.entries[0].actorId).toBeNull(); expect(customer.entries[0].after).toMatchObject(input.contact);
  actor(1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 660_000);
  const expiredReplay = await post(changeRoute, '/api/admin/claim-contact/change', input); expect(expiredReplay.receipt).toEqual(saved.receipt); clock.mockRestore();
  process.env.ICONS_CLAIM_CONTACT_ENABLED = '0'; sql('update private.order_claim_contact_runtime set enabled=false where singleton;');
  const replay = await post(changeRoute, '/api/admin/claim-contact/change', input); expect(replay.receipt).toEqual(saved.receipt);
  const keyring = process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON; delete process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON;
  const before = transport.calls.length;
  const recovered = await post(operationRoute, '/api/admin/claim-contact/operation', operationRequest(1, context, operationId));
  expect(recovered.receipt).toEqual(saved.receipt); expect(transport.calls.slice(before)).toEqual(['service_read_order_claim_contact_operation']);
  process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON = keyring;
  const absent = operationRequest(2, { claimRevision: 0 }, randomUUID());
  const sealed = await post(operationRoute, '/api/admin/claim-contact/operation', { ...absent, sealIfAbsent: true }); expect(sealed.receipt.state).toBe('sealed');
  process.env.ICONS_CLAIM_CONTACT_ENABLED = '1'; sql('update private.order_claim_contact_runtime set enabled=true where singleton;');
  sql(`update public.order_cancellation_requests set stage='rejected',decided_at=clock_timestamp()-interval '40 days',decided_by='${fixture.users[0]}',decision_note='TEST terminal' where id='${claim(1)}';`);
  const due = await post(historyRoute, '/api/admin/claim-contact/history', historyRequest(1)); expect(due.current.reshipment.unavailableReason).toBe('retention_due'); expect(due.entries[0].before).toBeNull(); expect(due.entries[0].agreement).toBeNull();
  const receipt = sql(`begin;select set_config('request.jwt.claim.role','service_role',true);select public.service_purge_order_claim_contact_data('${fixture.users[1]}','${fixture.users[0]}','${fixture.sessions[0]}','${randomUUID()}',clock_timestamp(),100);commit;`);
  expect(receipt).toContain('"selectedResidualPiiFields": 0');
  const purged = await post(historyRoute, '/api/admin/claim-contact/history', historyRequest(1)); expect(purged.current.reshipment.piiState).toBe('purged');
  const retry = await post(changeRoute, '/api/admin/claim-contact/change', input, 410); expect(retry.code).toBe('claim_contact_purged');
});
it('commits actual encrypted reshipment destination and reads it back', async () => {
  actor(1); sql(`update public.order_cancellation_requests set stage='collected',collected_at=clock_timestamp() where id='${claim(3)}';`);
  const context = await post(contextRoute, '/api/admin/claim-contact/context', contextRequest(3, 'reshipment'));
  const input = { requestId: randomUUID(), orderId: order(3), claimId: claim(3), operationId: randomUUID(), signedContext: context.signedContext, carrier: 'hanjin', trackingNumber: 'REALHTTP0003', items: [], destinationConfirmed: true, dispatchConfirmed: true };
  const saved = await post(reshipRoute, '/api/admin/claim-contact/reshipment', input); expect(saved.receipt.state).toBe('saved');
  const history = await post(historyRoute, '/api/admin/claim-contact/history', historyRequest(3)); expect(history.reshipmentDestination.source).toBe('v2_confirmed'); expect(history.reshipmentDestination.address).toEqual(context.address);
  const replay = await post(reshipRoute, '/api/admin/claim-contact/reshipment', input); expect(replay.receipt).toEqual(saved.receipt);
  expect(sql(`select current_setting('request.jwt.claim.sub',true) is null;`)).toBe('t');
});
it('denies direct anonymous/customer RPC execution and cross-origin/raw GET routes', async () => {
  const input = { p_order_id: order(4), p_claim_id: claim(4), p_actor_id: fixture.users[0], p_session_id: fixture.sessions[0], p_target: 'reshipment', p_command: 'change' };
  for (const token of [undefined, process.env.CC_CUSTOMER_TOKEN]) {
    const response = await fetch(`${process.env.CC_POSTGREST_ORIGIN}/rpc/service_get_order_claim_contact_context`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(input) });
    expect([401, 403, 404]).toContain(response.status); expect(await response.text()).not.toContain('recipientName');
  }
  const response = await contextRoute.POST(new Request('http://127.0.0.1:48111/api/admin/claim-contact/context', { method: 'POST', headers: { host: '127.0.0.1:48111', origin: 'http://other.test', 'content-type': 'application/json' }, body: JSON.stringify(contextRequest(4)) }));
  expect(response.status).toBe(403); expect(response.headers.get('Cache-Control')).toContain('no-store'); expect(contextRoute.GET().status).toBe(405);
});
it('runs authenticated inventory, finite retention exceptions and bounded purge with no feature keys', async () => {
  const retentionRoute = await import('@/app/api/admin/claim-contact/retention/route');
  actor(1);
  sql(`update public.order_cancellation_requests set stage='rejected',decided_at=clock_timestamp()-interval '40 days',decided_by='${fixture.users[0]}',decision_note='TEST retention terminal' where id='${claim(4)}';`);
  const savedKeyring = process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON;
  delete process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON; process.env.ICONS_CLAIM_CONTACT_ENABLED = '0'; sql('update private.order_claim_contact_runtime set enabled=false where singleton;');
  const inventoryInput = { requestId: randomUUID(), operation: 'inventory', subjectId: fixture.users[1], limit: 100, afterClaimId: null };
  const inventory = await post(retentionRoute, '/api/admin/claim-contact/retention', inventoryInput);
  expect(parseClaimContactContract('ContactDataInventory', inventory.data)).not.toBeNull(); expect(inventory.data.scopes.find((s: RetentionScope) => s.claimId === claim(4)).state).toBe('due');
  const heldInput = { requestId: randomUUID(), operation: 'case', orderId: order(4), claimId: claim(4), operationId: randomUUID(), expectedCaseRevision: 0,
    case: { action: 'hold', caseRef: 'HTTP-CASE-4', approvalRef: 'HTTP-APPROVAL', legalBasis: 'statutory_preservation', retainUntil: new Date(Date.now() + 3600_000).toISOString(), occurredAt: new Date(Date.now() - 1000).toISOString() } };
  const held = await post(retentionRoute, '/api/admin/claim-contact/retention', heldInput); expect(held.data.state).toBe('held');
  const heldReplay = await post(retentionRoute, '/api/admin/claim-contact/retention', heldInput); expect(heldReplay.data).toEqual(held.data);
  const purgeInput = () => ({ requestId: randomUUID(), operation: 'purge', subjectId: fixture.users[1], operationId: randomUUID(), cutoff: new Date().toISOString(), limit: 100, confirmed: true });
  const withheld = await post(retentionRoute, '/api/admin/claim-contact/retention', purgeInput()); expect(withheld.data.purgedClaimIds).not.toContain(claim(4));
  const released = await post(retentionRoute, '/api/admin/claim-contact/retention', { ...heldInput, requestId: randomUUID(), operationId: randomUUID(), expectedCaseRevision: 1, case: { ...heldInput.case, action: 'release', retainUntil: null, occurredAt: new Date().toISOString() } });
  expect(released.data.state).toBe('released'); expect(released.data.caseClosedAt).toBeNull();
  const purge = purgeInput(); const removed = await post(retentionRoute, '/api/admin/claim-contact/retention', purge);
  expect(removed.data.purgedClaimIds).toContain(claim(4)); expect(removed.data.selectedResidualPiiFields).toBe(0);
  const replay = await post(retentionRoute, '/api/admin/claim-contact/retention', purge); expect(replay.data).toEqual(removed.data);
  await post(retentionRoute, '/api/admin/claim-contact/retention', { ...purgeInput(), confirmed: false }, 400);
  await post(retentionRoute, '/api/admin/claim-contact/retention', { ...inventoryInput, actorId: fixture.users[0] }, 400);
  actor(2); await post(retentionRoute, '/api/admin/claim-contact/retention', inventoryInput, 403); actor(1);
  sql(`update private.operator_memberships set manager_role='deputy' where profile_id='${fixture.users[0]}';`);
  await post(retentionRoute, '/api/admin/claim-contact/retention', purge, 403);
  sql(`update private.operator_memberships set manager_role='primary' where profile_id='${fixture.users[0]}';update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${fixture.sessions[0]}';`);
  await post(retentionRoute, '/api/admin/claim-contact/retention', inventoryInput, 403);
  sql(`update auth.sessions set not_after=clock_timestamp()+interval '1 hour' where id='${fixture.sessions[0]}';`);
  process.env.ICONS_CLAIM_CONTACT_KEYRING_JSON = savedKeyring; process.env.ICONS_CLAIM_CONTACT_ENABLED = '1'; sql('update private.order_claim_contact_runtime set enabled=true where singleton;');
});

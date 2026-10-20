import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), createService: vi.fn(), revalidate: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidate }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createService }));
import { changeClaimContact, fetchAdminClaimContactHistory, fetchClaimContactContext, fetchMyClaimContactHistory, readOrSealClaimContactOperation, recordClaimReshipmentV2 } from './service.server';
import { loadClaimContactCodec } from './crypto.server';
import type { Address, ChangeRequest, ContextClaims, DbContactContext, DbContactHistory, DbHistoryEntry, DbTargetView, OperationReceipt, OperationRequest, ReshipmentRequest } from './contracts';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const material = (seed: number) => ({ encryptionKey: Buffer.alloc(32, seed).toString('base64url'), addressHmacKey: Buffer.alloc(32, seed + 1).toString('base64url'),
  requestHmacKey: Buffer.alloc(32, seed + 2).toString('base64url'), contextSigningKey: Buffer.alloc(32, seed + 3).toString('base64url') });
const keyring = (active = 'one') => JSON.stringify({ v: 1, environment: 'local', backendOrigin: 'http://127.0.0.1:54321', activeKeyVersion: active, keys: { one: material(10), two: material(20) } });
const now = Date.parse('2026-10-14T00:00:00.000Z');
const address: Address = { recipientName: '합성 고객', phone: '01012345678', postalCode: ' 12345 ', address1: ' 합성 기본주소 100 ', address2: '' };
const contextRequest = { requestId: id(1), orderId: id(2), claimId: id(3), target: 'collection' as const, command: 'change' as const };
const actorId = id(4), sessionId = id(5), operationId = id(6);
const source = { sourceKind: 'order_delivery' as const, sourceId: contextRequest.orderId, sourceRevision: '4', sourceFingerprint: 'a'.repeat(64), planRevision: 0, piiVersion: null };
function current(target: 'collection' | 'reshipment' = 'collection'): DbTargetView {
  return { target, piiState: 'available', unavailableReason: null, source, referenceOnly: true, sourceAddress: address, plan: null };
}
function dbContext(): DbContactContext {
  return { orderId: contextRequest.orderId, claimId: contextRequest.claimId, target: 'collection', command: 'change', claimType: 'return', claimRevision: 7,
    allowed: true, blocker: null, current: current() };
}
function claims(command: 'change' | 'reshipment' = 'change'): ContextClaims {
  const codec = loadClaimContactCodec(), target = command === 'change' ? 'collection' : 'reshipment';
  return { v: 1, purpose: `claim-contact/${command}-context`, environment: codec.environment, backendOrigin: codec.backendOrigin,
    actorId, sessionId, orderId: contextRequest.orderId, claimId: contextRequest.claimId, target, expectedClaimType: command === 'change' ? 'return' : 'exchange', expectedClaimRevision: 7,
    source, addressHmac: codec.addressHmac(address, { ...contextRequest, target }), addressHmacKeyVersion: codec.activeKeyVersion,
    issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 600_000).toISOString(), signingKeyVersion: codec.activeKeyVersion };
}
function changeInput(context = claims()): ChangeRequest {
  return { requestId: contextRequest.requestId, orderId: contextRequest.orderId, claimId: contextRequest.claimId, target: contextRequest.target,
    operationId, signedContext: loadClaimContactCodec().signContext(context), contact: { recipientName: '새 합성 고객', phone: address.phone, address2: address.address2 },
    agreement: '합성 고객과 변경 합의', customerConfirmed: true, handoffNotStartedConfirmed: true };
}
const cleanChange = changeInput;
function receipt(overrides: Partial<OperationReceipt> = {}): OperationReceipt {
  return { operationId, command: 'change', orderId: contextRequest.orderId, claimId: contextRequest.claimId, target: 'collection', actorId, sessionId,
    expectedClaimType: 'return', expectedClaimRevision: 7, resultClaimRevision: 8, state: 'saved', changedFields: ['recipientName'], recordedAt: new Date(now).toISOString(), piiState: 'retained', ...overrides };
}
const operation: OperationRequest = { requestId: id(1), orderId: contextRequest.orderId, claimId: contextRequest.claimId, operationId, command: 'change', target: 'collection', expectedClaimType: 'return', expectedClaimRevision: 7, sealIfAbsent: false };
const ok = (data: unknown) => ({ data, error: null });
function handler(name: string) {
  if (name === 'service_read_order_claim_contact_operation') return ok({ receipt: null, hmacKeyVersion: null });
  if (name === 'service_get_order_claim_contact_context') return ok(dbContext());
  if (name === 'service_change_order_claim_contact') return ok(receipt());
  throw new Error('unexpected synthetic RPC');
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('ICONS_CLAIM_CONTACT_ENVIRONMENT', 'local');
  vi.stubEnv('ICONS_CLAIM_CONTACT_ENABLED', '1'); vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', keyring());
  mocks.getUser.mockReset().mockResolvedValue({ data: { user: { id: actorId } }, error: null });
  mocks.getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: actorId, session_id: sessionId } }, error: null });
  mocks.rpc.mockReset().mockImplementation(handler); mocks.createService.mockReset().mockReturnValue({ rpc: mocks.rpc });
  mocks.revalidate.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('authenticated contact context and keyless recovery', () => {
  it('checks getUser then verified claims before deriving server-only actor/session and creating service client', async () => {
    const response = await fetchClaimContactContext(contextRequest);
    expect(response).toMatchObject({ actorId, sessionId, address, allowed: true, unavailableReason: null });
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getClaims.mock.invocationCallOrder[0]);
    expect(mocks.getClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.createService.mock.invocationCallOrder[0]);
    expect(mocks.rpc).toHaveBeenCalledWith('service_get_order_claim_contact_context', { p_order_id: contextRequest.orderId, p_claim_id: contextRequest.claimId, p_actor_id: actorId, p_session_id: sessionId, p_target: 'collection', p_command: 'change' });
    if (!('signedContext' in response) || !response.signedContext) throw new Error('missing context');
    expect(loadClaimContactCodec().verifyContext(response.signedContext, { actorId, sessionId, ...contextRequest })).toMatchObject({ expectedClaimRevision: 7, source });
    expect(response.expiresAt).toBe(new Date(now + 600_000).toISOString());
  });
  it.each(['missing-user', 'user-error', 'claims-error', 'sub-mismatch', 'missing-session', 'invalid-session'])('rejects %s before any service access', async state => {
    if (state === 'missing-user') mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (state === 'user-error') mocks.getUser.mockResolvedValue({ data: { user: { id: actorId } }, error: { message: 'synthetic private detail' } });
    if (state === 'claims-error') mocks.getClaims.mockResolvedValue({ data: null, error: { message: 'synthetic private detail' } });
    if (state === 'sub-mismatch') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: id(99), session_id: sessionId } }, error: null });
    if (state === 'missing-session') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actorId } }, error: null });
    if (state === 'invalid-session') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actorId, session_id: 'bad' } }, error: null });
    expect(await readOrSealClaimContactOperation(operation)).toMatchObject({ code: 'auth_changed' });
    expect(mocks.createService).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([undefined, 'malformed synthetic keyring'])('recovers and seals with feature OFF and %s keys without crypto or source reads', async ring => {
    vi.stubEnv('ICONS_CLAIM_CONTACT_ENABLED', '0'); vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', ring);
    expect(await readOrSealClaimContactOperation(operation)).toMatchObject({ receipt: null, actorId, sessionId });
    mocks.rpc.mockResolvedValue(ok({ receipt: receipt({ state: 'sealed', resultClaimRevision: null, changedFields: [], piiState: 'not_stored' }), hmacKeyVersion: null }));
    expect(await readOrSealClaimContactOperation({ ...operation, sealIfAbsent: true })).toMatchObject({ receipt: { state: 'sealed' } });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_read_order_claim_contact_operation']);
    expect(mocks.rpc.mock.calls[1][1].p_seal_if_absent).toBe(true);
    expect(await fetchClaimContactContext(contextRequest)).toMatchObject({ code: 'feature_disabled' });
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
  it('denied/due context returns metadata without a usable token or original-address fallback', async () => {
    mocks.rpc.mockResolvedValue(ok({ ...dbContext(), allowed: false, blocker: 'claim_contact_retention_due', current: { ...current(), piiState: 'unavailable', unavailableReason: 'retention_due', referenceOnly: false, source: null, sourceAddress: null, plan: null } }));
    const response = await fetchClaimContactContext(contextRequest);
    expect(response).toMatchObject({ allowed: false, piiState: 'unavailable', unavailableReason: 'retention_due', address: null, signedContext: null, expiresAt: null });
    expect(JSON.stringify(response)).not.toContain(address.recipientName);
  });
  it('rejects caller identity keys and mismatched result scope', async () => {
    expect(await readOrSealClaimContactOperation({ ...operation, actorId })).toMatchObject({ code: 'invalid_claim_contact_request' });
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue(ok({ receipt: receipt({ actorId: id(99) }), hmacKeyVersion: 'one' }));
    expect(await readOrSealClaimContactOperation(operation)).toMatchObject({ code: 'claim_contact_outcome_unknown' });
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('rechecks current DB capability and never exposes exception, DETAIL or SQL diagnostics', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'auth_changed', details: address.address1 } });
    expect(await readOrSealClaimContactOperation(operation)).toMatchObject({ code: 'auth_changed' });
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: address.recipientName, details: address.address1 } });
    const rejected = await readOrSealClaimContactOperation(operation);
    expect(rejected).toMatchObject({ code: 'claim_contact_outcome_unknown' }); expect(JSON.stringify(rejected)).not.toContain(address.recipientName);
  });
});

describe('contact change persistence and exact replay', () => {
  it('validates original context, preserves postal/basic source, and independently seals plan/before/after/agreement', async () => {
    const input = cleanChange(), response = await changeClaimContact(input);
    expect(response).toMatchObject({ receipt: { operationId, state: 'saved', changedFields: ['recipientName'] } });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_get_order_claim_contact_context', 'service_change_order_claim_contact']);
    const args = mocks.rpc.mock.calls[2][1], sealed = args.p_sealed_change, codec = loadClaimContactCodec();
    const scope = { orderId: input.orderId, claimId: input.claimId, target: input.target };
    expect(codec.openAddress(sealed.plan.address, { ...scope, recordKind: 'plan', recordId: sealed.plan.planId, piiVersion: sealed.plan.piiVersion }, sealed.plan.keyVersion))
      .toEqual({ ...address, recipientName: input.contact.recipientName });
    expect(codec.openAddress(sealed.history.before, { ...scope, recordKind: 'operation_before', recordId: operationId, piiVersion: sealed.history.piiVersion }, sealed.history.keyVersion)).toEqual(address);
    expect(codec.openAddress(sealed.history.after, { ...scope, recordKind: 'operation_after', recordId: operationId, piiVersion: sealed.history.piiVersion }, sealed.history.keyVersion)).toEqual({ ...address, recipientName: input.contact.recipientName });
    expect(codec.openField(sealed.history.agreement, { ...scope, recordKind: 'operation_agreement', recordId: operationId, piiVersion: sealed.history.piiVersion }, 'agreement', sealed.history.keyVersion)).toBe(input.agreement);
    expect(sealed.plan.address.phone.iv).not.toBe(sealed.history.after.phone.iv);
    for (const pii of [address.recipientName, address.phone, address.address1, input.contact.recipientName, input.agreement]) expect(JSON.stringify(args)).not.toContain(pii);
    expect(args.p_expected_context).toMatchObject({ ...source, addressHmac: claims().addressHmac });
    expect(mocks.revalidate.mock.calls).toEqual(expect.arrayContaining([
      ['/admin/sales/claims/returns', undefined], [`/admin/sales/claims/returns/${input.claimId}`, undefined],
      ['/admin/sales/orders', undefined], [`/admin/sales/orders/${input.orderId}`, undefined], ['/admin/sales/dispatch', undefined],
      ['/orders', undefined], [`/orders/${input.orderId}`, undefined], ['/gifts', undefined], ['/gifts/[giftId]', 'page'],
    ]));
    expect(mocks.revalidate.mock.calls.some(call => ['/shop', '/ip', '/cart', '/checkout', '/admin/catalog/goods'].includes(call[0]))).toBe(false);
  });
  it('normalizes the allowed edit before HMAC and leaves explicit empty detail valid', async () => {
    const input = cleanChange();
    const response = await changeClaimContact({ ...input, contact: { ...input.contact, recipientName: `  ${input.contact.recipientName}  `, phone: '+(010) 1234-5678', address2: '  ' }, agreement: ` ${input.agreement} ` });
    expect(response).toHaveProperty('receipt');
    expect(mocks.rpc.mock.calls[2][1].p_request_hmac).toBe(loadClaimContactCodec().requestHmac(claims(), input));
  });
  it('checks a retained plan HMAC, preserves its plan ID and reseals at the active key version', async () => {
    const codec = loadClaimContactCodec(), planId = id(40), piiVersion = id(41), planSource = { sourceKind: 'contact_plan' as const, sourceId: planId, sourceRevision: null, sourceFingerprint: null, planRevision: 2, piiVersion };
    const plan = { planId, piiVersion, keyVersion: 'one', addressHmac: codec.addressHmac(address, contextRequest), addressHmacKeyVersion: 'one',
      address: codec.sealAddress(address, { orderId: contextRequest.orderId, claimId: contextRequest.claimId, target: 'collection', recordKind: 'plan', recordId: planId, piiVersion }) };
    const originalClaims = { ...claims(), source: planSource }, input = cleanChange(originalClaims);
    vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', keyring('two'));
    mocks.rpc.mockImplementation(name => name === 'service_get_order_claim_contact_context' ? ok({ ...dbContext(), current: { ...current(), source: planSource, sourceAddress: null, referenceOnly: false, plan } }) : handler(name));
    expect(await changeClaimContact(input)).toHaveProperty('receipt');
    const payload = mocks.rpc.mock.calls[2][1].p_sealed_change;
    expect(payload.plan.planId).toBe(planId); expect(payload.plan.piiVersion).not.toBe(piiVersion);
    expect(payload.plan.keyVersion).toBe('two'); expect(payload.addressHmacKeyVersion).toBe('two');
    expect(payload.beforeAddressHmac).toBe(loadClaimContactCodec().addressHmac(address, contextRequest));
    expect(mocks.rpc.mock.calls[2][1].p_expected_context.addressHmacKeyVersion).toBe('one');
  });
  it('refuses an authenticated plan envelope whose stored address HMAC does not match its plaintext', async () => {
    const codec = loadClaimContactCodec(), planId = id(40), piiVersion = id(41), planSource = { sourceKind: 'contact_plan' as const, sourceId: planId, sourceRevision: null, sourceFingerprint: null, planRevision: 2, piiVersion };
    const plan = { planId, piiVersion, keyVersion: 'one', addressHmac: 'b'.repeat(64), addressHmacKeyVersion: 'one',
      address: codec.sealAddress(address, { orderId: contextRequest.orderId, claimId: contextRequest.claimId, target: 'collection', recordKind: 'plan', recordId: planId, piiVersion }) };
    mocks.rpc.mockImplementation(name => name === 'service_get_order_claim_contact_context' ? ok({ ...dbContext(), current: { ...current(), source: planSource, sourceAddress: null, referenceOnly: false, plan } }) : handler(name));
    expect(await changeClaimContact(cleanChange({ ...claims(), source: planSource }))).toMatchObject({ code: 'claim_contact_crypto_unavailable' });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it('makes a no-op receipt without redundant plan/history plaintext copies', async () => {
    mocks.rpc.mockImplementation(name => name === 'service_change_order_claim_contact' ? ok(receipt({ state: 'noop', changedFields: [], resultClaimRevision: 7, piiState: 'not_stored' })) : handler(name));
    const input = cleanChange(), response = await changeClaimContact({ ...input, contact: { recipientName: address.recipientName, phone: address.phone, address2: address.address2 } });
    expect(response).toMatchObject({ receipt: { state: 'noop', resultClaimRevision: 7 } });
    const payload = mocks.rpc.mock.calls[2][1].p_sealed_change;
    expect(payload).toMatchObject({ effect: 'noop', changedFields: [], plan: null, history: null });
    expect(payload.beforeAddressHmac).toBe(payload.afterAddressHmac);
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it.each(['revision', 'source', 'address'])('rejects stale %s before writing', async mismatch => {
    mocks.rpc.mockImplementation(name => {
      if (name !== 'service_get_order_claim_contact_context') return handler(name);
      const db = dbContext();
      if (mismatch === 'revision') db.claimRevision++;
      if (mismatch === 'source') db.current.source = { ...source, sourceFingerprint: 'b'.repeat(64) };
      if (mismatch === 'address') db.current.sourceAddress = { ...address, phone: '01099999999' };
      return ok(db);
    });
    expect(await changeClaimContact(cleanChange())).toMatchObject({ code: 'claim_contact_changed' });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it('does not treat expired absent context as a new write', async () => {
    const input = cleanChange(); vi.setSystemTime(now + 600_000);
    expect(await changeClaimContact(input)).toMatchObject({ code: 'claim_contact_context_expired', recoveryOnly: true });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_read_order_claim_contact_operation']);
  });
  it('returns retention due without claiming physical purge when the purpose limit expires after confirmation', async () => {
    const input = cleanChange();
    mocks.rpc.mockImplementation(name => name === 'service_get_order_claim_contact_context' ? ok({ ...dbContext(), allowed: false, blocker: 'claim_contact_retention_due',
      current: { ...current(), piiState: 'unavailable', unavailableReason: 'retention_due', source: null, sourceAddress: null, referenceOnly: false } }) : handler(name));
    expect(await changeClaimContact(input)).toMatchObject({ code: 'claim_contact_retention_due' });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });
  it('converges when the original same-UUID request commits between absent lookup and current revision validation', async () => {
    const original = claims(), input = cleanChange(original), expectedHmac = loadClaimContactCodec().requestHmac(original, input, 'one');
    vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', keyring('two'));
    let reads = 0;
    mocks.rpc.mockImplementation(name => {
      if (name === 'service_read_order_claim_contact_operation') return ok(++reads === 1 ? { receipt: null, hmacKeyVersion: null } : { receipt: receipt(), hmacKeyVersion: 'one' });
      if (name === 'service_get_order_claim_contact_context') return ok({ ...dbContext(), claimRevision: 8 });
      return handler(name);
    });
    expect(await changeClaimContact(input)).toMatchObject({ receipt: { operationId, state: 'saved' } });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_get_order_claim_contact_context', 'service_read_order_claim_contact_operation', 'service_change_order_claim_contact']);
    expect(mocks.rpc.mock.calls[3][1]).toMatchObject({ p_request_hmac: expectedHmac, p_hmac_key_version: 'one', p_sealed_change: null });
  });
  it('still rejects changed input reusing a raced UUID by exact HMAC, without another metadata retry', async () => {
    const original = claims(), input = cleanChange(original); let reads = 0;
    mocks.rpc.mockImplementation(name => {
      if (name === 'service_read_order_claim_contact_operation') return ok(++reads === 1 ? { receipt: null, hmacKeyVersion: null } : { receipt: receipt(), hmacKeyVersion: 'one' });
      if (name === 'service_get_order_claim_contact_context') return ok({ ...dbContext(), claimRevision: 8 });
      if (name === 'service_change_order_claim_contact') return { data: null, error: { code: '23505', message: 'claim_contact_operation_conflict' } };
      return handler(name);
    });
    expect(await changeClaimContact({ ...input, contact: { ...input.contact, phone: '01099999999' } })).toMatchObject({ code: 'claim_contact_operation_conflict' });
    expect(reads).toBe(2); expect(mocks.rpc).toHaveBeenCalledTimes(4);
    expect(mocks.rpc.mock.calls[3][1].p_sealed_change).toBeNull();
  });
  it('exactly replays an expired stored request under its old HMAC key with feature OFF and no current source read/reseal', async () => {
    const originalClaims = claims(), input = cleanChange(originalClaims), expectedHmac = loadClaimContactCodec().requestHmac(originalClaims, input, 'one');
    vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', keyring('two')); vi.stubEnv('ICONS_CLAIM_CONTACT_ENABLED', '0'); vi.setSystemTime(now + 700_000);
    mocks.rpc.mockImplementation(name => name === 'service_read_order_claim_contact_operation' ? ok({ receipt: receipt(), hmacKeyVersion: 'one' }) : name === 'service_change_order_claim_contact' ? ok(receipt()) : (() => { throw new Error('PII read forbidden'); })());
    expect(await changeClaimContact(input)).toMatchObject({ receipt: { state: 'saved' } });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_change_order_claim_contact']);
    expect(mocks.rpc.mock.calls[1][1]).toMatchObject({ p_sealed_change: null, p_request_hmac: expectedHmac, p_hmac_key_version: 'one' });
  });
  it.each(['purged', 'sealed', 'missing-key'])('does not resurrect %s operations', async state => {
    const input = cleanChange();
    mocks.rpc.mockResolvedValue(ok({ receipt: state === 'sealed' ? receipt({ state: 'sealed', changedFields: [], resultClaimRevision: null, piiState: 'not_stored' }) : receipt({ piiState: state === 'purged' ? 'purged' : 'retained' }),
      hmacKeyVersion: state === 'missing-key' ? 'missing' : null }));
    expect(await changeClaimContact(input)).toMatchObject({ code: state === 'purged' ? 'claim_contact_purged' : state === 'sealed' ? 'claim_contact_operation_sealed' : 'claim_contact_crypto_unavailable' });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('resolves an old-key concurrent commit by rereading metadata once and keeps original UUID/input', async () => {
    const originalClaims = claims(), input = cleanChange(originalClaims), expected = loadClaimContactCodec().requestHmac(originalClaims, input, 'one');
    vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', keyring('two'));
    let reads = 0, writes = 0;
    mocks.rpc.mockImplementation(name => {
      if (name === 'service_read_order_claim_contact_operation') return ok(++reads === 1 ? { receipt: null, hmacKeyVersion: null } : { receipt: receipt(), hmacKeyVersion: 'one' });
      if (name === 'service_change_order_claim_contact') return ++writes === 1 ? { data: null, error: { code: '23505', message: 'claim_contact_operation_conflict' } } : ok(receipt());
      return handler(name);
    });
    expect(await changeClaimContact(input)).toMatchObject({ receipt: { operationId } });
    expect(reads).toBe(2); expect(writes).toBe(2);
    const calls = mocks.rpc.mock.calls.filter(call => call[0] === 'service_change_order_claim_contact');
    expect(calls[0][1].p_sealed_change).not.toBeNull();
    expect(calls[1][1]).toMatchObject({ p_operation_id: operationId, p_request_hmac: expected, p_hmac_key_version: 'one', p_sealed_change: null });
  });
  it('keeps original session binding even when current actor stays the same', async () => {
    const input = cleanChange(); mocks.getClaims.mockResolvedValue({ data: { claims: { sub: actorId, session_id: id(99) } }, error: null });
    expect(await changeClaimContact(input)).toMatchObject({ code: 'auth_changed', authChanged: true }); expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('actual reshipment v2', () => {
  function input(): ReshipmentRequest {
    return { requestId: id(1), orderId: contextRequest.orderId, claimId: contextRequest.claimId, operationId, signedContext: loadClaimContactCodec().signContext(claims('reshipment')),
      carrier: '합성택배', trackingNumber: '12345678', items: Array.from({ length: 1000 }, (_, index) => ({ orderItemId: id(1000 + index), variantId: id(2000 + index) })), destinationConfirmed: true, dispatchConfirmed: true };
  }
  function reshipHandler(name: string) {
    if (name === 'service_get_order_claim_contact_context') return ok({ ...dbContext(), command: 'reshipment', target: 'reshipment', claimType: 'exchange', current: current('reshipment') });
    if (name === 'service_record_order_claim_reshipment_v2') return ok(receipt({ command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange', changedFields: [] }));
    return handler(name);
  }
  it('accepts 1000 items, binds the confirmed destination, and never invokes the legacy RPC', async () => {
    mocks.rpc.mockImplementation(reshipHandler); const value = input();
    expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(16_384);
    expect(await recordClaimReshipmentV2(value)).toMatchObject({ receipt: { command: 'reshipment', target: 'reshipment' } });
    const args = mocks.rpc.mock.calls[2][1], snapshot = args.p_sealed_destination;
    expect(args.p_items).toEqual(value.items); expect(args.p_carrier).toBe(value.carrier);
    expect(loadClaimContactCodec().openAddress(snapshot.address, { orderId: value.orderId, claimId: value.claimId, target: 'reshipment', recordKind: 'reshipment_destination', recordId: operationId, piiVersion: snapshot.piiVersion }, snapshot.keyVersion)).toEqual(address);
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_get_order_claim_contact_context', 'service_record_order_claim_reshipment_v2']);
    expect(mocks.revalidate.mock.calls).toEqual(expect.arrayContaining([
      ['/admin/sales/claims/exchanges', undefined], [`/admin/sales/claims/exchanges/${value.claimId}`, undefined],
      [`/orders/${value.orderId}`, undefined], ['/shop', 'layout'], ['/ip', 'layout'], ['/cart', undefined], ['/checkout', undefined], ['/admin/catalog/goods', 'layout'],
    ]));
  });
  it('rejects a change-context token, duplicate items and over-limit items before physical dispatch', async () => {
    const value = input();
    expect(await recordClaimReshipmentV2({ ...value, signedContext: loadClaimContactCodec().signContext(claims()) })).toHaveProperty('code');
    expect(await recordClaimReshipmentV2({ ...value, items: [value.items[0], value.items[0]] })).toMatchObject({ code: 'invalid_claim_contact_request' });
    expect(await recordClaimReshipmentV2({ ...value, items: [...value.items, { orderItemId: id(9999), variantId: id(9998) }] })).toMatchObject({ code: 'invalid_claim_contact_request' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('converges a same-UUID dispatch that completes before current-stage validation without another physical snapshot', async () => {
    const value = input(), committed = receipt({ command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange', changedFields: [] }); let reads = 0;
    mocks.rpc.mockImplementation(name => {
      if (name === 'service_read_order_claim_contact_operation') return ok(++reads === 1 ? { receipt: null, hmacKeyVersion: null } : { receipt: committed, hmacKeyVersion: 'one' });
      if (name === 'service_get_order_claim_contact_context') return ok({ ...dbContext(), command: 'reshipment', target: 'reshipment', claimType: 'exchange', claimRevision: 8, allowed: false, blocker: 'reshipment_started', current: current('reshipment') });
      return reshipHandler(name);
    });
    expect(await recordClaimReshipmentV2(value)).toMatchObject({ receipt: committed });
    expect(mocks.rpc.mock.calls.map(call => call[0])).toEqual(['service_read_order_claim_contact_operation', 'service_get_order_claim_contact_context', 'service_read_order_claim_contact_operation', 'service_record_order_claim_reshipment_v2']);
    expect(mocks.rpc.mock.calls[3][1].p_sealed_destination).toBeNull();
  });
});

describe('cache repair follows authenticated saved receipts', () => {
  it('repairs stock/public and order surfaces from keyless metadata recovery after a lost dispatch response', async () => {
    vi.stubEnv('ICONS_CLAIM_CONTACT_ENABLED', '0'); vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', undefined);
    const saved = receipt({ command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange', changedFields: [] });
    mocks.rpc.mockResolvedValue(ok({ receipt: saved, hmacKeyVersion: 'one' }));
    const request = { ...operation, command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange' };
    expect(await readOrSealClaimContactOperation(request)).toMatchObject({ receipt: saved });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.revalidate.mock.calls).toEqual(expect.arrayContaining([['/shop', 'layout'], ['/ip', 'layout'], ['/cart', undefined], ['/checkout', undefined], ['/admin/catalog/goods', 'layout'], [`/orders/${operation.orderId}`, undefined]]));
  });
  it.each(['noop', 'sealed', 'absent'] as const)('does not invalidate stock/public surfaces for a %s recovery result', async state => {
    mocks.rpc.mockResolvedValue(ok({ receipt: state === 'absent' ? null : receipt({ state, resultClaimRevision: state === 'sealed' ? null : 7, changedFields: [], piiState: 'not_stored' }), hmacKeyVersion: state === 'noop' ? 'one' : null }));
    expect(await readOrSealClaimContactOperation(operation)).toHaveProperty('receipt'); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('does not invalidate anything after current authorization is denied', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'auth_changed' } });
    expect(await readOrSealClaimContactOperation(operation)).toMatchObject({ code: 'auth_changed' }); expect(mocks.revalidate).not.toHaveBeenCalled();
  });
  it('preserves the exact successful receipt even when invalidation throws, and keeps trying remaining paths', async () => {
    const saved = receipt({ command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange', changedFields: [] });
    mocks.rpc.mockResolvedValue(ok({ receipt: saved, hmacKeyVersion: 'one' }));
    mocks.revalidate.mockImplementation(() => { throw new Error('synthetic cache unavailable'); });
    expect(await readOrSealClaimContactOperation({ ...operation, command: 'reshipment', target: 'reshipment', expectedClaimType: 'exchange' })).toEqual({ requestId: operation.requestId, actorId, sessionId, receipt: saved });
    expect(mocks.revalidate).toHaveBeenCalledWith('/admin/catalog/goods', 'layout');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('history privacy and per-target availability', () => {
  const historyRequest = { requestId: id(1), orderId: contextRequest.orderId, claimId: contextRequest.claimId, limit: 20, cursor: null };
  function entry(operator = true): DbHistoryEntry {
    const codec = loadClaimContactCodec(), piiVersion = id(50), common = { orderId: historyRequest.orderId, claimId: historyRequest.claimId, target: 'collection' as const, recordId: operationId, piiVersion };
    return { operationId, target: 'collection', changedFields: ['recipientName'], recordedAt: new Date(now).toISOString(), resultClaimRevision: 8, piiState: 'available', unavailableReason: null, actorId: operator ? actorId : null,
      ciphertext: { recordId: operationId, piiVersion, keyVersion: 'one', before: codec.sealAddress(address, { ...common, recordKind: 'operation_before' }),
        after: codec.sealAddress({ ...address, recipientName: '새 합성 고객' }, { ...common, recordKind: 'operation_after' }), agreement: operator ? codec.sealField('내부 합성 합의', { ...common, recordKind: 'operation_agreement' }, 'agreement') : null } };
  }
  function historyBody(kind: DbContactHistory['viewerKind'] = 'operator'): DbContactHistory {
    return { viewerId: actorId, sessionId, orderId: historyRequest.orderId, claimId: historyRequest.claimId, viewerKind: kind, piiAccess: true,
      current: { collection: current(), reshipment: { target: 'reshipment', piiState: 'not_applicable', unavailableReason: null, source: null, referenceOnly: false, sourceAddress: null, plan: null } },
      entries: [entry(kind === 'operator')], nextCursor: null, reshipmentDestination: { source: 'none', operationId: null, recordedAt: null, piiState: 'not_applicable', unavailableReason: null, destination: null } };
  }
  it.each(['buyer', 'gift_recipient'] as const)('returns %s own address history but no agreement/operator identity', async kind => {
    mocks.rpc.mockResolvedValue(ok(historyBody(kind)));
    const response = await fetchMyClaimContactHistory(historyRequest);
    expect(response).toMatchObject({ viewerKind: kind, current: { collection: { address }, reshipment: { piiState: 'not_applicable', address: null } }, entries: [{ before: address, agreement: null, actorId: null }] });
    expect(mocks.rpc.mock.calls[0][1].p_viewer_kind).toBe('customer');
    expect(JSON.stringify(response)).not.toContain('내부 합성 합의');
  });
  it('returns operator-only agreement after decrypting independent history envelopes', async () => {
    mocks.rpc.mockResolvedValue(ok(historyBody()));
    expect(await fetchAdminClaimContactHistory(historyRequest)).toMatchObject({ entries: [{ agreement: '내부 합성 합의', actorId }] });
  });
  it('gift sender gets minimal change facts only and rejects a DB projection containing recipient PII', async () => {
    const body = historyBody('gift_sender'); body.piiAccess = false;
    body.current.collection = { ...current(), piiState: 'restricted', source: null, sourceAddress: null, referenceOnly: false };
    body.entries = [{ ...entry(false), piiState: 'restricted', ciphertext: null }];
    mocks.rpc.mockResolvedValue(ok(body));
    const response = await fetchMyClaimContactHistory(historyRequest);
    expect(response).toMatchObject({ viewerKind: 'gift_sender', piiAccess: false, current: { collection: { piiState: 'restricted', address: null } }, entries: [{ before: null, after: null, agreement: null }] });
    expect(JSON.stringify(response)).not.toContain(address.recipientName);
    body.current.collection = current(); mocks.rpc.mockResolvedValue(ok(body));
    expect(await fetchMyClaimContactHistory(historyRequest)).toMatchObject({ code: 'claim_contact_outcome_unknown' });
  });
  it('keeps purged and due-before-purge states distinct without rehydrating original PII', async () => {
    const body = historyBody();
    body.current.collection = { ...current(), piiState: 'unavailable', unavailableReason: 'retention_due', source: null, sourceAddress: null, referenceOnly: false };
    body.entries = [{ ...entry(), piiState: 'purged', ciphertext: null }];
    mocks.rpc.mockResolvedValue(ok(body));
    expect(await fetchAdminClaimContactHistory(historyRequest)).toMatchObject({ current: { collection: { piiState: 'unavailable', unavailableReason: 'retention_due', address: null } }, entries: [{ piiState: 'purged', before: null, after: null, agreement: null }] });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('marks a tampered retained history unavailable without leaking partially decrypted fields', async () => {
    const body = historyBody(); body.entries[0].ciphertext!.after.phone.tag = 'A'.repeat(22); mocks.rpc.mockResolvedValue(ok(body));
    expect(await fetchAdminClaimContactHistory(historyRequest)).toMatchObject({ entries: [{ piiState: 'unavailable', unavailableReason: 'crypto_unavailable', before: null, after: null, agreement: null }] });
  });
  it('rejects internal agreement/operator data in any customer result and cross-order result IDs', async () => {
    const body = historyBody('buyer'); body.entries[0] = entry(); mocks.rpc.mockResolvedValue(ok(body));
    expect(await fetchMyClaimContactHistory(historyRequest)).toMatchObject({ code: 'claim_contact_outcome_unknown' });
    const other = { ...historyBody(), orderId: id(99) }; mocks.rpc.mockResolvedValue(ok(other));
    expect(await fetchAdminClaimContactHistory(historyRequest)).toMatchObject({ code: 'claim_contact_outcome_unknown' });
  });
});

it('encrypts full-address history and sends the fee comparison only as transient server input', async () => {
  const input = changeInput(); input.contact = { ...input.contact, postalCode: '54321', address1: '새 합성 기본 주소' };
  mocks.rpc.mockImplementation((name: string) => name === 'service_change_order_claim_contact' ? ok(receipt({ changedFields: ['recipientName', 'postalCode', 'address1'] })) : handler(name));
  const result = await changeClaimContact(input); expect(result).toHaveProperty('receipt.state', 'saved');
  const sealed = mocks.rpc.mock.calls.find(([name]) => name === 'service_change_order_claim_contact')![1].p_sealed_change;
  expect(sealed.destinationCheck).toEqual({ before: { postalCode: address.postalCode, address1: address.address1 }, after: { postalCode: '54321', address1: '새 합성 기본 주소' } });
  expect(JSON.stringify({ plan: sealed.plan, history: sealed.history })).not.toContain('새 합성 기본 주소');
  const codec = loadClaimContactCodec();
  expect(codec.openAddress(sealed.plan.address, { orderId: input.orderId, claimId: input.claimId, target: input.target, recordKind: 'plan', recordId: sealed.plan.planId, piiVersion: sealed.plan.piiVersion }, sealed.plan.keyVersion)).toEqual({ ...address, ...input.contact });
  expect(codec.requestHmac(claims(), input)).not.toBe(codec.requestHmac(claims(), { ...input, contact: { ...input.contact, address1: '다른 합성 기본 주소' } }));
});

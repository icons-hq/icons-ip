import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), getClaims: vi.fn(), rpc: vi.fn(), createService: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser, getClaims: mocks.getClaims } }) }));
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: mocks.createService }));
vi.mock('./crypto.server', () => { throw new Error('Retention must not load contact crypto'); });
import { maintainClaimContactRetention, type ClaimContactRetentionRequest } from './retention.server';
import { claimContactError, type ContactDataInventory, type ContactPurgeReceipt, type RetentionCaseReceipt } from './contracts';
import { CLAIM_CONTACT_FIXTURE_IDS as ids, claimContactContractFixtures } from './test-fixtures';

const at = '2026-10-14T00:00:00.000Z', now = Date.parse(at), other = '20000000-0000-4000-8000-000000000001';
const inventory: ClaimContactRetentionRequest = { requestId: ids.request, operation: 'inventory', subjectId: ids.actor, limit: 1, afterClaimId: null };
const caseRequest: ClaimContactRetentionRequest = { requestId: ids.request, operation: 'case', orderId: ids.order, claimId: ids.claim,
  operationId: ids.operation, expectedCaseRevision: 0, case: claimContactContractFixtures().RetentionCaseCommand };
const purge: ClaimContactRetentionRequest = { requestId: ids.request, operation: 'purge', subjectId: ids.actor, operationId: ids.operation, cutoff: at, limit: 1, confirmed: true };
const requests = [inventory, caseRequest, purge] as const;
const names = ['service_inventory_order_claim_contact_data', 'service_record_order_claim_contact_retention_case', 'service_purge_order_claim_contact_data'] as const;
const ok = (data: unknown) => ({ data, error: null });
function resultFor(operation: string) {
  const fixtures = claimContactContractFixtures();
  if (operation === 'inventory') return fixtures.ContactDataInventory;
  if (operation === 'case') return fixtures.RetentionCaseReceipt;
  return fixtures.ContactPurgeReceipt;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('ICONS_CLAIM_CONTACT_ENABLED', '0'); vi.stubEnv('ICONS_CLAIM_CONTACT_KEYRING_JSON', '');
  Object.values(mocks).forEach(mock => mock.mockReset());
  mocks.getUser.mockResolvedValue({ data: { user: { id: ids.actor } }, error: null });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: ids.session } }, error: null });
  mocks.createService.mockReturnValue({ rpc: mocks.rpc });
  mocks.rpc.mockImplementation(name => ok(resultFor(requests[names.indexOf(name)].operation)));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('manual claim contact retention authentication and dispatch', () => {
  it.each(requests)('runs $operation without feature enablement or encryption keys', async input => {
    expect(await maintainClaimContactRetention(input)).toEqual({ requestId: ids.request, operation: input.operation, data: resultFor(input.operation) });
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getClaims.mock.invocationCallOrder[0]);
    expect(mocks.getClaims.mock.invocationCallOrder[0]).toBeLessThan(mocks.createService.mock.invocationCallOrder[0]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_actor_id: ids.actor, p_session_id: ids.session });
  });
  it('maps the three commands to exact service-only RPC arguments', async () => {
    for (const input of requests) await maintainClaimContactRetention(input);
    expect(mocks.rpc.mock.calls).toEqual([
      [names[0], { p_subject_id: ids.actor, p_limit: 1, p_after_claim_id: null, p_actor_id: ids.actor, p_session_id: ids.session }],
      [names[1], { p_order_id: ids.order, p_claim_id: ids.claim, p_operation_id: ids.operation, p_expected_case_revision: 0,
        p_case: caseRequest.case, p_actor_id: ids.actor, p_session_id: ids.session }],
      [names[2], { p_subject_id: ids.actor, p_operation_id: ids.operation, p_cutoff: at, p_limit: 1, p_actor_id: ids.actor, p_session_id: ids.session }],
    ]);
  });
  it.each(['user_error', 'no_user', 'invalid_actor', 'claims_error', 'no_claims', 'other_sub', 'no_session', 'invalid_session'])('stops %s before creating a privileged client', async variant => {
    if (variant === 'user_error') mocks.getUser.mockResolvedValue({ data: { user: { id: ids.actor } }, error: { message: 'secret' } });
    if (variant === 'no_user') mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    if (variant === 'invalid_actor') mocks.getUser.mockResolvedValue({ data: { user: { id: 'secret' } }, error: null });
    if (variant === 'claims_error') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: ids.session } }, error: { message: 'secret' } });
    if (variant === 'no_claims') mocks.getClaims.mockResolvedValue({ data: null, error: null });
    if (variant === 'other_sub') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: other, session_id: ids.session } }, error: null });
    if (variant === 'no_session') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ids.actor } }, error: null });
    if (variant === 'invalid_session') mocks.getClaims.mockResolvedValue({ data: { claims: { sub: ids.actor, session_id: 'secret' } }, error: null });
    expect(await maintainClaimContactRetention(purge)).toEqual(claimContactError('auth_changed', ids.request));
    expect(mocks.createService).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(requests)('uses the database live capability/session denial for $operation', async input => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'auth_changed', details: 'synthetic private address' } });
    expect(await maintainClaimContactRetention(input)).toEqual(claimContactError('auth_changed', ids.request));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it.each(requests)('does not automatically retry an uncertain $operation result', async input => {
    mocks.rpc.mockRejectedValue(new Error('synthetic key or contact')); const response = await maintainClaimContactRetention(input);
    expect(response).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request)); expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('returns a fixed error for unknown SQL diagnostics, never message/detail/hint', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'XX000', message: 'synthetic secret', details: 'synthetic address', hint: 'synthetic key' } });
    expect(await maintainClaimContactRetention(purge)).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
  });
});

describe('strict manual retention requests', () => {
  it.each(requests)('rejects any caller actor/session or extra field for $operation', async input => {
    for (const extra of [{ actorId: ids.actor }, { sessionId: ids.session }, { address: 'synthetic address' }]) {
      expect(await maintainClaimContactRetention({ ...input, ...extra })).toEqual(claimContactError('invalid_claim_contact_request', ids.request));
    }
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it.each([
    null, [], {}, { ...inventory, operation: 'export' }, { ...inventory, subjectId: 'invalid' }, { ...inventory, afterClaimId: '' },
    { ...inventory, afterClaimId: undefined }, { ...inventory, limit: 0 }, { ...inventory, limit: 1001 }, { ...inventory, limit: 1.1 },
    { ...caseRequest, expectedCaseRevision: -1 }, { ...caseRequest, expectedCaseRevision: Number.MAX_SAFE_INTEGER },
    { ...caseRequest, case: { ...caseRequest.case, approvalRef: 'a name / 010-1111-2222' } },
    { ...caseRequest, case: { ...caseRequest.case, address: 'synthetic address' } },
    { ...caseRequest, case: { ...caseRequest.case, occurredAt: '2026-10-14T00:00:00.000001Z' } },
    { ...caseRequest, case: { ...caseRequest.case, retainUntil: null } },
    { ...purge, confirmed: false }, { ...purge, confirmed: 'true' }, { ...purge, limit: 101 },
    { ...purge, cutoff: 'infinity' }, { ...purge, cutoff: '2026-02-30T00:00:00Z' },
    { ...purge, cutoff: '2026-10-14T00:00:00.000001Z' }, { ...purge, cutoff: '2026-10-14T00:00:00.0000001Z' },
  ])('rejects malformed input %# before any auth or privileged access', async input => {
    expect(await maintainClaimContactRetention(input)).toHaveProperty('code', 'invalid_claim_contact_request');
    expect(mocks.getUser).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('accepts a replay after an original hold deadline has passed', async () => {
    vi.setSystemTime(Date.parse('2026-12-01T00:00:00Z'));
    expect(await maintainClaimContactRetention(caseRequest)).toHaveProperty('data', resultFor('case'));
  });
  it.each(['extend', 'release', 'close'] as const)('accepts the bound %s case action', async action => {
    const command = { ...caseRequest.case, action, retainUntil: action === 'extend' ? caseRequest.case.retainUntil : null };
    const data = { ...resultFor('case'), action, retainUntil: command.retainUntil,
      state: action === 'extend' ? 'held' : action === 'release' ? 'released' : 'closed',
      caseClosedAt: action === 'close' ? at : null, releasedAt: action === 'release' ? at : null };
    mocks.rpc.mockResolvedValueOnce(ok(data));
    expect(await maintainClaimContactRetention({ ...caseRequest, case: command })).toEqual({ requestId: ids.request, operation: 'case', data });
  });
  it('permits the documented maximum inventory and purge limits', async () => {
    mocks.rpc.mockResolvedValueOnce(ok({ ...resultFor('inventory'), nextClaimId: null }));
    expect(await maintainClaimContactRetention({ ...inventory, limit: 1000 })).toHaveProperty('operation', 'inventory');
    mocks.rpc.mockResolvedValueOnce(ok({ ...resultFor('purge'), limit: 100 }));
    expect(await maintainClaimContactRetention({ ...purge, limit: 100 })).toHaveProperty('operation', 'purge');
  });
});

describe('strict metadata-only retention results', () => {
  it.each(requests)('rejects wrong current identity or hidden payload keys for $operation', async input => {
    for (const extra of [{ actorId: other }, { sessionId: other }, { ciphertext: 'secret ciphertext' }, { phone: '01011112222' }]) {
      mocks.rpc.mockResolvedValue(ok({ ...resultFor(input.operation), ...extra }));
      expect(await maintainClaimContactRetention(input)).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
    }
  });
  it.each([
    { subjectId: other }, { scopes: [] }, { nextClaimId: other },
    { scopes: [claimContactContractFixtures().RetentionScope, claimContactContractFixtures().RetentionScope] },
    { scopes: [{ ...claimContactContractFixtures().RetentionScope, remaining: { ...claimContactContractFixtures().ContactDataCounts, address: 'secret' } }] },
    { scopes: [{ ...claimContactContractFixtures().RetentionScope, activeHoldCount: -1 }] },
  ])('rejects wrong inventory subject, pagination or nested metadata %#', async tamper => {
    mocks.rpc.mockResolvedValue(ok({ ...resultFor('inventory'), ...tamper }));
    expect(await maintainClaimContactRetention(inventory)).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
  });
  it('rejects inventory rows before the requested cursor and out of order', async () => {
    mocks.rpc.mockResolvedValue(ok(resultFor('inventory')));
    expect(await maintainClaimContactRetention({ ...inventory, afterClaimId: ids.claim })).toHaveProperty('code', 'claim_contact_outcome_unknown');
    const data = resultFor('inventory') as ContactDataInventory;
    mocks.rpc.mockResolvedValue(ok({ ...data, scopes: [{ ...data.scopes[0], claimId: other }, data.scopes[0]], nextClaimId: null }));
    expect(await maintainClaimContactRetention({ ...inventory, limit: 2 })).toHaveProperty('code', 'claim_contact_outcome_unknown');
  });
  it.each([
    { operationId: other }, { orderId: other }, { claimId: other }, { caseRef: 'another/case' }, { legalBasis: 'statutory_preservation' },
    { expectedRevision: 1, resultRevision: 2 }, { resultRevision: 2 }, { occurredAt: '2026-10-13T23:59:59.999999Z' },
    { retainUntil: '2026-11-01T00:00:00.000001Z' },
  ])('rejects wrong case receipt binding %#', async tamper => {
    mocks.rpc.mockResolvedValue(ok({ ...resultFor('case'), ...tamper }));
    expect(await maintainClaimContactRetention(caseRequest)).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
  });
  it('validates action and its state while accepting an identical database timestamp in another offset', async () => {
    const data = resultFor('case') as RetentionCaseReceipt;
    mocks.rpc.mockResolvedValueOnce(ok({ ...data, action: 'extend' }));
    expect(await maintainClaimContactRetention(caseRequest)).toHaveProperty('code', 'claim_contact_outcome_unknown');
    mocks.rpc.mockResolvedValueOnce(ok({ ...data, occurredAt: '2026-10-14T09:00:00+09:00', retainUntil: '2026-11-01T09:00:00+09:00' }));
    expect(await maintainClaimContactRetention(caseRequest)).toHaveProperty('operation', 'case');
  });
  it.each(['release', 'close'] as const)('rejects a microsecond mismatch in the %s event time', async action => {
    const command = { ...caseRequest.case, action, retainUntil: null };
    const data = { ...resultFor('case'), action, state: action === 'release' ? 'released' : 'closed', retainUntil: null,
      releasedAt: action === 'release' ? '2026-10-14T00:00:00.000001Z' : null,
      caseClosedAt: action === 'close' ? '2026-10-14T00:00:00.000001Z' : null };
    mocks.rpc.mockResolvedValueOnce(ok(data));
    expect(await maintainClaimContactRetention({ ...caseRequest, case: command })).toHaveProperty('code', 'claim_contact_outcome_unknown');
  });
  it.each([
    { operationId: other }, { subjectId: other }, { limit: 2 }, { cutoff: '2026-10-13T23:59:59.999999Z' },
    { selectedResidualPiiFields: 1 }, { purgedTargetCount: 0 }, { purgedTargetCount: 3 },
    { removed: { ...claimContactContractFixtures().ContactPurgeReceipt.removed, operatorReferences: 1 } },
    { remaining: { ...claimContactContractFixtures().PurgeRemainingCounts, sealedPlan: 'secret' } },
    { purgedClaimIds: [ids.claim, ids.claim] },
  ])('rejects wrong purge binding or invalid residual metadata %#', async tamper => {
    mocks.rpc.mockResolvedValue(ok({ ...resultFor('purge'), ...tamper }));
    expect(await maintainClaimContactRetention(purge)).toEqual(claimContactError('claim_contact_outcome_unknown', ids.request));
  });
  it('accepts exact microsecond precision after the database normalizes its timezone', async () => {
    const cutoff = '2026-10-13T23:59:59.999999Z', data = resultFor('purge') as ContactPurgeReceipt;
    mocks.rpc.mockResolvedValueOnce(ok({ ...data, cutoff: '2026-10-14T08:59:59.999999+09:00' }));
    expect(await maintainClaimContactRetention({ ...purge, cutoff })).toHaveProperty('operation', 'purge');
  });
});

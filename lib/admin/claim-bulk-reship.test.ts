import { describe, expect, it, vi } from 'vitest';
import type { AdminClaimBulkReshipClaim } from './claim-bulk';
import {
  CLAIM_BULK_RESHIP_ADDRESS_CHANGED,
  CLAIM_BULK_RESHIP_AUTH_CHANGED,
  CLAIM_BULK_RESHIP_EXPIRED,
  CLAIM_BULK_RESHIP_OUTCOME_UNKNOWN,
  CLAIM_BULK_RESHIP_PENDING_OPERATION,
  CLAIM_BULK_RESHIP_PREVIOUS_FAILED,
  registerClaimReshipments,
  reshipRowKey,
  sameClaimContactAddress,
  type ClaimBulkReshipDeps,
} from './claim-bulk-reship';
import { claimContactError, type ContextResponse, type OperationReceipt, type OperationRequest, type ReshipmentRequest } from '@/lib/claim-contact/contracts';

/*
 * 재출고 일괄(SHEET-052)의 한 요청 처리. T11a 판정을 그대로 따르는지 고정한다: 회수 생략은 요청에 싣지 않고(결정한 배송
 * 건은 DB가 결정대로 처리), DB가 거절한 확정 오류(production_incomplete·collection_waiver_conflict)는 같은 작업을 종료한 뒤
 * 그 문구 그대로 보이고 남은 배송 건은 보내지 않는다. 다음 배송 건은 최종 주소를 다시 받아 같을 때만 보낸다.
 */
const ADDRESS = { recipientName: '합성 고객', phone: '01000000000', postalCode: '12345', address1: '합성시 입고일로 1', address2: '101호' };
const ACTOR = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ORDER = '33333333-3333-4333-8333-333333333333';
const CLAIM = '44444444-4444-4444-8444-444444444444';
const SHIP = (n: number) => `5a1e0000-0000-4000-8000-00000000000${n}`;
const ITEM = (n: number) => `6b2f0000-0000-4000-8000-00000000000${n}`;
const VARIANT = (n: number) => `7c300000-0000-4000-8000-00000000000${n}`;
const NOW = Date.parse('2026-11-12T03:00:00.000Z');

function claim(rows = 2): AdminClaimBulkReshipClaim {
  return {
    claimId: CLAIM, orderId: ORDER, reference: 'C00012', skipped: [],
    rows: Array.from({ length: rows }, (_, index) => ({
      shipmentId: SHIP(index + 1), originName: index === 0 ? 'TEST 김포' : 'TEST 남양주', waived: index === 1,
      items: [{ orderItemId: ITEM(index + 1), name: `굿즈 ${index + 1}`, variantName: null, qty: 1, currentVariantId: VARIANT(index + 1), options: [] }],
    })),
  };
}
const context = { address: ADDRESS, signedContext: 'cc1.AQ.AQ', expiresAt: new Date(NOW + 600_000).toISOString(), claimRevision: 3, claimType: 'exchange' as const };
const drafts = {
  [reshipRowKey(CLAIM, SHIP(1))]: { carrier: 'hanjin', trackingNumber: ' gimpo0001 ', items: { [ITEM(1)]: VARIANT(1) } },
  [reshipRowKey(CLAIM, SHIP(2))]: { carrier: 'hanjin', trackingNumber: 'NAMYANG001', items: { [ITEM(2)]: VARIANT(2) } },
};

function receipt(request: { operationId: string }, revision: number, state: OperationReceipt['state'] = 'saved'): OperationReceipt {
  return { operationId: request.operationId, command: 'reshipment', orderId: ORDER, claimId: CLAIM, target: 'reshipment', actorId: ACTOR, sessionId: SESSION,
    expectedClaimType: 'exchange', expectedClaimRevision: revision, resultClaimRevision: state === 'saved' ? revision + 1 : null, state, changedFields: [],
    recordedAt: '2026-11-12T03:00:00.000Z', piiState: 'retained' };
}
function freshContext(revision: number, address = ADDRESS): ContextResponse {
  return { requestId: '88888888-8888-4888-8888-888888888888', actorId: ACTOR, sessionId: SESSION, orderId: ORDER, claimId: CLAIM, target: 'reshipment', command: 'reshipment',
    claimType: 'exchange', claimRevision: revision, allowed: true, blocker: null, sourceKind: 'order_delivery', referenceOnly: true, piiState: 'available',
    address, signedContext: 'cc1.AQ.AQ', expiresAt: new Date(NOW + 600_000).toISOString(), unavailableReason: null };
}

function harness(overrides: Partial<ClaimBulkReshipDeps> = {}) {
  const store = new Map<string, string>();
  let id = 0;
  const sent: ReshipmentRequest[] = [];
  const sealed: OperationRequest[] = [];
  const deps: ClaimBulkReshipDeps = {
    fetchContext: vi.fn(async () => freshContext(4)),
    record: vi.fn(async (request: ReshipmentRequest) => {
      sent.push(request);
      return { requestId: request.requestId, actorId: ACTOR, sessionId: SESSION, receipt: receipt(request, sent.length === 1 ? 3 : 4) };
    }),
    readOrSeal: vi.fn(async (request: OperationRequest) => {
      sealed.push(request);
      return { requestId: request.requestId, actorId: ACTOR, sessionId: SESSION, receipt: receipt(request, request.expectedClaimRevision, 'sealed') };
    }),
    canApply: () => true,
    now: () => NOW,
    newId: () => `9d400000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    journalKey: () => 'journal',
    storage: { get: (key) => store.get(key) ?? null, set: (key, value) => { store.set(key, value); }, remove: (key) => { store.delete(key); } },
    ...overrides,
  };
  const results: [string, 'done' | 'failed', string][] = [];
  const report = {
    fail: (row: { originName: string | null }, message: string) => { results.push([row.originName ?? '', 'failed', message]); },
    succeed: (row: { originName: string | null }, message: string) => { results.push([row.originName ?? '', 'done', message]); },
  };
  return { deps, report, results, sent, sealed, store };
}

describe('재출고 일괄 — 최종 주소 재확인', () => {
  it('앞뒤 공백만 다른 우편번호·기본 주소는 같은 주소다', () => {
    expect(sameClaimContactAddress(ADDRESS, { ...ADDRESS, postalCode: ' 12345 ', address1: '합성시 입고일로 1 ' })).toBe(true);
  });

  it.each([
    ['recipientName', '다른 고객'], ['phone', '01099999999'], ['postalCode', '54321'], ['address1', '합성시 다른로 2'], ['address2', '202호'],
  ] as const)('%s가 바뀌면 보내지 않는다', (field, value) => {
    expect(sameClaimContactAddress(ADDRESS, { ...ADDRESS, [field]: value })).toBe(false);
  });

  it('행 키는 요청과 배송 건(없으면 주문 전체)으로 만든다', () => {
    expect(reshipRowKey('claim', 'shipment')).toBe('claim:shipment');
    expect(reshipRowKey('claim', null)).toBe('claim:order');
  });
});

describe('registerClaimReshipments', () => {
  it('배송 건마다 순서대로 보내고, 다음 배송 건은 다시 받은 주소 확인(새 버전)으로 보낸다. 회수 생략은 요청에 싣지 않는다', async () => {
    const h = harness();
    expect(await registerClaimReshipments({ claim: claim(), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report)).toBe('ok');
    expect(h.results).toEqual([['TEST 김포', 'done', '재출고를 등록했습니다(GIMPO0001).'], ['TEST 남양주', 'done', '재출고를 등록했습니다(NAMYANG001).']]);
    expect(h.sent.map((request) => [request.shipmentId, request.collectionWaiver, request.trackingNumber])).toEqual([[SHIP(1), null, 'GIMPO0001'], [SHIP(2), null, 'NAMYANG001']]);
    expect(h.deps.fetchContext).toHaveBeenCalledTimes(1);
    expect(h.store.size).toBe(0);
  });

  it.each([
    ['production_incomplete', '주문제작 상품의 교환품 제작이 끝난 뒤 재출고할 수 있습니다.'],
    ['collection_waiver_conflict', '이 배송 건은 이미 다른 사유·사진으로 회수 생략을 기록했습니다.'],
  ])('DB의 확정 오류(%s)는 같은 작업을 종료한 뒤 그 문구로 실패하고, 그 요청의 남은 배송 건은 보내지 않는다', async (code, message) => {
    const h = harness({ record: vi.fn(async (request: ReshipmentRequest) => claimContactError(code, request.requestId)) });
    expect(await registerClaimReshipments({ claim: claim(), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report)).toBe('stopped');
    expect(h.results[0]).toEqual(['TEST 김포', 'failed', expect.stringContaining(message)]);
    expect(h.results[1]).toEqual(['TEST 남양주', 'failed', CLAIM_BULK_RESHIP_PREVIOUS_FAILED]);
    expect(h.sealed).toEqual([expect.objectContaining({ sealIfAbsent: true, command: 'reshipment', target: 'reshipment', expectedClaimRevision: 3 })]);
    expect(h.deps.record).toHaveBeenCalledTimes(1);
    expect(h.store.size).toBe(0);
  });

  it('응답을 잃어도 같은 작업이 저장돼 있으면 등록으로 본다', async () => {
    const h = harness({
      record: vi.fn(async () => null),
      readOrSeal: vi.fn(async (request: OperationRequest) => ({ requestId: request.requestId, actorId: ACTOR, sessionId: SESSION, receipt: receipt(request, request.expectedClaimRevision) })),
    });
    await registerClaimReshipments({ claim: claim(1), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report);
    expect(h.results).toEqual([['TEST 김포', 'done', '재출고를 등록했습니다(GIMPO0001).']]);
    expect(h.store.size).toBe(0);
  });

  it('결과를 끝내 읽지 못하면 요청번호를 남겨 상세에서 확인하게 하고 남은 배송 건은 멈춘다', async () => {
    const h = harness({ record: vi.fn(async () => null), readOrSeal: vi.fn(async () => null) });
    expect(await registerClaimReshipments({ claim: claim(), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report)).toBe('stopped');
    expect(h.results.map(([, outcome, message]) => [outcome, message])).toEqual([['failed', CLAIM_BULK_RESHIP_OUTCOME_UNKNOWN], ['failed', CLAIM_BULK_RESHIP_PREVIOUS_FAILED]]);
    expect(JSON.parse(h.store.get('journal') ?? '{}')).toMatchObject({ command: 'reshipment', claimId: CLAIM, expectedClaimRevision: 3 });
  });

  it('다음 배송 건의 최종 주소가 처음과 다르면 보내지 않는다', async () => {
    const h = harness({ fetchContext: vi.fn(async () => freshContext(4, { ...ADDRESS, address2: '202호' })) });
    await registerClaimReshipments({ claim: claim(), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report);
    expect(h.results).toEqual([['TEST 김포', 'done', expect.any(String)], ['TEST 남양주', 'failed', CLAIM_BULK_RESHIP_ADDRESS_CHANGED]]);
    expect(h.deps.record).toHaveBeenCalledTimes(1);
  });

  it('주소 확인 10분이 지났거나 결과를 확인하지 않은 작업이 남은 요청은 보내지 않는다', async () => {
    const expired = harness({ now: () => NOW + 600_001 });
    await registerClaimReshipments({ claim: claim(1), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, expired.deps, expired.report);
    expect(expired.results).toEqual([['TEST 김포', 'failed', CLAIM_BULK_RESHIP_EXPIRED]]);
    const pending = harness();
    pending.store.set('journal', '{"operationId":"x"}');
    await registerClaimReshipments({ claim: claim(1), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, pending.deps, pending.report);
    expect(pending.results).toEqual([['TEST 김포', 'failed', CLAIM_BULK_RESHIP_PENDING_OPERATION]]);
    expect(expired.deps.record).not.toHaveBeenCalled();
    expect(pending.deps.record).not.toHaveBeenCalled();
  });

  it('로그인 세션이 바뀌면 남은 배송 건을 멈추고 호출자에게 알린다', async () => {
    let calls = 0;
    const h = harness({ canApply: () => ++calls < 2 });
    expect(await registerClaimReshipments({ claim: claim(), context, drafts, identity: { actorId: ACTOR, sessionId: SESSION } }, h.deps, h.report)).toBe('auth_lost');
    expect(h.results).toEqual([['TEST 김포', 'done', expect.any(String)], ['TEST 남양주', 'failed', CLAIM_BULK_RESHIP_AUTH_CHANGED]]);
  });
});

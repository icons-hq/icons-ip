import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkDecideOrderClaimsAction } from './claim-actions';
import {
  loadOrderClaimBulkReshipmentsAction,
  previewOrderClaimBulkStepAction,
  runOrderClaimBulkCollectionsAction,
  runOrderClaimBulkRefundsAction,
} from './claim-bulk-step-actions';

/*
 * 클레임 일괄 처리(R8 · D8). 새 배열 RPC 없이 선택한 건마다 단건 경로를 순서대로 태운다.
 * 토스는 결제 단건 취소뿐이라 앞 건이 끝나기 전에 다음 건(결제사 취소)을 시작하지 않는다.
 */

const ID = (n: number) => `abcdef${String(n).padStart(2, '0')}-1234-4123-8123-123456789abc`;
const ORDER = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  select: vi.fn(),
  inFilter: vi.fn(),
  eqFilter: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
  carriers: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: mocks.redirect, unstable_rethrow: vi.fn() }));
vi.mock('@/lib/auth/admin', () => ({ getCurrentAdminAuthState: mocks.getCurrentAdminAuthState }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/admin/claims.server', () => ({ loadAdminClaimDetail: mocks.loadAdminClaimDetail }));
vi.mock('@/lib/orders/cancellation-orchestrator.server', () => ({
  reconcileOrderCancellation: mocks.reconcileOrderCancellation,
}));
vi.mock('@/lib/payments/goods-manual-recovery.server', () => ({
  recoverGoodsPaymentManually: mocks.recoverGoodsPaymentManually,
}));
vi.mock('@/lib/orders/shipment.server', () => ({ getShippingCarrierRegistry: mocks.carriers }));

function bulkForm(ids: string[], decision: string, claimType = 'cancel', note?: string) {
  const form = new FormData();
  form.set('claimType', claimType);
  form.set('decision', decision);
  for (const id of ids) form.append('claimIds', id);
  if (note !== undefined) form.set('note', note);
  return form;
}

/* 처음 한 번 읽는 행(요청번호·유형)과, 건을 시작하기 직전에 다시 읽는 유형(current)을 따로 둔다. */
const current = new Map<string, string>();
function claimRows(rows: { id: string; reference: number; claim_type?: string; order_id?: string }[]) {
  const data = rows.map((row, index) => ({ claim_type: 'cancel', order_id: ORDER(index), ...row }));
  mocks.inFilter.mockResolvedValue({ data, error: null });
  current.clear();
  for (const row of data) current.set(row.id, row.claim_type);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getCurrentAdminAuthState.mockResolvedValue({
    operatorAccess: legacyOperatorAccessFixture(),
    isConfigured: true,
    user: { id: 'staff-1' },
    role: 'staff',
    isStaff: true,
  });
  mocks.select.mockReturnValue({ in: mocks.inFilter, eq: mocks.eqFilter });
  mocks.eqFilter.mockImplementation((_column: string, id: string) => {
    mocks.maybeSingle.mockImplementationOnce(async () => ({
      data: current.has(id) ? { claim_type: current.get(id) } : null,
      error: null,
    }));
    return { maybeSingle: mocks.maybeSingle };
  });
  mocks.from.mockReturnValue({ select: mocks.select });
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: mocks.from });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('bulkDecideOrderClaimsAction', () => {
  it('선택한 순서대로 단건 결정 RPC를 한 건씩 부르고 건별 결과표를 돌려준다', async () => {
    claimRows([{ id: ID(1), reference: 12 }, { id: ID(2), reference: 13 }]);
    mocks.rpc.mockResolvedValue({ data: 'in_review', error: null });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'review'));

    expect(mocks.from).toHaveBeenCalledWith('order_cancellation_requests');
    expect(mocks.select).toHaveBeenCalledWith('id,reference');
    expect(mocks.select).toHaveBeenCalledWith('claim_type');
    expect(mocks.inFilter).toHaveBeenCalledWith('id', [ID(1), ID(2)]);
    expect(mocks.rpc.mock.calls).toEqual([
      ['admin_decide_order_claim', { p_claim_id: ID(1), p_decision: 'review', p_note: null }],
      ['admin_decide_order_claim', { p_claim_id: ID(2), p_decision: 'review', p_note: null }],
    ]);
    expect(state.results).toEqual([
      { claimId: ID(1), reference: 'C00012', outcome: 'done', message: '검토중으로 표시했습니다.' },
      { claimId: ID(2), reference: 'C00013', outcome: 'done', message: '검토중으로 표시했습니다.' },
    ]);
    expect(state.summary).toBe('처리됨 2건 · 실패 0건');
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/cancels');
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/admin/sales/claims/cancels/${ID(2)}`);
  });

  it('토스 취소 승인은 건마다 결제사 취소까지 끝낸 뒤 다음 건을 시작한다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }]);
    const events: string[] = [];
    mocks.rpc.mockImplementation(async (_name: string, args: { p_claim_id: string }) => {
      events.push(`decide:${args.p_claim_id.slice(0, 8)}`);
      return { data: 'processing', error: null };
    });
    mocks.loadAdminClaimDetail.mockResolvedValue({ payment: { provider: 'toss' } });
    mocks.reconcileOrderCancellation.mockImplementation(async ({ requestId }: { requestId: string }) => {
      events.push(`cancel:start:${requestId.slice(0, 8)}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`cancel:end:${requestId.slice(0, 8)}`);
      return { ok: true, status: 'completed' };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve'));

    expect(events).toEqual([
      'decide:abcdef01', 'cancel:start:abcdef01', 'cancel:end:abcdef01',
      'decide:abcdef02', 'cancel:start:abcdef02', 'cancel:end:abcdef02',
    ]);
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: ID(1), actorId: 'staff-1' });
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'done']);
    expect(state.results?.[0].message).toContain('토스 전액 취소까지 확인했습니다');
  });

  it('일부가 실패해도 나머지를 처리하고, 실패는 운영자 문구로 사유를 남긴다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }, { id: ID(3), reference: 3 }]);
    mocks.rpc
      .mockResolvedValueOnce({ data: 'processing', error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'claim_not_decidable' } })
      .mockResolvedValueOnce({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue({ payment: { provider: 'toss' } });
    mocks.reconcileOrderCancellation
      .mockResolvedValueOnce({ ok: false, code: 'provider_cancel_failed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2), ID(3)], 'approve'));

    expect(mocks.rpc).toHaveBeenCalledTimes(3);
    expect(state.results?.map((result) => [result.reference, result.outcome])).toEqual([
      ['C00001', 'failed'], ['C00002', 'failed'], ['C00003', 'done'],
    ]);
    expect(state.results?.[0].message).toContain('provider_cancel_failed');
    expect(state.results?.[1].message).toBe('지금 단계에서는 처리할 수 없습니다. 최신 상태를 확인해주세요.');
    expect(state.summary).toBe('처리됨 1건 · 실패 2건');
  });

  it('시간 예산을 넘기면 남은 건은 시작하지 않고 미처리로 돌려준다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }, { id: ID(3), reference: 3 }]);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.rpc.mockImplementation(async () => {
      now += 30_000;
      return { data: 'in_review', error: null };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2), ID(3)], 'review'));

    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'done', 'skipped']);
    expect(state.summary).toBe('처리됨 2건 · 실패 0건 · 처리 시간이 길어 1건은 처리하지 않았습니다. 다시 실행하세요.');
    expect(mocks.revalidatePath).not.toHaveBeenCalledWith(`/admin/sales/claims/cancels/${ID(3)}`);
  });

  it('취소 승인은 액션 진입부터 잰 시간에 결제사 최악 시간을 더해 마감 안일 때만 다음 건을 시작한다', async () => {
    claimRows([{ id: ID(1), reference: 1 }, { id: ID(2), reference: 2 }]);
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const auth = mocks.getCurrentAdminAuthState.getMockImplementation();
    mocks.getCurrentAdminAuthState.mockImplementation(async () => {
      now += 20_000; /* 인증·세션 갱신이 느린 경우 */
      return auth?.();
    });
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue({ payment: { provider: 'toss' } });
    mocks.reconcileOrderCancellation.mockImplementation(async () => {
      now += 10_000;
      return { ok: true, status: 'completed' };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve'));

    /* 둘째 건 시작 시점 경과 30초 + 결제사 최악 30초 > 마감 55초 → 시작하지 않는다. */
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'skipped']);
    expect(now - 1_000_000).toBeLessThanOrEqual(60_000);
  });

  it('DB 결정만 하는 일괄 처리(반품 승인)는 짧은 최악 시간으로 45초 예산까지 시작한다', async () => {
    claimRows([1, 2, 3, 4, 5].map((n) => ({ id: ID(n), reference: n, claim_type: 'return' })));
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    mocks.rpc.mockImplementation(async () => {
      now += 12_000;
      return { data: 'collecting', error: null };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([1, 2, 3, 4, 5].map(ID), 'approve', 'return'));

    expect(mocks.rpc).toHaveBeenCalledTimes(4);
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'done', 'done', 'done', 'skipped']);
  });

  it('건을 시작하기 직전에 유형을 다시 읽어, 그 사이 다른 유형으로 바뀐 요청은 처리하지 않는다', async () => {
    claimRows([{ id: ID(1), reference: 1, claim_type: 'return' }, { id: ID(2), reference: 2, claim_type: 'return' }]);
    mocks.rpc.mockImplementation(async () => {
      current.set(ID(2), 'exchange'); /* 첫 건을 처리하는 동안 다른 운영자가 둘째 건을 교환으로 전환 */
      return { data: 'collecting', error: null };
    });

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve', 'return'));

    expect(mocks.eqFilter).toHaveBeenCalledWith('id', ID(2));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(state.results?.[1]).toEqual({
      claimId: ID(2), reference: 'C00002', outcome: 'failed', message: '반품 요청이 아닙니다. 해당 목록에서 처리해주세요.',
    });
  });

  it('목록 유형과 다른 요청·사라진 요청은 처리하지 않는다', async () => {
    claimRows([{ id: ID(1), reference: 7, claim_type: 'return' }]);
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'approve'));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(state.results).toEqual([
      { claimId: ID(1), reference: 'C00007', outcome: 'failed', message: '취소 요청이 아닙니다. 해당 목록에서 처리해주세요.' },
      { claimId: ID(2), reference: null, outcome: 'failed', message: '클레임을 찾을 수 없습니다.' },
    ]);
  });

  it('거부는 공통 사유를 모든 건에 같이 보낸다', async () => {
    claimRows([{ id: ID(1), reference: 1, claim_type: 'return' }, { id: ID(2), reference: 2, claim_type: 'return' }]);
    mocks.rpc.mockResolvedValue({ data: 'rejected', error: null });
    const note = '회수한 상품에 사용 흔적이 있어 반품할 수 없습니다.';

    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1), ID(2)], 'reject', 'return', ` ${note} `));

    expect(mocks.rpc.mock.calls.map(([, args]) => args)).toEqual([
      { p_claim_id: ID(1), p_decision: 'reject', p_note: note },
      { p_claim_id: ID(2), p_decision: 'reject', p_note: note },
    ]);
    expect(state.results?.every((result) => result.outcome === 'done')).toBe(true);
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/admin/sales/claims/returns');
  });

  it('DB가 거부 사유를 거절하면 운영자 문구로 옮긴다', async () => {
    claimRows([{ id: ID(1), reference: 1 }]);
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'invalid rejection reason' } });
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'reject', 'cancel', '이미 발송되어 취소할 수 없습니다.'));
    expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: '거부 사유는 앞뒤 공백 없이 10자 이상 200자 이하로 입력해주세요.' });
  });

  it('50건을 넘기거나 권한이 없으면 아무 건도 처리하지 않는다', async () => {
    const ids = Array.from({ length: 51 }, (_, index) => ID(index));
    expect(await bulkDecideOrderClaimsAction({}, bulkForm(ids, 'review'))).toEqual({
      error: '한 번에 50건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.',
    });
    mocks.getCurrentAdminAuthState.mockResolvedValue({ isConfigured: true, user: { id: 'u' }, isStaff: false, role: 'fan' });
    expect(await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'review'))).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('목록 유형이 없거나 잘못되면 처리하지 않는다', async () => {
    const state = await bulkDecideOrderClaimsAction({}, bulkForm([ID(1)], 'review', 'unknown'));
    expect(state.error).toBe('목록을 새로고침한 뒤 다시 실행해주세요.');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

/*
 * 단계 일괄 처리(1027T-033·SHEET-049·SHEET-052 · 2026-11-11 결정 "회수·환불·재출고 일괄").
 * 확인창의 건수·합계·제외 사유는 서버가 읽은 사실(admin_order_claim_bulk_context)로 계산하고, 실행은 건마다 사실을
 * 다시 읽은 뒤 상세와 같은 단건 서버 액션을 순서대로 탄다. 결제사 취소는 같은 결제에 겹치지 않게 한 건씩 보낸다.
 */
const SHIP = (n: number) => `5a1e0000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

type Fact = Record<string, unknown>;
function fact(n: number, overrides: Fact = {}): Fact {
  return {
    claimId: ID(n), reference: n, orderId: ORDER(n), claimType: 'return', stage: 'collected', heldFrom: null,
    collectionPolicy: 'origin', collectionRequired: true, collectionComplete: true, collectedAt: null, collectionReceivedOn: null,
    collections: [], paymentProvider: 'toss', paymentStatus: 'paid', refundMethod: null, refundFiledAt: null, refundCompletedAt: null,
    refundAmount: 10000 * n, refundBlocker: null, ...overrides,
  };
}
function collection(n: number, overrides: Fact = {}): Fact {
  return { shipmentId: SHIP(n), originName: n % 2 ? 'TEST 김포' : 'TEST 남양주', collectedAt: null, receivedOn: null, waived: false, returnAddressReady: true, ...overrides };
}

/** 사실 RPC는 요청한 id 순서대로, 나머지 RPC는 handler가 답한다. 호출 순서를 events에 남긴다. */
function stepRpc(facts: Map<string, Fact>, handler: (name: string, args: Record<string, unknown>) => unknown = () => null) {
  const events: string[] = [];
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'admin_order_claim_bulk_context') {
      return { data: (args.p_claim_ids as string[]).flatMap((id) => facts.has(id) ? [facts.get(id)] : []), error: null };
    }
    events.push(`${name}:${String(args.p_claim_id ?? args.p_request_id ?? '').slice(0, 8)}${args.p_stage ? `:${args.p_stage}` : ''}`);
    const value = handler(name, args);
    return value && typeof value === 'object' && 'error' in value ? value : { data: value, error: null };
  });
  return events;
}

describe('단계 일괄 확인창(previewOrderClaimBulkStepAction)', () => {
  it('회수 확인은 요청마다 남은 출고지와 일괄에서 빼는 출고지·사유를 서버 사실로 돌려준다', async () => {
    stepRpc(new Map([
      [ID(1), fact(1, { stage: 'collecting', collections: [collection(1), collection(2, { collectedAt: '2026-11-10T00:00:00Z', receivedOn: '2026-11-10' })] })],
      [ID(2), fact(2, { claimType: 'exchange', stage: 'collecting', collections: [collection(3), collection(4, { waived: true })] })],
      [ID(3), fact(3, { stage: 'requested' })],
      [ID(4), fact(4, { stage: 'collecting', collectionPolicy: 'legacy' })],
    ]));
    const state = await previewOrderClaimBulkStepAction({ claimType: 'return', step: 'collect', claimIds: [ID(1), ID(2), ID(3), ID(4), ID(5)] });
    expect(state.preview?.step).toBe('collect');
    const rows = state.preview?.step === 'collect' ? state.preview.rows : [];
    expect(rows.map((row) => [row.reference, row.targets.map((target) => target.originName), row.blocker])).toEqual([
      ['C00001', ['TEST 김포'], null],
      ['C00002', [], '반품 요청이 아닙니다. 해당 목록에서 처리해주세요.'],
      ['C00003', [], '승인 전 요청입니다. 승인한 뒤 회수를 확인해주세요.'],
      ['C00004', [null], null],
      ['확인 불가', [], '클레임을 찾을 수 없습니다.'],
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_order_claim_bulk_context', { p_claim_ids: [ID(1), ID(2), ID(3), ID(4), ID(5)] });
  });

  it('교환의 회수 생략 출고지는 일괄 회수에서 빼고 사유를 남긴다', async () => {
    stepRpc(new Map([[ID(2), fact(2, { claimType: 'exchange', stage: 'collecting', collections: [collection(3), collection(4, { waived: true })] })]]));
    const state = await previewOrderClaimBulkStepAction({ claimType: 'exchange', step: 'collect', claimIds: [ID(2)] });
    const [row] = state.preview?.step === 'collect' ? state.preview.rows : [];
    expect(row.targets).toEqual([{ shipmentId: SHIP(3), originName: 'TEST 김포' }]);
    expect(row.skipped).toEqual([{ originName: 'TEST 남양주', reason: expect.stringContaining('회수 생략으로 결정한 출고지') }]);
  });

  it('환불 완료 확정은 결제사 취소로 끝낼 건만 세어 합계를 내고, 무통장·가상계좌·코페이는 사유와 함께 뺀다', async () => {
    stepRpc(new Map([
      [ID(1), fact(1)],
      [ID(2), fact(2, { paymentProvider: 'nicepay', stage: 'processing' })],
      [ID(3), fact(3, { paymentProvider: 'bank_transfer', refundBlocker: 'bank_transfer' })],
      [ID(4), fact(4, { refundBlocker: 'virtual_account' })],
      [ID(5), fact(5, { paymentProvider: 'korpay', refundBlocker: 'korpay' })],
      [ID(6), fact(6, { stage: 'collecting', refundBlocker: 'claim_collections_incomplete' })],
    ]));
    const state = await previewOrderClaimBulkStepAction({ claimType: 'return', step: 'refund', claimIds: [1, 2, 3, 4, 5, 6].map(ID) });
    if (state.preview?.step !== 'refund') throw new Error('refund preview expected');
    expect(state.preview.totals).toEqual({
      count: 2, amount: 30000,
      byProvider: [{ label: '토스페이먼츠', count: 1, amount: 10000 }, { label: '나이스페이', count: 1, amount: 20000 }],
    });
    expect(state.preview.rows.map((row) => [row.reference, row.providerLabel, row.amount, row.blocker?.slice(0, 12) ?? null])).toEqual([
      ['C00001', '토스페이먼츠', 10000, null],
      ['C00002', '나이스페이', 20000, null],
      ['C00003', '무통장 입금', 30000, '무통장 입금 결제는 결'],
      ['C00004', '토스페이먼츠', 40000, '가상계좌 결제는 환불계'],
      ['C00005', '코페이', 50000, '코페이 결제는 결제사 '],
      ['C00006', '토스페이먼츠', 60000, '모든 출고지의 회수 확'],
    ]);
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('목록에 없는 단계·권한 없음·잘못된 선택은 사실을 읽지 않는다', async () => {
    expect(await previewOrderClaimBulkStepAction({ claimType: 'cancel', step: 'collect', claimIds: [ID(1)] })).toEqual({ error: '처리할 작업을 선택해주세요.' });
    expect(await previewOrderClaimBulkStepAction({ claimType: 'exchange', step: 'refund', claimIds: [ID(1)] })).toEqual({ error: '처리할 작업을 선택해주세요.' });
    expect((await previewOrderClaimBulkStepAction({ claimType: 'return', step: 'refund', claimIds: ['not-a-uuid'] })).error).toContain('선택한 요청을 확인하지 못했습니다');
    mocks.getCurrentAdminAuthState.mockResolvedValue({ isConfigured: true, user: { id: 'u' }, isStaff: false, role: 'fan' });
    expect(await previewOrderClaimBulkStepAction({ claimType: 'return', step: 'refund', claimIds: [ID(1)] })).toEqual({ error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('일괄 환불 완료 확정(runOrderClaimBulkRefundsAction)', () => {
  function detail(n: number, stage: string) {
    return { claim: { id: ID(n), orderId: ORDER(n), stage }, payment: { provider: 'toss' }, refund: stage === 'collected' ? null : { method: 'pg_cancel' } };
  }

  it('건마다 사실을 다시 읽고, 입고완료 건은 환불 접수 뒤 결제사 취소·완료 기록까지 끝낸 다음 건을 시작한다', async () => {
    const facts = new Map([[ID(1), fact(1)], [ID(2), fact(2, { stage: 'processing', refundMethod: 'pg_cancel' })]]);
    const events = stepRpc(facts, (name) => (name === 'admin_record_order_claim_refund' ? 'ok' : name === 'admin_goods_manual_recovery_attempts' ? [] : null));
    mocks.loadAdminClaimDetail.mockImplementation(async (id: string) => detail(id === ID(1) ? 1 : 2, id === ID(1) && !events.some((e) => e.endsWith(':filed')) ? 'collected' : 'processing'));
    mocks.reconcileOrderCancellation.mockImplementation(async ({ requestId }: { requestId: string }) => {
      events.push(`cancel:${requestId.slice(0, 8)}`);
      return { ok: true, status: 'completed' };
    });

    const state = await runOrderClaimBulkRefundsAction({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: 10000 }, { claimId: ID(2), expectedAmount: 20000 }] });

    expect(events).toEqual([
      'admin_record_order_claim_refund:abcdef01:filed',
      'admin_goods_manual_recovery_attempts:', 'admin_begin_order_cancellation_reconcile:abcdef01', 'cancel:abcdef01',
      'admin_record_order_claim_refund:abcdef01:completed',
      'admin_goods_manual_recovery_attempts:', 'admin_begin_order_cancellation_reconcile:abcdef02', 'cancel:abcdef02',
      'admin_record_order_claim_refund:abcdef02:completed',
    ]);
    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_refund', expect.objectContaining({ p_claim_id: ID(1), p_method: 'pg_cancel', p_stage: 'filed' }));
    expect(state.results?.map((result) => [result.reference, result.outcome])).toEqual([['C00001', 'done'], ['C00002', 'done']]);
    expect(state.results?.[0].message).toContain('토스 전액 취소를 확인하고 환불 완료를 기록했습니다');
    expect(state.summary).toBe('처리됨 2건 · 실패 0건');
  });

  it('확인창과 금액이 달라졌거나 제외 사유가 생긴 건은 결제사 취소를 발행하지 않는다', async () => {
    stepRpc(new Map([[ID(1), fact(1, { refundAmount: 15000 })], [ID(2), fact(2, { paymentProvider: 'bank_transfer', refundBlocker: 'bank_transfer' })]]));
    const state = await runOrderClaimBulkRefundsAction({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: 10000 }, { claimId: ID(2), expectedAmount: 20000 }] });
    expect(state.results?.map((result) => result.outcome)).toEqual(['failed', 'excluded']);
    expect(state.results?.[0].message).toContain('확인한 금액(₩10,000)과 지금 환불 금액(₩15,000)이 달라');
    expect(state.results?.[1].message).toContain('무통장 입금 결제는 결제사 취소가 없습니다');
    expect(state.summary).toBe('처리됨 0건 · 실패 1건 · 제외 1건');
    expect(mocks.loadAdminClaimDetail).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  it('한 건의 결제사 취소가 실패해도 이미 끝난 건은 되돌리지 않고 다음 건을 계속 처리한다', async () => {
    stepRpc(new Map([[ID(1), fact(1, { stage: 'processing' })], [ID(2), fact(2, { stage: 'processing' })]]),
      (name) => (name === 'admin_record_order_claim_refund' ? 'ok' : name === 'admin_goods_manual_recovery_attempts' ? [] : null));
    mocks.loadAdminClaimDetail.mockImplementation(async (id: string) => detail(id === ID(1) ? 1 : 2, 'processing'));
    mocks.reconcileOrderCancellation
      .mockResolvedValueOnce({ ok: false, code: 'provider_cancel_failed' })
      .mockResolvedValueOnce({ ok: true, status: 'completed' });
    const state = await runOrderClaimBulkRefundsAction({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: 10000 }, { claimId: ID(2), expectedAmount: 20000 }] });
    expect(state.results?.map((result) => result.outcome)).toEqual(['failed', 'done']);
    expect(state.results?.[0].message).toContain('provider_cancel_failed');
    expect(mocks.rpc).not.toHaveBeenCalledWith('admin_record_order_claim_refund', expect.objectContaining({ p_claim_id: ID(1), p_stage: 'completed' }));
  });

  it('결제사 한 건의 최악 시간이 함수 마감을 넘기면 남은 건은 시작하지 않고 미처리로 돌려준다', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    stepRpc(new Map([[ID(1), fact(1, { stage: 'processing' })], [ID(2), fact(2, { stage: 'processing' })]]),
      (name) => (name === 'admin_record_order_claim_refund' ? 'ok' : name === 'admin_goods_manual_recovery_attempts' ? [] : null));
    mocks.loadAdminClaimDetail.mockImplementation(async (id: string) => detail(id === ID(1) ? 1 : 2, 'processing'));
    mocks.reconcileOrderCancellation.mockImplementation(async () => { now += 20_000; return { ok: true, status: 'completed' }; });
    const state = await runOrderClaimBulkRefundsAction({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: 10000 }, { claimId: ID(2), expectedAmount: 20000 }] });
    /* 둘째 건 시작 시점 경과 20초 + (결제사 30초 + 접수 10초) > 마감 55초 → 시작하지 않는다. 화면이 같은 확인 아래 이어서 보낸다. */
    expect(state.results?.map((result) => result.outcome)).toEqual(['done', 'skipped']);
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledTimes(1);
  });

  it('교환 목록이나 잘못된 금액은 처리하지 않는다', async () => {
    expect(await runOrderClaimBulkRefundsAction({ claimType: 'exchange', items: [{ claimId: ID(1), expectedAmount: 1 }] })).toEqual({ error: '취소와 반품 요청만 환불을 확정합니다.' });
    expect((await runOrderClaimBulkRefundsAction({ claimType: 'return', items: [{ claimId: ID(1), expectedAmount: -1 }] })).error).toContain('확인한 환불 금액');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('일괄 회수 확인(runOrderClaimBulkCollectionsAction)', () => {
  it('확인창에서 고른 출고지만 공통 입고일·근거로 하나씩 확인하고, 그 사이 확인된 출고지는 건너뛴다', async () => {
    stepRpc(new Map([
      [ID(1), fact(1, { stage: 'collecting', collections: [collection(1), collection(2, { collectedAt: '2026-11-11T00:00:00Z' }), collection(3)] })],
      [ID(2), fact(2, { stage: 'collecting', collectionPolicy: 'legacy' })],
    ]), (name) => (name === 'admin_record_order_claim_origin_collection' ? 'collecting' : name === 'admin_record_order_claim_collection' ? 'collected' : null));
    const state = await runOrderClaimBulkCollectionsAction({
      claimType: 'return', receivedOn: '2026-11-10', evidence: ' 창고 회신 R-1 대조 ',
      items: [{ claimId: ID(1), shipmentIds: [SHIP(1), SHIP(2)] }, { claimId: ID(2), shipmentIds: [] }],
    });
    expect(mocks.rpc.mock.calls.filter(([name]) => name !== 'admin_order_claim_bulk_context')).toEqual([
      ['admin_record_order_claim_origin_collection', { p_claim_id: ID(1), p_shipment_id: SHIP(1), p_evidence: '창고 회신 R-1 대조', p_received_on: '2026-11-10' }],
      /* 레거시 회수에는 근거 열이 없어 공통 근거를 감사 기록으로 넘긴다(T11b 리뷰 minor 4). */
      ['admin_record_order_claim_collection', { p_claim_id: ID(2), p_stage: 'collected', p_received_on: '2026-11-10', p_evidence: '창고 회신 R-1 대조' }],
    ]);
    expect(state.results?.map((result) => [result.reference, result.outcome, result.message])).toEqual([
      ['C00001', 'done', 'TEST 김포 회수를 확인했습니다(실제 입고일 2026-11-10). 남은 출고지 1곳은 따로 확인해주세요.'],
      ['C00002', 'done', '입고를 확인했습니다(실제 입고일 2026-11-10).'],
    ]);
  });

  it('한 출고지가 실패하면 그 요청의 확인한 출고지와 실패 사유를 함께 남긴다', async () => {
    stepRpc(new Map([[ID(1), fact(1, { stage: 'collecting', collections: [collection(1), collection(2)] })]]), (name, args) => (
      name === 'admin_record_order_claim_origin_collection' && args.p_shipment_id === SHIP(2) ? { data: null, error: { message: 'claim_return_address_required' } } : 'collecting'));
    const state = await runOrderClaimBulkCollectionsAction({ claimType: 'return', receivedOn: '2026-11-10', evidence: '대조 완료', items: [{ claimId: ID(1), shipmentIds: [SHIP(1), SHIP(2)] }] });
    expect(state.results?.[0]).toMatchObject({ outcome: 'failed', message: 'TEST 김포 회수는 확인했습니다. TEST 남양주: 회수 주소가 없는 상품이 있습니다. 상품의 반품/교환지를 고르거나 출고지 설정에 반품 주소를 등록한 뒤 다시 진행해주세요.' });
  });

  /* S36-040: 반품지가 갈린 배송 건은 확인창에서 고른 회수 묶음만 묶음 키 RPC로 확인한다. */
  it('반품지가 갈린 배송 건은 고른 회수 묶음만 묶음 키로 확인한다', async () => {
    const bundles = [{ bundleId: SHIP(81), returnName: '', collectedAt: null, returnAddressReady: true },
      { bundleId: SHIP(82), returnName: '서울 반품지', collectedAt: null, returnAddressReady: true }];
    stepRpc(new Map([[ID(1), fact(1, { stage: 'collecting', collections: [collection(1, { bundles })] })]]), () => 'collecting');
    const state = await runOrderClaimBulkCollectionsAction({ claimType: 'return', receivedOn: '2026-11-10', evidence: '서울 반품지 대조',
      items: [{ claimId: ID(1), shipmentIds: [], bundleIds: [SHIP(82)] }] });
    expect(mocks.rpc.mock.calls.filter(([name]) => name !== 'admin_order_claim_bulk_context')).toEqual([
      ['admin_record_order_claim_collection_bundle', { p_claim_id: ID(1), p_bundle_id: SHIP(82), p_evidence: '서울 반품지 대조', p_received_on: '2026-11-10' }],
    ]);
    expect(state.results?.[0]).toMatchObject({ outcome: 'done', message: 'TEST 김포 · 서울 반품지 회수를 확인했습니다(실제 입고일 2026-11-10). 남은 출고지 1곳은 따로 확인해주세요.' });
  });

  it('미래 입고일·빈 근거·취소 목록은 RPC 전에 거절한다', async () => {
    expect(await runOrderClaimBulkCollectionsAction({ claimType: 'return', receivedOn: '2999-01-01', evidence: '대조', items: [{ claimId: ID(1), shipmentIds: [] }] }))
      .toEqual({ error: '실제 입고일은 오늘이나 그 이전 날짜로 입력해주세요.' });
    expect(await runOrderClaimBulkCollectionsAction({ claimType: 'return', receivedOn: '2026-11-10', evidence: '  ', items: [{ claimId: ID(1), shipmentIds: [] }] }))
      .toEqual({ error: '회수 확인 근거를 500자 이내로 입력해주세요.' });
    expect(await runOrderClaimBulkCollectionsAction({ claimType: 'cancel', receivedOn: '2026-11-10', evidence: '대조', items: [{ claimId: ID(1), shipmentIds: [] }] }))
      .toEqual({ error: '반품과 교환 요청만 회수를 확인합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('재출고 표(loadOrderClaimBulkReshipmentsAction)', () => {
  it('회수를 확인한 출고지만 재출고 줄로 열고, 회수 전 출고지와 재출고할 수 없는 요청은 사유와 함께 뺀다', async () => {
    mocks.carriers.mockResolvedValue([
      { code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
      { code: 'old', label: '옛 택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
    ]);
    const item = (n: number) => ({ id: `0000000${n}-0000-4000-8000-000000000000`, name: `굿즈 ${n}`, qty: 1, variantName: '기본', currentVariantId: `variant-${n}`,
      options: [{ id: `variant-${n}`, name: '기본', code: `SKU-${n}`, stockQty: 3, goodName: `굿즈 ${n}` }] });
    const target = (overrides: Record<string, unknown> = {}) => ({ waiver: null, productionRequired: false, productionPending: false, ...overrides });
    mocks.loadAdminClaimDetail.mockImplementation(async (id: string) => id === ID(1) ? {
      claim: { id: ID(1), reference: 1, orderId: ORDER(1), claimType: 'exchange', stage: 'collecting', collectionPolicy: 'origin', reshipTrackingNumber: null, collectionWaiverAllowed: true,
        reshipmentTargets: [
          { shipmentId: SHIP(1), originName: 'TEST 김포', collectionTracked: true, collectedAt: '2026-11-11T00:00:00Z', reshipped: false, orderItemIds: [item(1).id], ...target() },
          { shipmentId: SHIP(2), originName: 'TEST 남양주', collectionTracked: true, collectedAt: null, reshipped: false, orderItemIds: [item(2).id], ...target() },
          /* 회수 생략을 이미 결정한 배송 건은 회수 확인 없이 재출고 줄로 연다(T11a 결정 표). */
          { shipmentId: SHIP(3), originName: 'TEST 부천', collectionTracked: true, collectedAt: null, reshipped: false, orderItemIds: [item(3).id],
            ...target({ waiver: { reason: 'TEST 인쇄 불량 사진', waivedAt: '2026-11-11T00:00:00Z', waivedByName: null, evidence: [] } }) },
          /* 주문제작: 회수 생략 결정 전이면 상세에서 결정, 결정·회수 뒤에도 제작 중이면 기다린다. */
          { shipmentId: SHIP(4), originName: 'TEST 파주', collectionTracked: true, collectedAt: null, reshipped: false, orderItemIds: [item(4).id], ...target({ productionRequired: true }) },
          { shipmentId: SHIP(5), originName: 'TEST 이천', collectionTracked: true, collectedAt: '2026-11-11T00:00:00Z', reshipped: false, orderItemIds: [item(5).id],
            ...target({ productionRequired: true, productionPending: true }) },
        ] },
      order: { items: [item(1), item(2), item(3), item(4), item(5)] },
    } : id === ID(2) ? {
      claim: { id: ID(2), reference: 2, orderId: ORDER(2), claimType: 'exchange', stage: 'completed', collectionPolicy: 'origin', reshipTrackingNumber: 'DONE00000001', reshipmentTargets: [] },
      order: { items: [] },
    } : null);
    const load = await loadOrderClaimBulkReshipmentsAction({ claimType: 'exchange', step: 'reship', claimIds: [ID(1), ID(2), ID(3)] });
    if (load.error !== undefined) throw new Error(load.error);
    expect(load.actorId).toBe('staff-1');
    expect(load.carriers).toEqual([{ code: 'hanjin', label: '한진택배' }]);
    expect(load.claims).toEqual([{
      claimId: ID(1), orderId: ORDER(1), reference: 'C00001',
      rows: [
        { shipmentId: SHIP(1), originName: 'TEST 김포', waived: false, items: [{ orderItemId: item(1).id, name: '굿즈 1', variantName: '기본', qty: 1, currentVariantId: 'variant-1',
          options: [{ id: 'variant-1', label: '굿즈 1 · 기본 · SKU-1 · 재고 3개' }] }] },
        { shipmentId: SHIP(3), originName: 'TEST 부천', waived: true, items: [expect.objectContaining({ orderItemId: item(3).id })] },
      ],
      skipped: [
        { originName: 'TEST 남양주', reason: expect.stringContaining('회수 없이 재출고는 근거 사진이 필요해 상세에서') },
        { originName: 'TEST 파주', reason: expect.stringContaining('상세에서 회수 생략을 먼저 결정') },
        { originName: 'TEST 이천', reason: expect.stringContaining('교환품 제작이 끝나지 않은 출고지') },
      ],
    }]);
    expect(load.excluded).toEqual([
      { claimId: ID(2), reference: 'C00002', reason: '이미 재출고로 종결된 교환입니다.' },
      { claimId: ID(3), reference: null, reason: '클레임을 찾을 수 없습니다.' },
    ]);
  });

  it('교환 목록 밖이나 20건을 넘기면 열지 않는다', async () => {
    expect(await loadOrderClaimBulkReshipmentsAction({ claimType: 'return', step: 'reship', claimIds: [ID(1)] })).toEqual({ error: '처리할 작업을 선택해주세요.' });
    expect((await loadOrderClaimBulkReshipmentsAction({ claimType: 'exchange', step: 'reship', claimIds: Array.from({ length: 21 }, (_, n) => ID(n)) })).error)
      .toBe('한 번에 20건까지 처리할 수 있습니다. 선택을 줄여 다시 실행해주세요.');
    expect(mocks.loadAdminClaimDetail).not.toHaveBeenCalled();
  });
});

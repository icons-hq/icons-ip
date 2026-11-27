import { legacyOperatorAccessFixture } from '@/lib/admin/access.test-fixtures';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideOrderClaimAction, readOrderClaimApprovalAmountAction, recordOrderClaimRefundAction } from './claim-actions';
import { ADMIN_CANCELLATION_RECHECK_LABELS } from '@/lib/admin/orders';

/*
 * 클레임 콘솔의 취소 승인·환불 확정이 실제 결제사 취소로 이어지는지(2026-10-12 점검
 * REF-2·REF-8). 승인은 원장만 여는 것이 아니라 오케스트레이터를 곧바로 실행해야 하고,
 * 토스 결제의 환불 수단은 폼이 아니라 결제가 정한다.
 */

const CLAIM_ID = 'abcdef01-1234-4123-8123-123456789abc';
const ORDER_ID = 'abcdef02-1234-4123-8123-123456789abc';

const mocks = vi.hoisted(() => ({
  getCurrentAdminAuthState: vi.fn(),
  createClient: vi.fn(),
  rpc: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn(),
  loadAdminClaimDetail: vi.fn(),
  reconcileOrderCancellation: vi.fn(),
  recoverGoodsPaymentManually: vi.fn(),
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

function detail(override: {
  provider?: string | null;
  stage?: string;
  refundMethod?: string | null;
} = {}) {
  return {
    claim: { id: CLAIM_ID, orderId: ORDER_ID, stage: override.stage ?? 'processing' },
    payment: override.provider === null ? null : { provider: override.provider ?? 'toss' },
    refund: { method: override.refundMethod ?? null },
  };
}

function decisionForm(decision: string, claimType = 'cancel') {
  const form = new FormData();
  form.set('claimId', CLAIM_ID);
  form.set('claimType', claimType);
  form.set('decision', decision);
  return form;
}

function refundForm(stage: 'filed' | 'completed', method: string) {
  const form = new FormData();
  form.set('claimId', CLAIM_ID);
  form.set('claimType', 'return');
  form.set('orderId', ORDER_ID);
  form.set('stage', stage);
  form.set('method', method);
  return form;
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
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe('decideOrderClaimAction — 취소 승인', () => {
  it('토스 결제 취소를 승인하면 곧바로 staff actor로 결제사 전액 취소 경로를 실행한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_decide_order_claim', expect.objectContaining({ p_decision: 'approve' }));
    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: CLAIM_ID, actorId: 'staff-1' });
    expect(state.message).toContain('토스 전액 취소까지 확인했습니다');
  });

  it('결제사 취소를 확정하지 못하면 승인은 남기되 오류와 재시도 경로를 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: false, code: 'provider_cancel_failed' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(state.error).toContain('provider_cancel_failed');
    expect(state.error).toContain('[환불 완료 확정]');
    /* L-12: 코드는 문장 끝 괄호가 아니라 '문의할 때 알려 줄 코드'로 한 번만 붙는다. */
    expect(state.error).not.toContain('(provider_cancel_failed)');
    expect(state.error!.endsWith(' 문의할 때 알려 줄 코드: provider_cancel_failed')).toBe(true);
  });

  /*
   * 결제 행이 없는 주문(결제창만 열린 pending)은 환불 기록이 없어 요청 상세에
   * [환불 완료 확정]이 그려지지 않는다. 처리중 요청은 만료 sweep도 건너뛰므로 주문
   * 통합검색 주문 패널의 재확인 버튼만 이 건을 닫는다 — 안내가 그 버튼을 가리켜야 한다.
   */
  it('결제 행이 없는 주문의 확인 중 결과는 [환불 완료 확정]이 아니라 주문 패널 재확인을 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: null }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'in_progress' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: CLAIM_ID, actorId: 'staff-1' });
    expect(state.message).toContain('주문 통합검색');
    expect(state.message).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.processing}]으로 다시 확인`);
    expect(state.message).not.toContain('[환불 완료 확정]으로');
  });

  it('결제 행이 없는 주문의 실패는 결제확인필요의 주문 패널 버튼을 안내한다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: null }));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: false, code: 'local_finalize_failed' });

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(state.error).toContain('local_finalize_failed');
    expect(state.error).toContain(`[${ADMIN_CANCELLATION_RECHECK_LABELS.needsReview}]`);
    expect(state.error).not.toContain('[환불 완료 확정]으로');
    /* D-11: 문장 가운데 괄호에 코드를 넣지 않는다. */
    expect(state.error).not.toContain('(local_finalize_failed)');
    expect(state.error!.endsWith(' 문의할 때 알려 줄 코드: local_finalize_failed')).toBe(true);
  });

  it('코페이 결제는 접수 양식 절차를 가리지 않도록 자동 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay' }));

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    /* 결제사 이름은 이름표의 '코페이' 하나다(D-05). */
    expect(state.message).toContain('코페이 결제는 결제사 취소 접수 양식으로 접수한 뒤');
    expect(state.message).not.toContain('Korpay');
  });

  it('무통장 입금 결제는 계좌 송금 절차를 가리지 않도록 자동 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'processing', error: null });
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'bank_transfer' }));

    const state = await decideOrderClaimAction({}, decisionForm('approve'));

    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toContain('무통장 입금 결제');
  });

  it('반품 승인(수거 시작)은 결제사 취소를 실행하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: 'collecting', error: null });

    const state = await decideOrderClaimAction({}, decisionForm('approve', 'return'));

    expect(mocks.loadAdminClaimDetail).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(state.message).toBe('반품 요청을 승인하고 수거를 시작했습니다.');
  });
});

describe('recordOrderClaimRefundAction — 환불 수단은 결제가 정한다', () => {
  it('토스 결제에 계좌 송금을 보내면 결제사 호출 전에 거절한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss' }));

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toContain('토스 결제는 결제사 취소');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
  });

  /* D-05: 나이스페이 결제에 '토스'라고 말하지 않는다. 결제사 이름은 이름표에서 읽는다. */
  it('나이스페이 결제의 수단 불일치는 나이스페이라고 말한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'nicepay' }));

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'bank_transfer'));

    expect(state.error).toBe('이 결제의 환불 수단과 다릅니다. 나이스페이 결제는 결제사 취소(나이스페이 전액 취소)로만 환불합니다. 화면을 새로고침한 뒤 다시 진행해주세요.');
    expect(state.error).not.toContain('토스');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('토스 환불 완료 확정은 오케스트레이터를 실행한 뒤 원장에 기록한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss', stage: 'processing' }));
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'admin_goods_manual_recovery_attempts' ? { data: [], error: null } : { data: null, error: null }
    ));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(mocks.reconcileOrderCancellation).toHaveBeenCalledWith({ requestId: CLAIM_ID, actorId: 'staff-1' });
    const calls = mocks.rpc.mock.calls.map(([name]) => name);
    expect(calls.indexOf('admin_begin_order_cancellation_reconcile')).toBeLessThan(calls.indexOf('admin_record_order_claim_refund'));
    expect(state.message).toContain('토스 전액 취소를 확인하고');
  });

  /* 2026-10-12 QA-10: 확정하지 못한 결과는 원인 코드를 싣는다. */
  it('토스 환불 완료 확정이 결제 취소를 확정하지 못하면 원인 코드를 보여준다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss', stage: 'needs_review' }));
    mocks.rpc.mockImplementation(async (name: string) => (
      name === 'admin_goods_manual_recovery_attempts' ? { data: [], error: null } : { data: null, error: null }
    ));
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: false, code: 'provider_cancel_rejected' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(state.error).toContain('결제사가 취소를 거절했습니다');
    /* 다음에 누가 무엇을 하는지 말하고, 코드는 끝에 한 번만 붙는다(L-12). */
    expect(state.error).toContain('결제 담당자에게 요청번호와 코드를 알려주세요.');
    expect(state.error).not.toContain('(provider_cancel_rejected)');
    expect(state.error!.endsWith(' 문의할 때 알려 줄 코드: provider_cancel_rejected')).toBe(true);
    expect(mocks.rpc.mock.calls.map(([name]) => name)).not.toContain('admin_record_order_claim_refund');
  });

  it('결제사 취소 뒤 원장 기록만 실패하면 "다시 환불하지 마세요"를 먼저 말한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'toss', stage: 'processing' }));
    mocks.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_goods_manual_recovery_attempts') return { data: [], error: null };
      if (name === 'admin_record_order_claim_refund') return { data: null, error: { message: 'claim_refund_ledger_missing' } };
      return { data: null, error: null };
    });
    mocks.reconcileOrderCancellation.mockResolvedValue({ ok: true, status: 'completed' });

    const state = await recordOrderClaimRefundAction({}, refundForm('completed', 'pg_cancel'));

    expect(state.error).toMatch(/^토스 전액 취소와 주문 취소·재고 복원은 이미 완료됐습니다/);
    expect(state.error).toContain('다시 환불하지 마세요');
  });

  it('원장에 이미 기록된 수단과 다른 값은 거절한다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay', refundMethod: 'bank_transfer' }));

    const state = await recordOrderClaimRefundAction({}, refundForm('filed', 'pg_cancel'));

    expect(state.error).toBe("이 요청의 환불은 이미 '계좌 송금' 수단으로 접수했습니다. 처음 기록한 수단으로만 이어서 처리합니다. 화면을 새로고침한 뒤 다시 진행해주세요.");
    expect(state.error).not.toContain('토스');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('코페이처럼 수단이 정해지지 않은 결제는 운영자 선택을 그대로 쓴다', async () => {
    mocks.loadAdminClaimDetail.mockResolvedValue(detail({ provider: 'korpay', stage: 'collected' }));
    mocks.rpc.mockResolvedValue({ data: 'filed', error: null });

    const state = await recordOrderClaimRefundAction({}, refundForm('filed', 'bank_transfer'));

    expect(mocks.rpc).toHaveBeenCalledWith('admin_record_order_claim_refund', expect.objectContaining({ p_method: 'bank_transfer' }));
    expect(state.message).toBe('환불 접수를 기록했습니다.');
  });
});

/*
 * A-3: 취소 승인 확인창의 금액. 승인 전에는 환불 기록이 없어 화면이 가진 금액이 주문 금액뿐이고, 재고 부족 부분 취소가 있었던
 * 주문은 그보다 적게(결제 금액 − 이미 부분 취소한 금액) 취소된다. 화면은 누르는 시점에 DB의 같은 계산을 읽는다 — 읽기만 한다.
 */
describe('readOrderClaimApprovalAmountAction — 취소 승인 확인창의 금액', () => {
  const context = (override: Record<string, unknown> = {}) => ({
    claimId: CLAIM_ID, reference: 12, orderId: ORDER_ID, claimType: 'cancel', stage: 'requested', collectionPolicy: 'origin',
    collectionRequired: false, collections: [], paymentProvider: 'toss', refundAmount: 30500, refundBlocker: 'claim_not_approved', ...override,
  });

  it('DB가 계산한 취소 금액(남은 결제 금액)과 결제사를 돌려주고 아무것도 바꾸지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: [context()], error: null });

    await expect(readOrderClaimApprovalAmountAction(CLAIM_ID.toUpperCase())).resolves.toEqual({ ok: true, amount: 30500, paymentProvider: 'toss' });
    expect(mocks.rpc.mock.calls).toEqual([['admin_order_claim_bulk_context', { p_claim_ids: [CLAIM_ID] }]]);
    expect(mocks.reconcileOrderCancellation).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('승인할 수 없는 단계로 바뀌었으면 금액 대신 그 사실을 알린다', async () => {
    mocks.rpc.mockResolvedValue({ data: [context({ stage: 'processing' })], error: null });

    await expect(readOrderClaimApprovalAmountAction(CLAIM_ID)).resolves.toEqual({
      ok: false, error: '지금 단계에서는 처리할 수 없습니다. 다른 담당자가 먼저 처리했을 수 있으니 새로고침해 현재 단계를 확인해주세요.',
    });
  });

  it.each([
    ['읽기 실패', { data: null, error: { message: 'connection reset' } }],
    ['모양이 어긋난 응답', { data: [{ claimId: CLAIM_ID }], error: null }],
    ['없는 요청', { data: [], error: null }],
  ])('%s는 금액을 지어내지 않고 승인하지 않았다고 알린다', async (_label, response) => {
    mocks.rpc.mockResolvedValue(response);

    await expect(readOrderClaimApprovalAmountAction(CLAIM_ID)).resolves.toEqual({
      ok: false, error: '취소할 금액을 다시 읽지 못해 승인하지 않았습니다. 새로고침한 뒤 다시 눌러주세요.',
    });
  });

  it('요청번호가 아니거나 권한이 없으면 DB를 읽지 않는다', async () => {
    expect((await readOrderClaimApprovalAmountAction('not-a-uuid')).ok).toBe(false);
    mocks.getCurrentAdminAuthState.mockResolvedValue({ operatorAccess: null, isConfigured: true, user: { id: 'user-1' }, role: 'user', isStaff: false });
    await expect(readOrderClaimApprovalAmountAction(CLAIM_ID)).resolves.toEqual({ ok: false, error: '관리자 권한이 필요합니다.' });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

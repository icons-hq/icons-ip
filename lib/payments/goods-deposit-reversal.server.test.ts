import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import type { PaymentAttempt, PaymentBalanceInspection } from './gateway';
import {
  createGoodsDepositReversal,
  depositReversalRefundOutcome,
  parseDepositReversalCloseResult,
  parseOpenDepositReversal,
  type DepositReversalCloseResult,
  type GoodsDepositReversalDependencies,
  type OpenDepositReversal,
} from './goods-deposit-reversal.server';

const ATTEMPT_ID = '31000000-0000-4000-8000-000000005101';
const ORDER_ID = '21000000-0000-4000-8000-000000005101';
const NOW = new Date('2026-11-25T03:00:00.000Z');

const attempt: PaymentAttempt = {
  id: ATTEMPT_ID,
  provider: 'toss',
  purpose: 'order',
  refId: ORDER_ID,
  amount: 31000,
  currency: 'KRW',
  idempotencyKey: 'goods:va',
  providerOrderId: 'O310000',
  providerProductCode: 'P310000',
  expiresAt: '2026-11-25T15:00:00.000Z',
};

function reversal(overrides: Partial<OpenDepositReversal> = {}): OpenDepositReversal {
  return {
    attemptId: ATTEMPT_ID,
    orderId: ORDER_ID,
    paymentKey: 'ledger-key',
    state: 'awaiting_redeposit',
    sequence: 1,
    reviewCode: null,
    dueAt: '2026-11-25T15:00:00.000Z',
    released: false,
    ...overrides,
  };
}

function ok(overrides: Partial<Extract<PaymentBalanceInspection, { kind: 'ok' }>> = {}): PaymentBalanceInspection {
  return {
    kind: 'ok',
    status: 'WAITING_FOR_DEPOSIT',
    balanceAmount: 31000,
    lastCancel: null,
    virtualAccount: true,
    lastTransactionKey: 'TX-REVERSAL',
    virtualAccountDueAt: '2026-11-25T15:00:00.000Z',
    virtualAccountExpired: false,
    ...overrides,
  };
}

function setup(options: {
  inspections?: PaymentBalanceInspection[];
  close?: DepositReversalCloseResult;
  open?: OpenDepositReversal | null;
  recordState?: string;
  resolved?: string;
  flag?: string;
} = {}) {
  const inspections = [...(options.inspections ?? [ok()])];
  const deps = {
    loadAttempt: vi.fn(async () => attempt),
    loadPaymentKey: vi.fn(async () => 'ledger-key'),
    loadOpenReversal: vi.fn(async () => (options.open === undefined ? reversal() : options.open)),
    inspect: vi.fn(async () => inspections.shift() ?? { kind: 'unavailable' as const }),
    release: vi.fn(async () => {}),
    flag: vi.fn(async () => options.flag ?? 'held'),
    recordCheck: vi.fn(async () => options.recordState ?? 'awaiting_redeposit'),
    resolveRedeposited: vi.fn(async () => options.resolved ?? 'redeposited'),
    close: vi.fn(async () => options.close ?? { status: 'closed' as const }),
    notifyReversal: vi.fn(async () => undefined),
    notifyCanceled: vi.fn(async () => undefined),
    continueCancellation: vi.fn(async () => {}),
    now: () => NOW,
  } satisfies GoodsDepositReversalDependencies;
  return { deps, ...createGoodsDepositReversal(deps) };
}

describe('입금 오류 되돌림 감지(checkDepositReversal)', () => {
  it('조회가 가상계좌 입금 전이면 보류·기록하고(조회한 기한을 넘긴다) 재입금 안내 메일을 보낸다', async () => {
    const { deps, checkDepositReversal } = setup();
    await expect(checkDepositReversal({ attemptId: ATTEMPT_ID, caseRef: 'case-0000000000000001' })).resolves.toBe('held');
    expect(deps.flag).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID, paymentKey: 'ledger-key', transactionRef: 'TX-REVERSAL',
      caseRef: 'case-0000000000000001', dueAt: '2026-11-25T15:00:00.000Z',
    });
    expect(deps.notifyReversal).toHaveBeenCalledWith(ORDER_ID);
  });

  it('입금 전이 아니면(DONE·카드) 되돌림이 아니다 — 기록·안내 없음', async () => {
    const done = setup({ inspections: [ok({ status: 'DONE' })] });
    await expect(done.checkDepositReversal({ attemptId: ATTEMPT_ID, caseRef: 'case-0000000000000001' })).resolves.toBe('not_applicable');
    const card = setup({ inspections: [ok({ virtualAccount: false })] });
    await expect(card.checkDepositReversal({ attemptId: ATTEMPT_ID, caseRef: 'case-0000000000000001' })).resolves.toBe('not_applicable');
    expect(done.deps.flag).not.toHaveBeenCalled();
    expect(card.deps.notifyReversal).not.toHaveBeenCalled();
  });

  it('조회하지 못하면 throw한다(웹훅이 5xx로 재전송을 받는다)', async () => {
    const { checkDepositReversal } = setup({ inspections: [{ kind: 'unavailable' }] });
    await expect(checkDepositReversal({ attemptId: ATTEMPT_ID, caseRef: 'case-0000000000000001' })).rejects.toThrow();
  });
});

describe('입금 오류 되돌림 처리(settleDepositReversal)', () => {
  const caseRef = 'auto-202611250300-31000000000040008000000000005101';

  it('재입금(DONE, 잔액 = 총액)이면 보류를 푼다', async () => {
    const { deps, settleDepositReversal } = setup({ inspections: [ok({ status: 'DONE' })] });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'webhook' })).resolves.toBe('redeposited');
    expect(deps.resolveRedeposited).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, paymentKey: 'ledger-key', caseRef, sequence: 1 });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('입금 기한 + 30분 전이면 기다린다(조회한 기한을 남긴다)', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ virtualAccountDueAt: '2026-11-25T03:20:00.000Z' })],
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('waiting');
    expect(deps.recordCheck).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, outcome: 'waiting', dueAt: '2026-11-25T03:20:00.000Z' });
    expect(deps.release).not.toHaveBeenCalled();
  });

  it('기한 + 30분이 지나면 반납하고, 조회가 반납(CANCELED, 환불 흔적 없음)을 확인하면 주문을 닫고 안내한다', async () => {
    const overdue = '2026-11-25T02:00:00.000Z';
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ virtualAccountDueAt: overdue }), ok({ status: 'CANCELED', balanceAmount: 0, virtualAccountRefundStatus: 'NONE' })],
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('closed');
    expect(deps.release).toHaveBeenCalledWith(attempt, 'ledger-key');
    expect(deps.close).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, paymentKey: 'ledger-key', evidence: 'canceled', caseRef, sequence: 1 });
    expect(deps.notifyCanceled).toHaveBeenCalledWith(ORDER_ID);
  });

  it('결제사가 계좌를 만료시켰으면 반납 없이 만료로 닫는다', async () => {
    const { deps, settleDepositReversal } = setup({ inspections: [ok({ virtualAccountExpired: true })] });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('closed');
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledWith(expect.objectContaining({ evidence: 'expired' }));
  });

  it('웹훅은 기한이 지나도 반납하지 않고 다음 조회도 미루지 않는다(응답 예산·서명 없는 웹훅의 반복)', async () => {
    const { deps, settleDepositReversal } = setup({ inspections: [ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' }), { kind: 'unavailable' }] });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'webhook' })).resolves.toBe('waiting');
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'webhook' })).resolves.toBe('unavailable');
    expect(deps.release).not.toHaveBeenCalled();
    expect(deps.recordCheck).not.toHaveBeenCalled();
  });

  it('반품 요청은 시스템이 이어 닫지 않는다(운영자의 환불 단계가 같은 길로 닫는다)', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ status: 'CANCELED', balanceAmount: 0 })],
      close: { status: 'cancellation_pending', requestId: 'req-2', requestStatus: 'processing', claimType: 'return' },
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('cancellation_pending');
    expect(deps.continueCancellation).not.toHaveBeenCalled();
  });

  it('취소 요청 경로(cancel)는 기한 전이라도 반납하고, 그 요청은 다시 부르지 않는다', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok(), ok({ status: 'CANCELED', balanceAmount: 0 })],
      close: { status: 'cancellation_pending', requestId: 'req-1', requestStatus: 'processing', claimType: 'cancel' },
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'cancel' })).resolves.toBe('cancellation_pending');
    expect(deps.release).toHaveBeenCalled();
    expect(deps.continueCancellation).not.toHaveBeenCalled();
    expect(deps.notifyCanceled).not.toHaveBeenCalled();
  });

  it('자동 재확인이 활성 취소 요청을 만나면 그 요청을 결제 없이 마저 닫게 넘긴다', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ status: 'CANCELED', balanceAmount: 0 })],
      close: { status: 'cancellation_pending', requestId: 'req-1', requestStatus: 'needs_review', claimType: 'cancel' },
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('cancellation_pending');
    expect(deps.continueCancellation).toHaveBeenCalledWith({ requestId: 'req-1', requestStatus: 'needs_review' });
  });

  it('반납 직전에 다시 입금됐으면(반납 뒤 조회가 DONE) 재입금으로 닫는다', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' }), ok({ status: 'DONE' })],
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('redeposited');
    expect(deps.close).not.toHaveBeenCalled();
  });

  it('반납을 확인하지 못하면(여전히 입금 전) 상태를 바꾸지 않고 다음 회차에 다시 반납한다', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' }), ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' })],
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('unavailable');
    expect(deps.recordCheck).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, outcome: 'unavailable', dueAt: null });
    expect(deps.close).not.toHaveBeenCalled();
  });

  it('환불 송금 흔적이 있는 취소(돈이 들어왔다 나감)는 닫지 않고 확인 필요로 올린다', async () => {
    const { deps, settleDepositReversal } = setup({
      inspections: [ok({ status: 'CANCELED', balanceAmount: 0, virtualAccountRefundStatus: 'COMPLETED' })],
      recordState: 'review',
    });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('refunded');
    expect(deps.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'provider_refunded' }));
    expect(deps.close).not.toHaveBeenCalled();
  });

  it('조회 불가·불일치·모르는 상태는 상태를 기록만 한다', async () => {
    const unavailable = setup({ inspections: [{ kind: 'unavailable' }] });
    await expect(unavailable.settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('unavailable');
    const mismatch = setup({ inspections: [{ kind: 'mismatch' }], recordState: 'review' });
    await expect(mismatch.settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('review');
    expect(mismatch.deps.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
    const partial = setup({ inspections: [ok({ status: 'PARTIAL_CANCELED', balanceAmount: 1000 })], recordState: 'review' });
    await expect(partial.settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('review');
  });

  it('확인 필요(발송 등)는 기한이 지나도 반납하지 않는다 — 조회 불가로 올라간 건만 자동 처리로 돌아온다', async () => {
    const shipped = setup({
      open: reversal({ state: 'review', reviewCode: 'order_shipped' }),
      inspections: [ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' })],
      recordState: 'review',
    });
    await expect(shipped.settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('review');
    expect(shipped.deps.release).not.toHaveBeenCalled();

    const lookup = setup({
      open: reversal({ state: 'review', reviewCode: 'lookup_failed' }),
      inspections: [ok({ virtualAccountDueAt: '2026-11-25T01:00:00.000Z' }), ok({ virtualAccountExpired: true })],
    });
    await expect(lookup.settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('closed');
    expect(lookup.deps.release).toHaveBeenCalled();
  });

  it('반납을 이미 확인했는데 다시 입금 전으로 보이면 기록이 엇갈린 것이다', async () => {
    const { deps, settleDepositReversal } = setup({ open: reversal({ released: true }), recordState: 'review' });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'sweep' })).resolves.toBe('review');
    expect(deps.recordCheck).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'mismatch' }));
  });

  it('조회한 되돌림이 그 사이 닫히고 새 되돌림이 열렸으면(stale) 아무것도 닫지 않는다', async () => {
    const { deps, settleDepositReversal } = setup({ open: reversal({ sequence: 2 }), inspections: [ok({ status: 'DONE' })], resolved: 'stale' });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'webhook' })).resolves.toBe('not_applicable');
    expect(deps.resolveRedeposited).toHaveBeenCalledWith(expect.objectContaining({ sequence: 2 }));
  });

  it('열린 되돌림이 없으면 조회하지 않는다', async () => {
    const { deps, settleDepositReversal } = setup({ open: null });
    await expect(settleDepositReversal({ attemptId: ATTEMPT_ID, caseRef, mode: 'webhook' })).resolves.toBe('not_applicable');
    expect(deps.inspect).not.toHaveBeenCalled();
  });
});

describe('service RPC 응답 읽기', () => {
  it('열린 되돌림·닫기 결과의 모양을 검증한다', () => {
    expect(parseOpenDepositReversal({ ...reversal(), reviewCode: null })).toEqual(reversal());
    expect(parseOpenDepositReversal({ ...reversal(), state: 'closed' })).toBeNull();
    expect(parseOpenDepositReversal({ ...reversal(), sequence: 0 })).toBeNull();
    expect(parseOpenDepositReversal({ ...reversal(), paymentKey: 'has space' })).toBeNull();
    expect(parseDepositReversalCloseResult({ status: 'closed' })).toEqual({ status: 'closed' });
    expect(parseDepositReversalCloseResult({ status: 'cancellation_pending', requestId: 'r', requestStatus: 'needs_review', claimType: 'return' }))
      .toEqual({ status: 'cancellation_pending', requestId: 'r', requestStatus: 'needs_review', claimType: 'return' });
    expect(() => parseDepositReversalCloseResult({ status: 'cancellation_pending', requestId: 'r', requestStatus: 'processing' })).toThrow();
    expect(() => parseDepositReversalCloseResult({ status: 'cancellation_pending', requestId: 'r', requestStatus: 'requested' })).toThrow();
    expect(() => parseDepositReversalCloseResult(null)).toThrow();
  });
});

describe('취소 요청의 환불 단계(depositReversalRefundOutcome)', () => {
  const base = { attempt, paymentKey: 'ledger-key', amount: 31000, partial: false };

  it('반납·만료 증거가 남았으면 결제사를 다시 부르지 않고 결제 금액만큼 취소된 것으로 돌려준다(만료 계좌는 입금 전으로 남는다)', () => {
    for (const settled of ['closed', 'cancellation_pending'] as const) {
      expect(depositReversalRefundOutcome(settled, base)).toMatchObject({
        outcome: 'approved', refundedAmount: 31000, evidence: { providerPaymentKey: 'ledger-key' },
      });
    }
    // 반품배송비 차감(부분 환불)은 돈이 움직이지 않는 '부분 취소 불가'로 돌려 전액으로 돌린다.
    expect(depositReversalRefundOutcome('cancellation_pending', { ...base, partial: true }))
      .toMatchObject({ outcome: 'declined', reasonCode: 'provider_partial_cancel_unavailable' });
  });

  it('다시 입금됐거나 결제사가 이미 환불했으면 보통의 환불로 간다', () => {
    expect(depositReversalRefundOutcome('redeposited', base)).toBeNull();
    expect(depositReversalRefundOutcome('refunded', base)).toBeNull();
  });

  it('반납을 확인하지 못했으면 결제확인필요로 멈춘다(조회 불가는 결과 불명)', () => {
    expect(depositReversalRefundOutcome('waiting', base)).toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_deposit_reversed' });
    expect(depositReversalRefundOutcome('review', base)).toMatchObject({ outcome: 'needs_review', reasonCode: 'provider_deposit_reversed' });
    expect(depositReversalRefundOutcome('unavailable', base)).toMatchObject({ outcome: 'unknown', reasonCode: 'provider_deposit_reversed' });
  });
});


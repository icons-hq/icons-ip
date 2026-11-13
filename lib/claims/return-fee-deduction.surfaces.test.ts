import { describe, expect, it } from 'vitest';
import { parseBankRefundContext, type BankRefundContext } from '@/lib/admin/bank-transfer-refund';
import { adminClaimBulkRefundTotals, parseAdminClaimBulkContexts } from '@/lib/admin/claim-bulk';

/*
 * 반품배송비 차감(ADR-0031)이 운영 표면의 응답 경계에 더한 선택 필드. 차감 필드가 없으면 지금과 같은 결과이고,
 * 있으면 모양까지 맞아야 받는다.
 */

const ID = (n: number) => `c1200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-11-12T06:00:00.000Z';
const context: BankRefundContext = {
  actorId: ID(1), orderId: ID(2), claimId: ID(3), claimType: 'return', revision: 2, amount: 30000, stage: 'processing',
  phase: 'not_confirmed', gift: false, filedAt: at, confirmedAt: null, transferredAt: null, confirmationNotBefore: at, transferNotBefore: at,
  maskedAccount: 'TEST ********5678', maskedHolder: 'T*****', confirmBlocker: null, fileBlocker: 'bank_refund_already_filed',
  completeBlocker: 'bank_refund_confirmation_required', viewBlocker: 'bank_refund_confirmation_required',
};
const decision = {
  source: 'decision', state: 'planned', applicable: true, reason: null, oneWayAmount: 3000, basis: 'one_way', initialShippingFee: 3000,
  deductionAmount: 3000, paymentId: ID(4), provider: 'bank_transfer', paymentAmount: 30000, refundAmount: 27000, decidedAt: at, appliedAt: null,
};

describe('무통장 환불 문맥의 차감 필드', () => {
  it('없으면 지금 모양 그대로 받는다', () => {
    expect(parseBankRefundContext(context)).toEqual(context);
    expect(parseBankRefundContext(context)).not.toHaveProperty('refundDeduction');
  });

  it('있으면 송금액을 함께 싣고, 모양이 어긋나면 문맥 전체를 받지 않는다', () => {
    expect(parseBankRefundContext({ ...context, refundDeduction: decision })?.refundDeduction).toMatchObject({
      source: 'decision', refundAmount: 27000, deductionAmount: 3000,
    });
    expect(parseBankRefundContext({ ...context, refundDeduction: { ...decision, refundAmount: 28000 } })).toBeNull();
    expect(parseBankRefundContext({ ...context, refundDeduction: null })).toBeNull();
  });
});

describe('일괄 환불 확인창의 차감 필드', () => {
  const row = {
    claimId: ID(3), reference: 41, orderId: ID(2), claimType: 'return', stage: 'collected', heldFrom: null,
    collectionPolicy: 'legacy', collectionRequired: false, collectionComplete: true, collectedAt: at, collectionReceivedOn: null,
    collections: [], paymentProvider: 'toss', paymentStatus: 'paid', refundMethod: null, refundFiledAt: null, refundCompletedAt: null,
    refundAmount: 27000, refundBlocker: null,
  };

  it('차감 필드가 없으면 지금과 같다', () => {
    const [context] = parseAdminClaimBulkContexts([{ ...row, refundAmount: 30000 }]) ?? [];
    expect(context).not.toHaveProperty('refundDeductionAmount');
    expect(context?.refundAmount).toBe(30000);
  });

  it('차감하는 행은 차감액을 싣고, 합계는 서버가 뺀 환불 금액이다', () => {
    const [context] = parseAdminClaimBulkContexts([{ ...row, refundDeduction: { ...decision, source: 'plan', state: null } }]) ?? [];
    expect(context?.refundDeductionAmount).toBe(3000);
    expect(adminClaimBulkRefundTotals([
      { claimId: ID(3), reference: 'R-41', providerLabel: '토스', amount: 27000, deductionAmount: 3000, blocker: null },
      { claimId: ID(5), reference: 'R-42', providerLabel: '토스', amount: 30000, blocker: null },
    ])).toEqual({ count: 2, amount: 57000, byProvider: [{ label: '토스', count: 2, amount: 57000 }] });
  });

  it('차감하지 않는 판정(applicable=false)은 차감액을 싣지 않는다', () => {
    const [context] = parseAdminClaimBulkContexts([{ ...row, refundAmount: 30000, refundDeduction: { ...decision, applicable: false, reason: 'gift_order', refundAmount: 30000 } }]) ?? [];
    expect(context).not.toHaveProperty('refundDeductionAmount');
  });
});

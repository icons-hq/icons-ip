import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReturnFeeDeduction } from '@/lib/claims/return-fee-deduction';
import { ClaimActionPanel, claimRefundCompletionConfirmation, type ClaimActionPanelProps } from './ClaimActionPanel';

/*
 * 반품배송비 차감(ADR-0031). 단순 변심 반품의 환불 단계에 '반품배송비 3,000원 차감, 환불 27,000원'이 보이고, 결제사 버튼은
 * 부분 취소를 말한다. 판정·결정이 없으면(스위치 OFF·하자 반품) 패널은 지금과 한 글자도 같다.
 */

vi.mock('@/app/admin/claim-actions', () => ({
  decideOrderClaimAction: vi.fn(),
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  recordOrderClaimReshipmentAction: vi.fn(),
  planClaimDefectiveStockAction: vi.fn(),
  retryClaimDefectiveStockAction: vi.fn(),
}));

const CLAIM_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const plan: ReturnFeeDeduction = {
  source: 'plan',
  state: null,
  applicable: true,
  reason: null,
  oneWayAmount: 3000,
  basis: 'one_way',
  deductionAmount: 3000,
  paymentAmount: 30000,
  refundAmount: 27000,
  provider: 'toss',
};

function props(overrides: Partial<ClaimActionPanelProps> = {}): ClaimActionPanelProps {
  return {
    cancellationForm: null,
    carriers: [],
    claimId: CLAIM_ID,
    claimType: 'return',
    collectionComplete: true,
    collectionPolicy: 'legacy',
    collectedAt: '2026-11-12T00:00:00.000Z',
    collections: [],
    heldFrom: null,
    orderId: ORDER_ID,
    paymentProvider: 'toss',
    recordedRefundMethod: null,
    refundCompleted: false,
    refundFiled: false,
    refundLedgerOpen: false,
    stage: 'collected',
    refundAmount: 30000,
    ...overrides,
  };
}

const render = (overrides: Partial<ClaimActionPanelProps> = {}) => renderToStaticMarkup(<ClaimActionPanel {...props(overrides)} />);

describe('ClaimActionPanel — 반품배송비 차감', () => {
  it('판정·결정이 없으면(스위치 OFF) 지금과 같은 전액 취소 패널이다', () => {
    const off = render();
    expect(render({ refundDeduction: null })).toBe(off);
    expect(off).not.toContain('반품배송비');
    expect(off).not.toContain('data-claim-refund-deduction');
    expect(off).toContain('결제사 취소 (토스 전액 취소)');
    expect(off).toContain('토스 전액 취소는 아래 [환불 완료 확정]을 누를 때 발행됩니다.');
  });

  it('단순 변심 반품의 환불 단계에 차감액과 환불액을 보이고 결제사 부분 취소를 말한다', () => {
    const html = render({ refundDeduction: plan, refundAmount: 27000 });
    expect(html).toContain('반품배송비 3,000원 차감, 환불 27,000원');
    expect(html).toContain('결제 금액 30,000원에서 반품배송비(편도 3,000원)를 빼고 환불합니다.');
    expect(html).toContain('환불 접수를 기록할 때 이 금액으로 정해집니다.');
    expect(html).toContain('결제사 취소 (토스 부분 취소)');
    expect(html).toContain('토스 부분 취소는 아래 [환불 완료 확정]을 누를 때 발행됩니다.');
    expect(html).not.toContain('토스 전액 취소');
  });

  it('접수 뒤 완료 확정 버튼·경고·확인 문구가 부분 취소 금액을 말한다', () => {
    const decision: ReturnFeeDeduction = { ...plan, source: 'decision', state: 'planned' };
    const html = render({ refundDeduction: decision, refundAmount: 27000, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('환불 완료 확정 (토스 부분 취소)');
    expect(html).toContain('반품배송비 3,000원을 뺀 27,000원만 부분 취소하고 결제사 잔액을 조회로 확인합니다.');
    expect(html).toContain('₩27,000');
    expect(html).not.toContain('환불 접수를 기록할 때 이 금액으로 정해집니다.');
    expect(claimRefundCompletionConfirmation(true, '토스', { refundAmount: 27000, deductionAmount: 3000 }))
      .toBe('토스 결제에서 반품배송비 3,000원을 뺀 27,000원을 부분 취소하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.');
    expect(claimRefundCompletionConfirmation(true, '토스'))
      .toBe('토스 결제 전액을 취소하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.');
  });

  it('최초 무료배송은 왕복 근거를 보인다', () => {
    const html = render({ refundDeduction: { ...plan, basis: 'round_trip', deductionAmount: 6000, refundAmount: 24000 } });
    expect(html).toContain('반품배송비 6,000원 차감, 환불 24,000원');
    expect(html).toContain('최초 무료배송이라 왕복(편도 3,000원 × 2)');
  });

  it('부분 취소를 쓸 수 없는 결제는 차감 없이 전액 환불하고 배송비 청구를 안내한다', () => {
    const html = render({
      paymentProvider: 'nicepay',
      refundDeduction: { ...plan, applicable: false, reason: 'partial_cancel_unsupported', refundAmount: 30000, provider: 'nicepay' },
    });
    expect(html).toContain('data-claim-refund-deduction="skipped"');
    expect(html).toContain('이 결제는 결제사 부분 취소를 쓸 수 없어 차감하지 않고 결제 금액 전액을 환불합니다.');
    expect(html).toContain('반품배송비 3,000원(편도 3,000원)은 필요하면 배송비 청구로 따로 받으세요.');
    expect(html).toContain('나이스페이 전액 취소');
    expect(html).not.toContain('부분 취소)');
  });

  it('하자 반품·교환에는 차감 칸이 없다(판정이 오지 않는다)', () => {
    expect(render({ refundDeduction: null })).not.toContain('반품배송비');
    expect(render({ claimType: 'exchange', refundDeduction: plan, stage: 'collected' })).not.toContain('반품배송비 3,000원 차감');
  });

  it('종결된 요청에는 차감 안내를 다시 띄우지 않는다', () => {
    const html = render({
      refundDeduction: { ...plan, source: 'decision', state: 'applied' },
      stage: 'completed', refundLedgerOpen: true, refundFiled: true, refundCompleted: true,
    });
    expect(html).not.toContain('data-claim-refund-deduction');
  });
});

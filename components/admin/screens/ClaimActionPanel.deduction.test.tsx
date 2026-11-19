import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReturnFeeDeduction } from '@/lib/claims/return-fee-deduction';
import { ClaimActionPanel, claimRefundCompletionConfirmation, partialReturnBankFilingConfirmation, partialReturnFilingConfirmation, type ClaimActionPanelProps } from './ClaimActionPanel';

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
  planClaimDefectiveStockAction: vi.fn(), planExchangeDefectiveStockAction: vi.fn(),
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
    expect(off).toContain('토스 전액 취소는 아래 [환불 완료 확정]을 누를 때 요청됩니다.');
  });

  it('단순 변심 반품의 환불 단계에 차감액과 환불액을 보이고 결제사 부분 취소를 말한다', () => {
    const html = render({ refundDeduction: plan, refundAmount: 27000 });
    expect(html).toContain('반품배송비 3,000원 차감, 환불 27,000원');
    expect(html).toContain('결제 금액 30,000원에서 반품배송비(편도 3,000원)를 빼고 환불합니다.');
    expect(html).toContain('환불 접수를 기록할 때 이 금액으로 정해집니다.');
    expect(html).toContain('결제사 취소 (토스 부분 취소)');
    expect(html).toContain('토스 부분 취소는 아래 [환불 완료 확정]을 누를 때 요청됩니다.');
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

  it('이미 부분 취소한 주문의 환불 완료 확정은 남은 결제 금액을 말한다', () => {
    const html = render({ refundAmount: 30500, paidAmount: 37300, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('환불 완료 확정 (토스 남은 금액 취소)');
    expect(html).toContain('남은 결제 금액 30,500원을 취소하고');
    expect(html).not.toContain('결제 전액을 취소하고');
    expect(claimRefundCompletionConfirmation(true, '토스', null, 30500))
      .toBe('토스 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 30,500원을 취소하고 주문 취소·재고 복원·카드팩 회수를 확정할까요? 되돌릴 수 없습니다.');
    const full = render({ refundAmount: 37300, paidAmount: 37300, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(full).toContain('환불 완료 확정 (토스 전액 취소)');
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

describe('부분 반품 환불 단계(ADR-0047)', () => {
  it('부분 반품은 고른 굿즈 몫만 부분 취소한다고 말하고 주문 전체 취소 문구를 쓰지 않는다', () => {
    const html = render({ partialReturn: { refundAmount: 6500, deductionAmount: 3000 }, refundAmount: 30000, paidAmount: 40000, stage: 'processing',
      refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('환불 완료 확정 (토스 부분 취소)');
    expect(html).toContain('부분 반품한 상품 몫 6,500원만 부분 취소하고');
    expect(html).toContain('₩6,500');
    expect(html).not.toContain('결제 전액을 취소하고');
    expect(html).not.toContain('남은 결제 금액');
    expect(claimRefundCompletionConfirmation(true, '토스', null, null, { refundAmount: 6500, deductionAmount: 3000 }))
      .toBe('토스 결제에서 부분 반품한 상품 몫 6,500원(반품배송비 3,000원 차감)을 부분 취소하고, 고른 상품만 재고 복원·카드팩 판정을 확정할까요? 남은 상품과 주문은 그대로 남습니다. 되돌릴 수 없습니다.');
  });
});

describe('부분 반품 무통장·다시 접수(ADR-0047)', () => {
  it('무통장 부분 반품은 완료 확정 대신 송금 대기 안내를 보이고, 결제사가 받지 않아 확인 필요인 토스 부분 반품은 다시 접수할 수 있다', () => {
    const bank = render({ paymentProvider: 'bank_transfer', partialReturn: { refundAmount: 6500, deductionAmount: 3000, bank: true }, stage: 'processing',
      refundLedgerOpen: true, refundFiled: true });
    expect(bank).toContain('계좌 송금으로 돌려주는 부분 반품 환불은 송금 대기에 올라 있습니다');
    expect(bank).not.toContain('환불 완료 확정');
    const refile = render({ partialReturn: { refundAmount: 9500, deductionAmount: 0, refileable: true }, stage: 'needs_review', refundLedgerOpen: false, refundFiled: false });
    expect(refile).toContain('환불 접수 완료로 기록');
  });
});

describe('부분 반품 적대적 리뷰 반영(2026-11-19)', () => {
  it('무통장 부분 반품의 [환불 접수]는 재고 복원·송금 대기 적용이라 셸 확인창(data-confirm)을 거친다', () => {
    const html = render({ paymentProvider: 'bank_transfer', partialReturn: { refundAmount: 6500, deductionAmount: 3000, bank: true }, stage: 'collected' });
    expect(html).toContain('환불 접수 완료로 기록');
    expect(html).toContain(`data-confirm="${partialReturnBankFilingConfirmation({ refundAmount: 6500, deductionAmount: 3000 })}"`);
    expect(partialReturnBankFilingConfirmation({ refundAmount: 6500, deductionAmount: 3000 }))
      .toBe('부분 반품 환불 6,500원(반품배송비 3,000원 차감)을 접수할까요? 접수하면 고른 상품의 재고를 지금 처리하고(불량으로 고른 상품은 판매 재고 제외) 환불 송금 대기에 올립니다. 남은 상품과 주문은 그대로 남습니다. 되돌릴 수 없습니다.');
    const toss = render({ partialReturn: { refundAmount: 6500, deductionAmount: 3000 }, stage: 'collected' });
    expect(toss).toContain('환불 접수 완료로 기록');
    expect(toss).toContain(`data-confirm="${partialReturnFilingConfirmation({ refundAmount: 6500, deductionAmount: 3000 }, '토스')}"`);
  });

  it('부분 반품 칸을 읽지 못하면 환불 단계를 열지 않고 경고만 보인다 — 주문 전체 환불 문구를 그리지 않는다', () => {
    const html = render({ partialReturnUnavailable: true, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('부분 반품 정보를 읽지 못해 환불 단계를 열지 않았습니다');
    expect(html).not.toContain('환불 완료 확정');
    expect(html).not.toContain('환불 접수 완료로 기록');
    expect(html).not.toContain('결제 전액을 취소하고');
  });

  it('계좌 송금으로 바꿀 수 있는 부분 반품은 전환 전에 품목별 재고 처리(불량)를 저장할 수 있다', () => {
    const html = render({ partialReturn: { refundAmount: 9500, deductionAmount: 0, refileable: true, convertible: true }, stage: 'needs_review',
      defectiveStock: { claimId: CLAIM_ID, frozen: false, pending: 0,
        items: [{ orderItemId: '22222222-2222-4222-8222-222222222222', name: 'TEST 굿즈', variantName: null, qty: 1, defective: false, state: null }] } });
    expect(html).toContain('계좌 송금 부분 환불로 바꿀 때 고른 상품의 재고가 정해집니다');
  });
});

describe('부분 반품 접수의 재고 처리·확인(Codex 리뷰)', () => {
  const stock = { claimId: CLAIM_ID, frozen: false, pending: 0,
    items: [{ orderItemId: '22222222-2222-4222-8222-222222222222', name: 'TEST 상품', variantName: null, qty: 1, defective: false, state: null as null }] };

  it('0원 부분 반품의 [환불 접수]는 결제 수단과 무관하게 확인창을 거치고 재고 처리(불량 선택)를 같은 양식에 싣는다', () => {
    const html = render({ partialReturn: { refundAmount: 0, deductionAmount: 0 }, stage: 'collected', defectiveStock: stock });
    expect(html).toContain(`data-confirm="${partialReturnFilingConfirmation({ refundAmount: 0, deductionAmount: 0 }, '토스')}"`);
    expect(partialReturnFilingConfirmation({ refundAmount: 0, deductionAmount: 0 }, '토스')).toContain('불량으로 고른 상품은 판매 재고 제외');
    expect(html).toContain('claim-refund-file-stock');
    expect(html).toContain('돌려줄 결제 금액이 0원');
  });

  it('토스 부분 반품의 [환불 접수]도 금액이 고정된다고 확인받고, 재고 처리를 함께 저장할 수 있다', () => {
    expect(partialReturnFilingConfirmation({ refundAmount: 6500, deductionAmount: 0 }, '토스'))
      .toBe('부분 반품 환불 6,500원을 접수할까요? 접수하면 금액이 고정되고 바뀌지 않습니다. 토스 부분 취소는 [환불 완료 확정]을 누를 때 요청됩니다. 되돌릴 수 없습니다.');
    const html = render({ partialReturn: { refundAmount: 6500, deductionAmount: 0 }, stage: 'collected', defectiveStock: stock });
    expect(html).toContain('claim-refund-file-stock');
  });

  it('주문 전체 반품의 [환불 접수]는 지금 그대로다(확인창·재고 선택 없음)', () => {
    const html = render({ stage: 'collected', defectiveStock: stock });
    expect(html).not.toContain('claim-refund-file-stock');
    expect(html).not.toContain('data-confirm="부분 반품');
  });
});


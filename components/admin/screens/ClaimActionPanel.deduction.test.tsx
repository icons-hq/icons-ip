import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReturnFeeDeduction } from '@/lib/claims/return-fee-deduction';
import { ClaimActionPanel, claimRefundCompletionConfirm, claimRefundFilingConfirm, partialReturnBankFilingConfirmation, partialReturnFilingConfirmation, type ClaimActionPanelProps } from './ClaimActionPanel';

/*
 * 반품배송비 차감(ADR-0031). 단순 변심 반품의 환불 단계에 '반품배송비 3,000원 차감, 환불 27,000원'이 보이고, 결제사 버튼은
 * 부분 취소를 말한다. 판정·결정이 없으면(스위치 OFF·하자 반품) 패널은 지금과 한 글자도 같다.
 */

vi.mock('@/app/admin/claim-actions', () => ({
  decideOrderClaimAction: vi.fn(),
  recordOrderClaimCollectionAction: vi.fn(),
  recordOrderClaimOriginCollectionAction: vi.fn(),
  recordOrderClaimRefundAction: vi.fn(),
  readOrderClaimApprovalAmountAction: vi.fn(),
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
    /* 접수 단계(확정 버튼이 아직 잠겨 있음)에서는 차감 안내가 부분 취소가 안 될 때의 일을 미리 말한다. */
    expect(html).toContain('결제사가 이 결제의 부분 취소를 받지 않으면 전액 환불하고, 반품배송비는 배송비 청구로 따로 받습니다.');
    expect(html).not.toContain('토스 전액 취소');
  });

  it('접수 뒤 완료 확정 버튼·경고·확인 문구가 부분 취소 금액을 말한다', () => {
    const decision: ReturnFeeDeduction = { ...plan, source: 'decision', state: 'planned' };
    const html = render({ refundDeduction: decision, refundAmount: 27000, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('환불 완료 확정 (토스 부분 취소)');
    expect(html).toContain('반품배송비 3,000원을 뺀 27,000원을 부분 취소하고, 결제사에 남은 결제 금액을 조회해 취소됐는지 확인합니다.');
    /* A-1: 버튼 바로 위 경고도 부분 취소가 안 되면 전액(30,000원)이 취소된다고 말한다. 위쪽 차감 안내는 같은 말을 되풀이하지 않는다. */
    expect(html).toContain('결제사가 이 결제의 부분 취소를 받지 않으면 전액 30,000원을 취소하고, 반품배송비는 배송비 청구로 따로 받아야 합니다.');
    expect(html).not.toContain('27,000원만 부분 취소');
    expect(html).not.toContain('부분 취소로 환불액만 취소합니다');
    expect(html).toContain('₩27,000');
    expect(html).not.toContain('환불 접수를 기록할 때 이 금액으로 정해집니다.');
    expect(claimRefundCompletionConfirm({ finalizationPending: true, autoCancelLabel: '토스' }).message)
      .toBe('토스 결제 전액을 취소하고 주문 취소·재고 복원을 확정합니다.\n되돌릴 수 없습니다.');
  });

  /*
   * A-1: 결제사가 이 결제의 부분 취소를 받지 않으면 시스템은 다시 묻지 않고 전액을 취소한다(cancellation-orchestrator의 전액 환불 전환).
   * 확인창이 27,000원만 말하고 끝나면 운영자는 30,000원이 나갈 수 있다는 것을 모른 채 누른다 — 그 경우와 금액을 확인창이 말한다.
   */
  it('차감 반품의 환불 완료 확정 확인창은 부분 취소가 안 되면 전액이 취소된다는 것과 그 금액을 말한다', () => {
    const decision: ReturnFeeDeduction = { ...plan, source: 'decision', state: 'planned' };
    const confirm = claimRefundCompletionConfirm({
      finalizationPending: true, autoCancelLabel: '토스', amount: 27000,
      partialRefund: { refundAmount: 27000, deductionAmount: 3000, paymentAmount: 30000 },
      target: { claimReference: 'C00012', orderReference: '20261126-000123', buyerName: '홍길동' },
    });
    expect(confirm).toEqual({
      title: 'C00012 환불 완료 확정',
      /* 금액이 달라질 수 있어 확인 버튼에 금액을 못박지 않는다. */
      confirmLabel: '환불 확정',
      destructive: true,
      message: [
        '주문 20261126-000123 · 구매자 홍길동',
        '토스 결제에서 반품배송비 3,000원을 뺀 27,000원을 부분 취소하고 주문 취소·재고 복원을 확정합니다.',
        '결제사가 이 결제의 부분 취소를 받지 않으면 다시 묻지 않고 전액 30,000원을 취소합니다. 그때는 반품배송비 3,000원을 배송비 청구로 따로 받아야 합니다.',
        '되돌릴 수 없습니다.',
      ].join('\n'),
    });
    /* 화면의 확인창도 차감 결정의 결제 금액(30,000원)을 전액으로 말한다. */
    const html = render({ refundDeduction: decision, refundAmount: 27000, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    const form = html.match(/<form[^>]*data-confirm="[^"]*"[^>]*>/)?.[0] ?? '';
    expect(form).toContain('반품배송비 3,000원을 뺀 27,000원을 부분 취소하고');
    expect(form).toContain('부분 취소를 받지 않으면 다시 묻지 않고 전액 30,000원을 취소합니다.');
    expect(form).toContain('data-confirm-label="환불 확정"');
    expect(form).not.toContain('data-confirm-label="27,000원');
  });

  it('이미 부분 취소한 주문의 환불 완료 확정은 남은 결제 금액을 말한다', () => {
    const html = render({ refundAmount: 30500, paidAmount: 37300, stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(html).toContain('환불 완료 확정 (토스 남은 금액 취소)');
    expect(html).toContain('남은 결제 금액 30,500원을 취소하고');
    expect(html).not.toContain('결제 전액을 취소하고');
    const remainder = claimRefundCompletionConfirm({ finalizationPending: true, autoCancelLabel: '토스', amount: 30500, remainderAmount: 30500 });
    expect(remainder.message)
      .toBe('토스 결제에서 이미 취소한 금액을 뺀 남은 결제 금액 30,500원을 취소하고 주문 취소·재고 복원을 확정합니다.\n되돌릴 수 없습니다.');
    expect(remainder.confirmLabel).toBe('30,500원 취소');
    expect(html).toContain('data-confirm-label="30,500원 취소"');
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
    const partial = claimRefundCompletionConfirm({ finalizationPending: true, autoCancelLabel: '토스', partialReturn: { refundAmount: 6500, deductionAmount: 3000 } });
    expect(partial.message).toBe([
      '토스 결제에서 부분 반품한 상품 몫 6,500원(반품배송비 3,000원 차감)을 부분 취소하고, 고른 상품의 재고를 되돌립니다. 남은 상품과 주문은 그대로 남습니다.',
      /* 부분 반품은 차감 반품과 달리 전액 환불로 돌리지 않는다 — 확인창도 그렇게 말한다. */
      '결제사가 부분 취소를 받지 않으면 전액 환불로 돌리지 않고 확인 필요로 남습니다.',
      '되돌릴 수 없습니다.',
    ].join('\n'));
    expect(partial.confirmLabel).toBe('6,500원 부분 취소');
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
    expect(html).toContain('계좌 송금 부분 환불로 전환하면 고른 상품의 재고를 바로 처리합니다');
  });
});

describe('부분 반품 접수의 재고 처리·확인(Codex 리뷰)', () => {
  const stock = { claimId: CLAIM_ID, frozen: false, pending: 0,
    items: [{ orderItemId: '22222222-2222-4222-8222-222222222222', name: 'TEST 상품', variantName: null, qty: 1, defective: false, state: null as null }] };

  it('0원 부분 반품의 [환불 접수]는 결제 수단과 무관하게 확인창을 거치고 재고 처리(불량 선택)를 같은 양식에 싣는다', () => {
    const html = render({ partialReturn: { refundAmount: 0, deductionAmount: 0 }, stage: 'collected', defectiveStock: stock });
    expect(html).toContain(`data-confirm="${partialReturnFilingConfirmation({ refundAmount: 0, deductionAmount: 0 }, '토스')}"`);
    expect(partialReturnFilingConfirmation({ refundAmount: 0, deductionAmount: 0 }, '토스')).toContain('불량으로 고른 상품은 판매 재고에 넣지 않음');
    expect(html).toContain('claim-refund-file-stock');
    expect(html).toContain('돌려줄 결제 금액이 0원');
  });

  it('토스 부분 반품의 [환불 접수]도 금액이 고정된다고 확인받고, 재고 처리를 함께 저장할 수 있다', () => {
    expect(partialReturnFilingConfirmation({ refundAmount: 6500, deductionAmount: 0 }, '토스'))
      .toBe('부분 반품 환불 6,500원을 접수할까요? 접수하면 금액이 고정되고 바뀌지 않습니다. 토스 부분 취소는 [환불 완료 확정]을 누를 때 요청됩니다. 되돌릴 수 없습니다.');
    const html = render({ partialReturn: { refundAmount: 6500, deductionAmount: 0 }, stage: 'collected', defectiveStock: stock });
    expect(html).toContain('claim-refund-file-stock');
  });

  /* D-02: 입고완료 단계의 첫 접수는 처리중으로 넘어가 거부할 수 없게 되고, 차감액이 이때 정해진다 — 한 번 묻는다. 재고 선택은 없다. */
  it('주문 전체 반품의 첫 [환불 접수]는 거부할 수 없게 된다는 것을 확인받고, 접수 전에는 확정 버튼이 잠겨 있다', () => {
    const html = render({ stage: 'collected', defectiveStock: stock, claimReference: 'C00012' });
    expect(html).not.toContain('claim-refund-file-stock');
    expect(html).not.toContain('data-confirm="부분 반품');
    const form = html.match(/<form[^>]*data-confirm="[^"]*"[^>]*>/)?.[0] ?? '';
    expect(form).toContain('data-confirm="환불 접수를 기록합니다.\n접수한 뒤에는 이 요청을 거부할 수 없습니다.\n돈은 아직 나가지 않습니다. 토스 전액 취소는 접수한 뒤 [환불 완료 확정]을 눌러야 요청됩니다."');
    expect(form).toContain('data-confirm-title="C00012 환불 접수"');
    expect(form).not.toContain('data-confirm-tone');
    /* D-07: 다음 단계의 버튼을 잠근 채 보여 접수와 확정이 다른 버튼이라는 것이 화면에서 드러난다. */
    const locked = html.slice(html.indexOf('data-claim-refund-locked'));
    expect(locked).toMatch(/^data-claim-refund-locked=""[^>]*><button[^>]*disabled=""[^>]*>환불 완료 확정 \(토스 전액 취소\)<\/button>/);
    expect(locked).toContain('환불 접수를 기록하면 누를 수 있습니다.');

    /* 차감 판정이 있으면 접수로 정해지는 금액을 말한다. */
    expect(claimRefundFilingConfirm({ autoCancelLabel: '토스', cancelScope: '부분 취소', deduction: { refundAmount: 27000, deductionAmount: 3000 } }).message)
      .toBe('반품배송비 3,000원을 뺀 27,000원으로 환불을 접수합니다. 접수하면 이 금액으로 정해집니다.\n접수한 뒤에는 이 요청을 거부할 수 없습니다.\n돈은 아직 나가지 않습니다. 토스 부분 취소는 접수한 뒤 [환불 완료 확정]을 눌러야 요청됩니다.');
    expect(render({ stage: 'collected', refundDeduction: plan, refundAmount: 27000 })).toContain('반품배송비 3,000원을 뺀 27,000원으로 환불을 접수합니다.');

    /* 이미 처리중인 요청의 접수 정보 갱신은 다시 할 수 있어 묻지 않고, 확정 버튼이 열려 있어 잠근 버튼도 없다. */
    const filed = render({ stage: 'processing', refundLedgerOpen: true, refundFiled: true });
    expect(filed).toContain('환불 접수 정보 갱신');
    expect(filed).not.toContain('data-claim-refund-locked');
    expect(filed).not.toContain('접수한 뒤에는 이 요청을 거부할 수 없습니다.');
  });
});


import { describe, expect, it } from 'vitest';
import type { OrderDetail, OrderPaymentSummary } from '../orders';
import { BUSINESS_INFO, type BusinessInfo } from '../legal/business-info';
import { transactionDisplay, transactionLineId } from '@/test/fixtures/cart-transaction';
import type { GoodsTransactionDisplay } from '../goods-transaction';
import {
  STATEMENT_CANCELED_MESSAGE,
  STATEMENT_NOTICE_CARD_RECEIPT,
  STATEMENT_NOTICE_SCOPE,
  STATEMENT_NOTICE_VAT,
  STATEMENT_NO_OPTION,
  STATEMENT_PENDING_MESSAGE,
  buildOrderStatement,
  statementUnavailableMessage,
  type StatementTotalRow,
} from './statement';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const ISSUED_AT = new Date('2026-11-17T14:30:00.000Z'); // KST 2026-11-17 23:30

/** `OrderPaymentSummary`에 provider를 더한 결제(공급 provider는 A1이 타입에 더하는 값이라 여기서는 합쳐서 넘긴다). */
function payment(provider: string | null): OrderPaymentSummary {
  return { amount: 30000, status: 'paid', createdAt: '2026-08-01T06:01:00.000Z', ...(provider ? { provider } : {}) } as OrderPaymentSummary;
}

function order(overrides: Partial<OrderDetail> = {}): OrderDetail {
  return {
    id: ORDER_ID,
    orderNumber: '20261117140510000001',
    status: 'paid',
    total: 30000,
    shippingFee: 3000,
    discountTotal: 0,
    storeCreditTotal: 0,
    paymentMethod: 'card',
    expiresAt: null,
    address: null,
    createdAt: '2026-11-17T05:05:00.000Z', // KST 14:05
    deliveredAt: null,
    items: [{ id: 'item-1', variantId: '00000000-0000-4000-8000-000000000001', variantName: '파랑', goodId: 'g13', name: '홍실 아크릴 블록', qty: 1, unitPrice: 27000 }],
    payment: payment('toss'),
    refund: null,
    cancellationRequest: null,
    claimEligibility: { cancel: false, return: false, exchange: false },
    shipments: [],
    ...overrides,
  };
}

function v2Order(display: GoodsTransactionDisplay = transactionDisplay, overrides: Partial<OrderDetail> = {}): OrderDetail {
  return order({
    transaction: display,
    total: display.totals.onlineTotal,
    shippingFee: display.totals.prepaidShippingTotal,
    discountTotal: display.totals.couponDiscountTotal,
    storeCreditTotal: display.totals.storeCreditTotal,
    items: [{ id: transactionLineId, variantId: display.lines[0].variantId, variantName: '기본 옵션', goodId: display.lines[0].goodId, name: '트랜잭션 상품', qty: 2, unitPrice: 9000 }],
    ...overrides,
  });
}

function build(value: OrderDetail, extra: { partial?: number[]; business?: BusinessInfo; orderer?: { name: string; email: string | null }; paymentLabel?: string } = {}) {
  return buildOrderStatement({
    order: value,
    partialCancellations: (extra.partial ?? []).map((refundAmount) => ({ refundAmount })),
    business: extra.business ?? BUSINESS_INFO,
    orderer: extra.orderer ?? { name: '홍길동', email: 'hong@example.test' },
    paymentLabel: extra.paymentLabel ?? '신용·체크카드 (4330****)',
    issuedAt: ISSUED_AT,
  });
}

const amountOf = (totals: StatementTotalRow[], key: StatementTotalRow['key']) => totals.find((row) => row.key === key)?.amount;
const keysOf = (totals: StatementTotalRow[]) => totals.map((row) => row.key);

describe('statementUnavailableMessage', () => {
  it('결제가 끝난 주문 상태는 안내가 없다', () => {
    for (const status of ['paid', 'confirmed', 'shipping', 'delivered', 'done'] as const) expect(statementUnavailableMessage(status), status).toBeNull();
  });

  it('결제 전은 결제 완료 안내, 취소는 취소 안내다', () => {
    expect(statementUnavailableMessage('pending')).toBe(STATEMENT_PENDING_MESSAGE);
    expect(statementUnavailableMessage('canceled')).toBe(STATEMENT_CANCELED_MESSAGE);
    expect(STATEMENT_PENDING_MESSAGE).toBe('결제가 완료된 주문만 거래명세서를 발급해요.');
    expect(STATEMENT_CANCELED_MESSAGE).toBe('취소된 주문은 거래명세서를 발급하지 않아요.');
  });
});

describe('buildOrderStatement 머리·공급자·공급받는자', () => {
  it('발행일은 KST 날짜, 거래일시는 주문일시, 주문번호·결제수단을 싣는다', () => {
    const model = build(order());
    expect(model.issuedOn).toBe('2026년 11월 17일');
    expect(model.tradedAt).toBe('2026. 11. 17. 14:05');
    expect(model.orderNumber).toBe('20261117140510000001');
    expect(model.paymentLabel).toBe('신용·체크카드 (4330****)');
    expect(model.orderId).toBe(ORDER_ID);
  });

  it('발행일은 UTC 자정 직전이라도 KST 기준 날짜다', () => {
    const model = buildOrderStatement({ ...{ order: order(), partialCancellations: [], business: BUSINESS_INFO, orderer: { name: 'a', email: null }, paymentLabel: 'x' }, issuedAt: new Date('2026-12-31T15:00:00.000Z') });
    expect(model.issuedOn).toBe('2027년 1월 1일');
  });

  it('공급자는 상호·대표자·사업자등록번호·통신판매업 신고번호·주소·전화·이메일만(호스팅 제외), 빈 값 행은 뺀다', () => {
    const full = build(order());
    expect(full.supplier.map((row) => row.label)).toEqual(['상호', '대표자', '사업자등록번호', '통신판매업 신고번호', '사업장 주소', '전화', '이메일']);
    const sparse = build(order(), { business: { ...BUSINESS_INFO, representative: '', mailOrderNumber: '  ', phone: '' } });
    expect(sparse.supplier.map((row) => row.label)).toEqual(['상호', '사업자등록번호', '사업장 주소', '이메일']);
    expect(sparse.supplier.every((row) => row.value.length > 0)).toBe(true);
  });

  it('공급받는자는 주문자 이름과 이메일(없으면 이메일 행 생략)이다', () => {
    expect(build(order()).buyer).toEqual([{ label: '주문자', value: '홍길동' }, { label: '이메일', value: 'hong@example.test' }]);
    expect(build(order(), { orderer: { name: '회원', email: null } }).buyer).toEqual([{ label: '주문자', value: '회원' }]);
  });
});

describe('buildOrderStatement 품목', () => {
  it('v1 주문은 주문 품목의 단가·주문 당시 수량·옵션명으로 줄을 만든다', () => {
    const model = build(order({ items: [
      { id: 'a', variantId: 'v', variantName: '파랑', goodId: 'g1', name: '상품 A', qty: 3, unitPrice: 5000 },
      { id: 'b', variantId: 'v', variantName: null, goodId: 'g2', name: '상품 B', qty: 1, unitPrice: 12000 },
    ] }));
    expect(model.items).toEqual([
      { key: 'a', name: '상품 A', option: '파랑', qty: 3, unitPrice: 5000, amount: 15000 },
      { key: 'b', name: '상품 B', option: STATEMENT_NO_OPTION, qty: 1, unitPrice: 12000, amount: 12000 },
    ]);
  });

  it('옵션 없음·공백·기본 옵션은 —, 랜덤 판매의 서버 표기 랜덤은 그대로 보인다', () => {
    const items = (['', '   ', '기본 옵션', '랜덤'] as const).map((variantName, index) => ({ id: `i${index}`, variantId: 'v', variantName, goodId: `g${index}`, name: `상품 ${index}`, type: 't', qty: 1, unitPrice: 1000 }));
    expect(build(order({ items })).items.map((row) => row.option)).toEqual(['—', '—', '—', '랜덤']);
  });

  it('v2 주문은 서버 영수증 줄(lineId = 품목 id)의 단가를 쓰고, 행 금액 합이 상품 합계와 같다', () => {
    const model = build(v2Order());
    expect(model.items).toEqual([{ key: transactionLineId, name: '트랜잭션 상품', option: STATEMENT_NO_OPTION, qty: 2, unitPrice: 10000, amount: 20000 }]);
    expect(model.items.reduce((sum, row) => sum + row.amount, 0)).toBe(transactionDisplay.totals.subtotal);
    expect(amountOf(model.totals, 'goods')).toBe(transactionDisplay.totals.subtotal);
  });

  it('v2에서 영수증 줄과 매칭이 안 되면 품목 단가를 쓰고, 상품 합계는 서버 영수증 합계를 그대로 둔다', () => {
    const value = v2Order(transactionDisplay, { items: [{ id: 'unmatched', variantId: 'v', variantName: null, goodId: 'g', name: '상품', qty: 2, unitPrice: 9000 }] });
    const model = build(value);
    expect(model.items[0]).toMatchObject({ unitPrice: 9000, amount: 18000 });
    expect(amountOf(model.totals, 'goods')).toBe(transactionDisplay.totals.subtotal);
  });
});

describe('buildOrderStatement 합계 표', () => {
  it('v1: 상품 금액을 되돌려 복원하고 쿠폰·적립금·배송비·총 결제 금액을 낸다(0원 할인 행은 생략)', () => {
    const model = build(order({ total: 25000, shippingFee: 3000, discountTotal: 3000, storeCreditTotal: 2000 }));
    expect(model.totals).toEqual([
      { key: 'goods', label: '상품 합계', amount: 27000, kind: 'plain' },
      { key: 'coupon', label: '쿠폰 할인', amount: 3000, kind: 'deduction' },
      { key: 'credit', label: '적립금 사용', amount: 2000, kind: 'deduction' },
      { key: 'shipping', label: '배송비', amount: 3000, kind: 'plain' },
      { key: 'total', label: '총 결제 금액', amount: 25000, kind: 'total' },
    ]);
    expect(model.collectNotice).toBeNull();
  });

  it('쿠폰·적립금이 0이면 그 행이 없고 배송비 행은 0원이어도 남는다', () => {
    const model = build(order({ total: 27000, shippingFee: 0, discountTotal: 0, storeCreditTotal: 0 }));
    expect(keysOf(model.totals)).toEqual(['goods', 'shipping', 'total']);
    expect(amountOf(model.totals, 'shipping')).toBe(0);
  });

  it('v2: 복수구매·쿠폰·적립금을 차감 행으로, 선결제 배송비를 더해 온라인 결제금액에 맞는다', () => {
    const model = build(v2Order());
    expect(model.totals).toEqual([
      { key: 'goods', label: '상품 합계', amount: 20000, kind: 'plain' },
      { key: 'volume', label: '복수구매 할인', amount: 2000, kind: 'deduction' },
      { key: 'coupon', label: '쿠폰 할인', amount: 1000, kind: 'deduction' },
      { key: 'credit', label: '적립금 사용', amount: 1000, kind: 'deduction' },
      { key: 'shipping', label: '배송비', amount: 0, kind: 'plain' },
      { key: 'total', label: '총 결제 금액', amount: 16000, kind: 'total' },
    ]);
  });

  it('v2: 줄이 서로 맞는다(상품 합계 − 차감 + 배송비 = 총 결제 금액)', () => {
    const display: GoodsTransactionDisplay = {
      ...transactionDisplay,
      totals: { ...transactionDisplay.totals, prepaidShippingTotal: 2500, shippingCouponDiscountTotal: 500, collectShippingTotal: 0, onlineTotal: 18500, customerTotal: 18500 },
    };
    const model = build(v2Order(display));
    const get = (key: StatementTotalRow['key']) => amountOf(model.totals, key) ?? 0;
    /* 배송비 쿠폰은 쿠폰 할인에 합치고 배송비는 쿠폰 차감 전 금액이다 — 표의 산술이 총액과 맞는다. */
    expect(get('coupon')).toBe(1000 + 500);
    expect(get('shipping')).toBe(2500 + 500);
    expect(get('goods') - get('volume') - get('coupon') - get('credit') + get('shipping')).toBe(get('total'));
    expect(get('total')).toBe(display.totals.onlineTotal);
  });

  it('설치비가 있으면 배송비 행 이름이 `배송·설치비`이고 금액·합계 산술은 그대로다', () => {
    /* 배송비 3,000 + 설치비 20,000 = 선결제 23,000. 굿즈 20,000 → 총 결제 43,000. */
    const [group] = transactionDisplay.shipping;
    const display: GoodsTransactionDisplay = {
      ...transactionDisplay,
      totals: { subtotal: 20000, volumeDiscountTotal: 0, netGoodsTotal: 20000, couponDiscountTotal: 0, storeCreditTotal: 0, prepaidShippingTotal: 23000, collectShippingTotal: 0, onlineTotal: 43000, customerTotal: 43000 },
      shipping: [{ ...group, components: group.components.map((component, index) => (index === 0 ? { ...component, paymentMode: 'prepaid' as const, baseFee: 3000, regionalFee: 0, totalFee: 23000, installationFee: 20000 } : component)) }],
    };
    const model = build(v2Order(display));
    expect(model.totals.find((row) => row.key === 'shipping')).toEqual({ key: 'shipping', label: '배송·설치비', amount: 23000, kind: 'plain' });
    const get = (key: StatementTotalRow['key']) => amountOf(model.totals, key) ?? 0;
    expect(get('goods') - get('volume') - get('coupon') - get('credit') + get('shipping')).toBe(get('total'));
    /* 설치비가 없으면(0 포함) 그대로 `배송비`다. */
    for (const installationFee of [undefined, 0]) {
      const plain: GoodsTransactionDisplay = { ...display, shipping: [{ ...group, components: group.components.map((component) => ({ ...component, installationFee })) }] };
      expect(build(v2Order(plain)).totals.find((row) => row.key === 'shipping')?.label).toBe('배송비');
    }
    /* v1 주문(영수증 없음)에는 설치비가 없다. */
    expect(build(order({ total: 25000, shippingFee: 3000, discountTotal: 3000, storeCreditTotal: 2000 })).totals.find((row) => row.key === 'shipping')?.label).toBe('배송비');
  });

  it('v2: 복수구매·쿠폰·적립금이 모두 0이면 해당 행이 없다', () => {
    const display: GoodsTransactionDisplay = {
      ...transactionDisplay,
      totals: { subtotal: 20000, volumeDiscountTotal: 0, netGoodsTotal: 20000, couponDiscountTotal: 0, storeCreditTotal: 0, prepaidShippingTotal: 3000, collectShippingTotal: 0, onlineTotal: 23000, customerTotal: 23000 },
    };
    expect(keysOf(build(v2Order(display)).totals)).toEqual(['goods', 'shipping', 'total']);
  });

  it('착불 배송비가 있으면 받을 때 따로 결제한다는 한 줄을 낸다(총 결제 금액에는 넣지 않는다)', () => {
    const model = build(v2Order());
    expect(model.collectNotice).toBe('착불 배송비 ₩3,000은 받을 때 따로 결제해요.');
    expect(amountOf(model.totals, 'total')).toBe(16000);
    const none = build(v2Order({ ...transactionDisplay, totals: { ...transactionDisplay.totals, collectShippingTotal: 0, customerTotal: 16000 } }));
    expect(none.collectNotice).toBeNull();
  });

  it('부분 취소가 있으면 환불 합계를 빼고 최종 결제 금액을 더한다', () => {
    const model = build(order({ total: 30000 }), { partial: [3000, 2000] });
    expect(model.totals.slice(-3)).toEqual([
      { key: 'total', label: '총 결제 금액', amount: 30000, kind: 'total' },
      { key: 'partial_refund', label: '부분 취소 환불', amount: 5000, kind: 'deduction' },
      { key: 'final', label: '최종 결제 금액', amount: 25000, kind: 'total' },
    ]);
  });

  it('부분 취소가 없으면 환불·최종 행이 없고, 환불이 결제액을 넘어도 최종은 0 아래로 내려가지 않는다', () => {
    expect(keysOf(build(order()).totals)).not.toContain('partial_refund');
    expect(keysOf(build(order()).totals)).not.toContain('final');
    expect(amountOf(build(order({ total: 1000 }), { partial: [5000] }).totals, 'final')).toBe(0);
  });
});

describe('buildOrderStatement 안내 문장', () => {
  it('부가세 포함·세금계산서 대체 아님 두 문장은 항상 있다', () => {
    expect(STATEMENT_NOTICE_VAT).toBe('모든 금액은 부가가치세가 포함된 금액입니다.');
    expect(STATEMENT_NOTICE_SCOPE).toBe('이 거래명세서는 거래 내용 확인용이며 세금계산서·현금영수증을 대신하지 않습니다.');
    expect(build(order({ paymentMethod: 'bank_transfer', payment: payment('bank_transfer') })).notices).toEqual([STATEMENT_NOTICE_VAT, STATEMENT_NOTICE_SCOPE]);
  });

  it('주문 상세에 결제 영수증 버튼이 있는 결제(토스 카드)면 카드 매출전표 안내를 더한다', () => {
    expect(build(order()).notices).toEqual([STATEMENT_NOTICE_VAT, STATEMENT_NOTICE_SCOPE, STATEMENT_NOTICE_CARD_RECEIPT]);
    expect(STATEMENT_NOTICE_CARD_RECEIPT).toBe('카드 매출전표는 주문 상세의 ‘결제 영수증’에서 확인할 수 있어요.');
  });

  it('영수증 버튼이 없는 결제(다른 provider·결제 없음)에는 매출전표 안내를 하지 않는다', () => {
    for (const value of [order({ payment: payment('nicepay') }), order({ payment: payment('korpay') }), order({ payment: null })]) {
      expect(build(value).notices).not.toContain(STATEMENT_NOTICE_CARD_RECEIPT);
    }
  });
});

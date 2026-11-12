import { describe, expect, it } from 'vitest';
import { ORDER_CLAIM_INTAKE_NOTICES, orderClaimIntakeNotice } from '@/lib/orders/claims';
import {
  myOrderRefundDeductionCopy,
  parseMyOrderRefundDeduction,
  parseReturnFeeDeduction,
  parseReturnFeeDeductionPolicy,
  returnFeeDeductionHeadline,
  returnFeeDeductionRowNote,
  returnFeeDeductionSkippedNotice,
} from './return-fee-deduction';

const planDocument = {
  source: 'plan', state: null, applicable: true, reason: null, oneWayAmount: 3000, basis: 'one_way',
  initialShippingFee: 3000, deductionAmount: 3000, paymentId: 'p', provider: 'toss', paymentAmount: 30000, refundAmount: 27000,
};

describe('parseReturnFeeDeduction', () => {
  it('DB 판정·결정 문서를 좁힌다', () => {
    expect(parseReturnFeeDeduction(planDocument)).toEqual({
      source: 'plan', state: null, applicable: true, reason: null, oneWayAmount: 3000, basis: 'one_way',
      deductionAmount: 3000, paymentAmount: 30000, refundAmount: 27000, provider: 'toss',
    });
    expect(parseReturnFeeDeduction({ ...planDocument, source: 'decision', state: 'planned' })?.state).toBe('planned');
    expect(parseReturnFeeDeduction({ ...planDocument, applicable: false, reason: 'gift_order', refundAmount: 30000 })?.reason).toBe('gift_order');
  });

  it('없거나 모양·금액이 어긋나면 null — 지어낸 금액을 보이지 않는다', () => {
    expect(parseReturnFeeDeduction(undefined)).toBeNull();
    expect(parseReturnFeeDeduction(null)).toBeNull();
    expect(parseReturnFeeDeduction({ ...planDocument, refundAmount: 28000 })).toBeNull();
    expect(parseReturnFeeDeduction({ ...planDocument, source: 'decision', state: null })).toBeNull();
    expect(parseReturnFeeDeduction({ ...planDocument, applicable: false, reason: 'unknown' })).toBeNull();
    expect(parseReturnFeeDeduction({ ...planDocument, basis: 'free' })).toBeNull();
  });
});

describe('문구', () => {
  it('운영 머리 문구는 완료 기준 그대로다', () => {
    expect(returnFeeDeductionHeadline(parseReturnFeeDeduction(planDocument))).toBe('반품배송비 3,000원 차감, 환불 27,000원');
    expect(returnFeeDeductionHeadline(null)).toBeNull();
    expect(returnFeeDeductionRowNote(3000)).toBe('반품배송비 3,000원 차감');
    expect(returnFeeDeductionRowNote(null)).toBeNull();
  });

  it('차감하지 않는 이유와 배송비 청구 안내', () => {
    const skipped = parseReturnFeeDeduction({ ...planDocument, applicable: false, reason: 'fee_exceeds_payment', refundAmount: 30000 });
    expect(returnFeeDeductionSkippedNotice(skipped)).toBe('반품배송비가 결제 금액 이상이라 차감하지 않고 결제 금액 전액을 환불합니다. 반품배송비 3,000원(편도 3,000원)는 필요하면 배송비 청구로 따로 받으세요.');
    const invoiced = parseReturnFeeDeduction({ ...planDocument, applicable: false, reason: 'claim_fee_invoiced', refundAmount: 30000 });
    expect(returnFeeDeductionSkippedNotice(invoiced)).toBe('이 요청에 배송비 청구가 이미 있어 환불금에서 다시 차감하지 않습니다.');
    expect(returnFeeDeductionSkippedNotice(parseReturnFeeDeduction(planDocument))).toBeNull();
  });

  it('구매자 주문 상세 문구', () => {
    const applied = parseMyOrderRefundDeduction({ state: 'applied', paymentAmount: 30000, deductionAmount: 3000, refundAmount: 27000, basis: 'one_way', oneWayAmount: 3000 });
    expect(applied && myOrderRefundDeductionCopy(applied)).toEqual({
      title: '반품배송비 3,000원 차감, 환불 27,000원',
      body: '단순 변심 반품이라 결제 금액 30,000원에서 반품배송비(편도 3,000원)를 뺀 금액을 환불했습니다. 카드 부분 취소는 카드사 처리에 영업일 기준 3~4일이 걸릴 수 있습니다.',
    });
    const full = parseMyOrderRefundDeduction({ state: 'not_applied', paymentAmount: 30000, deductionAmount: 3000, refundAmount: 30000, basis: 'one_way', oneWayAmount: 3000 });
    expect(full && myOrderRefundDeductionCopy(full).title).toBe('결제 금액 30,000원 전액 환불');
    expect(parseMyOrderRefundDeduction({ state: 'applied', paymentAmount: 30000, deductionAmount: 3000, refundAmount: 30000, basis: 'one_way', oneWayAmount: 3000 })).toBeNull();
    expect(parseMyOrderRefundDeduction(null)).toBeNull();
  });

  it('무통장은 환불계좌 송금 문구로, 카드는 카드사 문구로 끝난다', () => {
    const base = { state: 'applied', paymentAmount: 30000, deductionAmount: 3000, refundAmount: 27000, basis: 'one_way', oneWayAmount: 3000 };
    const bank = parseMyOrderRefundDeduction({ ...base, provider: 'bank_transfer' });
    expect(bank && myOrderRefundDeductionCopy(bank).body).toContain('환불은 등록하신 환불계좌로 송금해 드립니다.');
    expect(bank && myOrderRefundDeductionCopy(bank).body).not.toContain('카드');
    const card = parseMyOrderRefundDeduction({ ...base, provider: 'toss' });
    expect(card && myOrderRefundDeductionCopy(card).body).toContain('카드 부분 취소는 카드사 처리에');
  });
});

describe('접수 안내(orderClaimIntakeNotice)', () => {
  it('스위치가 꺼져 있으면 지금 문구와 한 글자도 같다', () => {
    for (const type of ['cancel', 'return', 'exchange'] as const) {
      expect(orderClaimIntakeNotice(type)).toBe(ORDER_CLAIM_INTAKE_NOTICES[type]);
      expect(orderClaimIntakeNotice(type, { enabled: false, oneWayAmount: null })).toBe(ORDER_CLAIM_INTAKE_NOTICES[type]);
    }
  });

  it('켜져 있으면 반품 안내만 차감 규칙으로 바꾼다', () => {
    const notice = orderClaimIntakeNotice('return', { enabled: true, oneWayAmount: 3000 });
    expect(notice).toContain('단순 변심 반품은 반품배송비 3,000원(최초 무료배송 주문은 왕복 6,000원)을 빼고 환불합니다.');
    expect(notice).toContain('굿즈 하자·오배송은 빼지 않습니다.');
    expect(notice).not.toContain('결제금액 전액으로 처리합니다');
    expect(orderClaimIntakeNotice('exchange', { enabled: true, oneWayAmount: 3000 })).toBe(ORDER_CLAIM_INTAKE_NOTICES.exchange);
  });

  it('공개 정책 응답이 어긋나면 꺼진 것으로 읽는다', () => {
    expect(parseReturnFeeDeductionPolicy({ enabled: true, oneWayAmount: 3000 })).toEqual({ enabled: true, oneWayAmount: 3000 });
    expect(parseReturnFeeDeductionPolicy({ enabled: true, oneWayAmount: null })).toEqual({ enabled: false, oneWayAmount: null });
    expect(parseReturnFeeDeductionPolicy(null)).toEqual({ enabled: false, oneWayAmount: null });
  });
});

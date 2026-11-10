import { describe, expect, it } from 'vitest';
import type { GoodsTransactionDisplay, GoodsTransactionSelection } from '../goods-transaction';
import { decideSubscriptionWork, subscriptionLeaseMatches, subscriptionRenewalTerms, subscriptionTermsNeedConfirmation,
  type SubscriptionCycleInput } from './model';
import type { SubscriptionSchedule } from './schedule';

const id = (n: number) => `b1711000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = new Date('2026-10-14T01:00:00Z');
const cycle: SubscriptionCycleInput = { planState: 'active', cycleState: 'ready', scheduledAt: '2026-10-14T00:00:00Z',
  dispatchedAt: null, accountAllowed: true, credentialReady: true, termsAccepted: true, sourceCurrent: true };
const schedule: SubscriptionSchedule = { unit: 'month', interval: 1, anchorDate: '2026-10-14', time: '09:00', monthEnd: false };
const selection: GoodsTransactionSelection[] = [{ goodId: 'subscription-fixture', variantId: id(1), qty: 1, inputRevision: 0, inputValues: {} }];
const display: GoodsTransactionDisplay = { calculationVersion: 2, currency: 'KRW', calculatedAt: '2026-10-14T00:00:00Z', nextChangeAt: null,
  lines: [{ lineId: id(2), goodId: 'subscription-fixture', variantId: id(1), qty: 1, regularUnitPrice: 10000, unitPrice: 10000,
    volumeUnitDiscount: 0, subtotal: 10000, volumeDiscountTotal: 0, netSubtotal: 10000,
    couponDiscount: 0, storeCreditDiscount: 0, paidGoodsTotal: 10000, volumePolicyId: null }],
  shipping: [{ originId: id(3), prepaidFee: 0, collectFee: 3000, fullFee: 3000,
    components: [{ goodId: 'subscription-fixture', paymentMode: 'collect', baseFee: 3000, regionalFee: 0, totalFee: 3000, deliveryPolicyId: id(4) }],
    collector: { name: '합성 배송사', method: '배송 시 지급', refundContact: '합성 고객센터', instructions: '합성 수납 안내' } }],
  totals: { subtotal: 10000, volumeDiscountTotal: 0, netGoodsTotal: 10000, couponDiscountTotal: 0, storeCreditTotal: 0,
    prepaidShippingTotal: 0, collectShippingTotal: 3000, onlineTotal: 10000, customerTotal: 13000 },
  userCouponId: null, storeCreditMaximum: 9000, paymentMethods: { card: true, bankTransfer: true } };

describe('정기배송 회차 상태 결정', () => {
  it('미발송은 취소·계정 fence·카드·동의·예정일을 먼저 검사한다', () => {
    expect(decideSubscriptionWork({ ...cycle, planState: 'canceled' }, now)).toEqual({ kind: 'noop', reason: 'plan_stopped' });
    expect(decideSubscriptionWork({ ...cycle, accountAllowed: false }, now)).toEqual({ kind: 'pause', reason: 'account_unavailable' });
    expect(decideSubscriptionWork({ ...cycle, credentialReady: false }, now)).toEqual({ kind: 'pause', reason: 'card_unavailable' });
    expect(decideSubscriptionWork({ ...cycle, termsAccepted: false }, now)).toEqual({ kind: 'needs_confirmation' });
    expect(decideSubscriptionWork({ ...cycle, sourceCurrent: false }, now)).toEqual({ kind: 'needs_confirmation' });
    expect(decideSubscriptionWork(cycle, new Date('2026-10-15T00:00:01Z'))).toEqual({ kind: 'pause', reason: 'schedule_missed' });
    expect(decideSubscriptionWork(cycle, now)).toEqual({ kind: 'quote' });
    expect(decideSubscriptionWork({ ...cycle, cycleState: 'prepared' }, now)).toEqual({ kind: 'dispatch' });
  });
  it('이미 발송한 회차는 해지·계정 정지 뒤에도 조회하며 과거 실패를 재청구하지 않는다', () => {
    expect(decideSubscriptionWork({ ...cycle, dispatchedAt: '2026-10-14T00:30:00Z', cycleState: 'unknown',
      planState: 'canceled', accountAllowed: false, credentialReady: false }, now)).toEqual({ kind: 'inspect' });
    expect(decideSubscriptionWork({ ...cycle, cycleState: 'declined' }, now)).toEqual({ kind: 'noop', reason: 'terminal' });
  });
  it('같은 token이라도 새 fence·만료 뒤의 완료는 허용하지 않는다', () => {
    const lease = { token: id(5), fence: 2, expiresAt: '2026-10-14T01:10:00Z' };
    expect(subscriptionLeaseMatches(lease, lease, now)).toBe(true);
    expect(subscriptionLeaseMatches({ ...lease, fence: 3 }, lease, now)).toBe(false);
    expect(subscriptionLeaseMatches(lease, lease, new Date(lease.expiresAt))).toBe(false);
    expect(subscriptionLeaseMatches(null, lease, now)).toBe(false);
  });
});

describe('정기배송 갱신 동의', () => {
  const input = { display, selection, schedule, addressRevision: id(6) };
  it('계산시각과 임시 line ID가 달라져도 동일 조건 동의는 유지한다', () => {
    const accepted = subscriptionRenewalTerms(input);
    const current = subscriptionRenewalTerms({ ...input, display: { ...display, calculatedAt: '2026-11-14T00:00:00Z',
      lines: display.lines.map(line => ({ ...line, lineId: id(99) })) } });
    expect(subscriptionTermsNeedConfirmation(accepted, current)).toBe(false);
  });
  it('온라인 T가 같아도 착불 D·수납 안내·주소·주기가 바뀌면 다시 동의한다', () => {
    const accepted = subscriptionRenewalTerms(input);
    const moreShipping = structuredClone(display);
    moreShipping.shipping[0] = { ...moreShipping.shipping[0], collectFee: 4000, fullFee: 4000,
      components: [{ ...moreShipping.shipping[0].components[0], baseFee: 4000, totalFee: 4000 }] };
    moreShipping.totals = { ...moreShipping.totals, collectShippingTotal: 4000, customerTotal: 14000 };
    expect(subscriptionTermsNeedConfirmation(accepted, subscriptionRenewalTerms({ ...input, display: moreShipping }))).toBe(true);
    const collector = structuredClone(display); collector.shipping[0].collector!.method = '다른 수납 방식';
    expect(subscriptionTermsNeedConfirmation(accepted, subscriptionRenewalTerms({ ...input, display: collector }))).toBe(true);
    expect(subscriptionTermsNeedConfirmation(accepted, subscriptionRenewalTerms({ ...input, addressRevision: id(7) }))).toBe(true);
    expect(subscriptionTermsNeedConfirmation(accepted, subscriptionRenewalTerms({ ...input, schedule: { ...schedule, interval: 2 } }))).toBe(true);
  });
  it('최초 쿠폰/적립금 혜택을 향후 회차 동의로 재사용하지 않는다', () => {
    expect(() => subscriptionRenewalTerms({ ...input, display: { ...display, userCouponId: id(8) } })).toThrow('invalid_subscription_renewal_terms');
    const credit = structuredClone(display);
    credit.lines[0].storeCreditDiscount = 100; credit.lines[0].paidGoodsTotal = 9900;
    credit.totals = { ...credit.totals, storeCreditTotal: 100, onlineTotal: 9900, customerTotal: 12900 };
    expect(() => subscriptionRenewalTerms({ ...input, display: credit })).toThrow('invalid_subscription_renewal_terms');
  });
});

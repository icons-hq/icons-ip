import type { CartTransactionInput, CartTransactionRecovery } from '@/lib/checkout-transaction';
import type { GoodsTransactionDisplay, GoodsTransactionQuote } from '@/lib/goods-transaction';

export const transactionActor = '72000000-0000-4000-8000-000000000001';
export const transactionSession = '72000000-0000-4000-8000-000000000002';
export const transactionOrder = '72000000-0000-4000-8000-000000000003';
export const transactionQuoteId = '72000000-0000-4000-8000-000000000004';
export const transactionLineId = '72000000-0000-4000-8000-000000000005';
export const transactionInput = {
  expectedActorId: transactionActor, items: [{ goodId: 'transaction-good', variantId: '72000000-0000-4000-8000-000000000006', qty: 2 }],
  address: { recipientName: '수령인', phone: '01012345678', postalCode: '04799', address1: '서울 성동구 테스트길', address2: '123호', deliveryNote: '' },
  deliveryChoices: { 'transaction-good': 'collect' }, userCouponId: '72000000-0000-4000-8000-000000000007', storeCreditAmount: 1000,
} satisfies CartTransactionInput;
export const transactionDisplay: GoodsTransactionDisplay = {
  calculationVersion: 2, currency: 'KRW', calculatedAt: '2026-10-14T03:00:00.000000Z', nextChangeAt: null,
  lines: [{ lineId: transactionLineId, goodId: 'transaction-good', variantId: transactionInput.items[0].variantId!, qty: 2, regularUnitPrice: 10000, unitPrice: 10000,
    volumeUnitDiscount: 1000, subtotal: 20000, volumeDiscountTotal: 2000, netSubtotal: 18000, couponDiscount: 1000, storeCreditDiscount: 1000, paidGoodsTotal: 16000,
    volumePolicyId: '72000000-0000-4000-8000-000000000008' }],
  shipping: [{ originId: '72000000-0000-4000-8000-000000000009', prepaidFee: 0, collectFee: 3000, fullFee: 3000,
    components: [{ goodId: 'transaction-good', paymentMode: 'collect', baseFee: 3000, regionalFee: 0, totalFee: 3000, deliveryPolicyId: '72000000-0000-4000-8000-000000000010' }],
    collector: { name: '배송사', method: '수령 시 납부', refundContact: '판매자 문의', instructions: '받는 분이 배송사에 납부해주세요.' } }],
  totals: { subtotal: 20000, volumeDiscountTotal: 2000, netGoodsTotal: 18000, couponDiscountTotal: 1000, storeCreditTotal: 1000,
    prepaidShippingTotal: 0, collectShippingTotal: 3000, onlineTotal: 16000, customerTotal: 19000 },
  userCouponId: transactionInput.userCouponId, storeCreditMaximum: 5000, paymentMethods: { card: true, bankTransfer: true },
};
export const transactionQuote: GoodsTransactionQuote = { state: 'quoted', quoteId: transactionQuoteId, expiresAt: '2026-10-14T03:10:00Z', display: transactionDisplay };
export const transactionRecovery: CartTransactionRecovery = { version: 1, expectedActorId: transactionActor, sessionId: transactionSession,
  quoteId: transactionQuoteId, checkoutKey: '72000000-0000-4000-8000-000000000011', paymentMethod: 'card' };

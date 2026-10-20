import { expect, it } from 'vitest';
import { cartTransactionRequestTooLarge, cartTransactionSnapshot, parseCartTransactionInput, parseCartTransactionOrderInput, parseCartTransactionRecovery, parseCheckoutTransactionReceipt, transactionReceiptNames } from './checkout-transaction';
import { transactionDisplay, transactionInput, transactionOrder, transactionQuoteId, transactionRecovery } from '@/test/fixtures/cart-transaction';

it('선택 의도만 받고 클라이언트 가격·타 상품 배송 선택·중복 품목을 거절한다', () => {
  expect(parseCartTransactionInput(transactionInput)).toEqual(transactionInput);
  for (const invalid of [{ ...transactionInput, total: 1 }, { ...transactionInput, deliveryChoices: { other: 'collect' } },
    { ...transactionInput, items: [...transactionInput.items, ...transactionInput.items] }, { ...transactionInput, storeCreditAmount: 0.1 },
    { ...transactionInput, userCouponId: 'bad' }, { ...transactionInput, items: [] }]) expect(parseCartTransactionInput(invalid)).toBeNull();
  expect(cartTransactionSnapshot(transactionInput.items)).toEqual([{ good_id: 'transaction-good', variant_id: transactionInput.items[0].variantId, qty: 2, input_revision: 0, input_values: {} }]);
});
it('직접입력 1,001줄을 절단하지 않으며 큰 요청은 UTF-8 바이트로 제한한다', () => {
  const items = Array.from({ length: 1001 }, (_, i) => ({ ...transactionInput.items[0], qty: 1, customInputs: { revision: 1,
    fields: [{ id: transactionOrder, name: '각인', value: `문구 ${i}` }] } }));
  expect(parseCartTransactionInput({ ...transactionInput, items })?.items).toHaveLength(1001);
  expect(cartTransactionRequestTooLarge({ text: '한'.repeat(700_000) })).toBe(true);
  expect(cartTransactionRequestTooLarge({ text: 'a'.repeat(700_000) })).toBe(false);
});
it('결제 요청과 복구 식별자는 고정하며 복구 데이터에 배송지·품목을 저장하지 않는다', () => {
  const { quoteId, checkoutKey, paymentMethod } = transactionRecovery;
  expect(parseCartTransactionOrderInput({ ...transactionInput, quoteId, checkoutKey, paymentMethod })).not.toBeNull();
  expect(parseCartTransactionRecovery(transactionRecovery)).toEqual(transactionRecovery);
  expect(parseCartTransactionRecovery({ ...transactionRecovery, address: transactionInput.address })).toBeNull();
  expect(parseCartTransactionRecovery({ ...transactionRecovery, items: transactionInput.items })).toBeNull();
  expect(parseCartTransactionOrderInput({ ...transactionInput, quoteId, checkoutKey, paymentMethod: 'cash' })).toBeNull();
});
it('영수증은 온라인 결제와 착불 합계를 각각 검증하고 모르는 개인정보 필드를 거절한다', () => {
  const receipt = { orderId: transactionOrder, quoteId: transactionQuoteId, display: transactionDisplay };
  expect(parseCheckoutTransactionReceipt(receipt)).toEqual(receipt);
  expect(parseCheckoutTransactionReceipt({ ...receipt, address: transactionInput.address })).toBeNull();
  expect(parseCheckoutTransactionReceipt({ ...receipt, display: { ...transactionDisplay, totals: { ...transactionDisplay.totals, onlineTotal: 19000 } } })).toBeNull();
  expect(transactionReceiptNames(transactionDisplay, [{ id: transactionDisplay.lines[0].lineId, name: '주문 당시 이름' }])).toEqual({ 'transaction-good': '주문 당시 이름' });
});

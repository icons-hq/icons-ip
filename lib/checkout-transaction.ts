import { FULFILLMENT_METHODS, type FulfillmentMethod } from './goods-fulfillment';
import { normalizeCartItems, type CartItem } from './cart';
import { normalizeCheckoutAddress, normalizeCheckoutKey, normalizeCheckoutPaymentMethod, type CheckoutAddress, type CheckoutPaymentMethod } from './checkout';
import { goodsCustomInputValues } from './goods-custom-inputs';
import { GOODS_TRANSACTION_MAX_LINES, parseGoodsTransactionDisplay, type GoodsTransactionDisplay, type GoodsTransactionIssueCode } from './goods-transaction';
import { GOODS_TRANSACTION_SELECTION_MAX_BYTES, transactionExactKeys, transactionRecord } from './goods-transaction-values';
import { normalizeStoreCreditAmount } from './store-credits';

export type CheckoutDeliveryChoice = 'prepaid' | 'collect' | { method: FulfillmentMethod; paymentMode: 'prepaid' | 'collect' };
export type CheckoutDeliveryChoices = Record<string, CheckoutDeliveryChoice>;
export type TransactionAddress = CheckoutAddress | { kind: 'none' };
export interface CartTransactionInput {
  expectedActorId: string;
  items: CartItem[];
  address: TransactionAddress;
  deliveryChoices: CheckoutDeliveryChoices;
  userCouponId: string | null; userCouponIds?: string[];
  storeCreditAmount: number;
}
export interface CartTransactionOrderInput extends CartTransactionInput {
  quoteId: string;
  checkoutKey: string;
  paymentMethod: CheckoutPaymentMethod;
}
export interface CheckoutTransactionReceipt { orderId: string; quoteId: string; display: GoodsTransactionDisplay }
export function cartTransactionRequestTooLarge(value: unknown): boolean {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength > GOODS_TRANSACTION_SELECTION_MAX_BYTES; } catch { return true; }
}
export interface CartTransactionRecovery {
  version: 1; expectedActorId: string; sessionId: string; quoteId: string; checkoutKey: string; paymentMethod: CheckoutPaymentMethod;
}

export function parseCartTransactionRecovery(value: unknown): CartTransactionRecovery | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['version', 'expectedActorId', 'sessionId', 'quoteId', 'checkoutKey', 'paymentMethod']) || value.version !== 1) return null;
  const expectedActorId = normalizeCheckoutKey(value.expectedActorId), sessionId = normalizeCheckoutKey(value.sessionId);
  const quoteId = normalizeCheckoutKey(value.quoteId), checkoutKey = normalizeCheckoutKey(value.checkoutKey), paymentMethod = normalizeCheckoutPaymentMethod(value.paymentMethod);
  return expectedActorId && sessionId && quoteId && checkoutKey && paymentMethod ? { version: 1, expectedActorId, sessionId, quoteId, checkoutKey, paymentMethod } : null;
}

/** The request carries intentions only; every price and allocation comes from the DB. */
export function parseCartTransactionInput(value: unknown): CartTransactionInput | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['expectedActorId', 'items', 'address', 'deliveryChoices', 'userCouponId', 'storeCreditAmount', ...(Object.hasOwn(value, 'userCouponIds') ? ['userCouponIds'] : [])]) || cartTransactionRequestTooLarge(value)) return null;
  const expectedActorId = normalizeCheckoutKey(value.expectedActorId), address = transactionRecord(value.address) && transactionExactKeys(value.address, ['kind']) && value.address.kind === 'none' ? { kind: 'none' as const } : normalizeCheckoutAddress(value.address);
  const items = normalizeCartItems(value.items), userCouponId = value.userCouponId === null ? null : normalizeCheckoutKey(value.userCouponId);
  const storeCreditAmount = normalizeStoreCreditAmount(value.storeCreditAmount);
  if (Object.hasOwn(value, 'userCouponIds') && (!Array.isArray(value.userCouponIds) || value.userCouponIds.length > 6 || value.userCouponIds.some(id => !normalizeCheckoutKey(id)) || new Set(value.userCouponIds).size !== value.userCouponIds.length || (value.userCouponIds[0] ?? null) !== userCouponId)) return null;
  if (!expectedActorId || !address || !Array.isArray(value.items) || !items.length || items.length !== value.items.length
    || items.length > GOODS_TRANSACTION_MAX_LINES || items.some(item => !item.variantId) || storeCreditAmount === null
    || value.userCouponId !== null && !userCouponId || !transactionRecord(value.deliveryChoices)) return null;
  const goods = new Set(items.map(item => item.goodId));
  if (Object.entries(value.deliveryChoices).some(([id, mode]) => !goods.has(id) || mode !== 'prepaid' && mode !== 'collect' && (!transactionRecord(mode) || !transactionExactKeys(mode, ['method', 'paymentMode']) || !FULFILLMENT_METHODS.includes(mode.method as FulfillmentMethod) || !['prepaid', 'collect'].includes(String(mode.paymentMode))))) return null;
  return { expectedActorId, items, address, userCouponId, ...(Array.isArray(value.userCouponIds) ? { userCouponIds: value.userCouponIds as string[] } : {}), storeCreditAmount, deliveryChoices: { ...value.deliveryChoices } as CheckoutDeliveryChoices };
}

export function parseCartTransactionOrderInput(value: unknown): CartTransactionOrderInput | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['expectedActorId', 'items', 'address', 'deliveryChoices', 'userCouponId', 'storeCreditAmount', 'quoteId', 'checkoutKey', 'paymentMethod', ...(Object.hasOwn(value, 'userCouponIds') ? ['userCouponIds'] : [])])) return null;
  const { quoteId: rawQuoteId, checkoutKey: rawKey, paymentMethod: rawMethod, ...rest } = value;
  const input = parseCartTransactionInput(rest), quoteId = normalizeCheckoutKey(rawQuoteId), checkoutKey = normalizeCheckoutKey(rawKey), paymentMethod = normalizeCheckoutPaymentMethod(rawMethod);
  return input && quoteId && checkoutKey && paymentMethod ? { ...input, quoteId, checkoutKey, paymentMethod } : null;
}

export function cartTransactionSnapshot(items: readonly CartItem[]) {
  return items.map(item => ({ good_id: item.goodId, variant_id: item.variantId, qty: item.qty,
    input_revision: item.customInputs?.revision ?? 0, input_values: goodsCustomInputValues(item.customInputs) }));
}

export function parseCheckoutTransactionReceipt(value: unknown): CheckoutTransactionReceipt | null {
  if (!transactionRecord(value) || !transactionExactKeys(value, ['orderId', 'quoteId', 'display'])) return null;
  const orderId = normalizeCheckoutKey(value.orderId), quoteId = normalizeCheckoutKey(value.quoteId), display = parseGoodsTransactionDisplay(value.display);
  return orderId && quoteId && display ? { orderId, quoteId, display } : null;
}

/** A catalog slug can change after purchase; immutable order-item IDs bind labels. */
export function transactionReceiptNames(display: GoodsTransactionDisplay, items: readonly { id: string; name: string }[]): Record<string, string> {
  const byId = new Map(items.map(item => [item.id, item.name]));
  return Object.fromEntries(display.lines.flatMap(line => {
    const name = byId.get(line.lineId); return name === undefined ? [] : [[line.goodId, name]];
  }));
}

export const transactionIssueCopy: Record<GoodsTransactionIssueCode, string> = {
  address_required: '받는 분과 배송지를 입력하면 할인과 배송비를 확인할 수 있어요.',
  invalid_selection: '주문할 굿즈와 옵션을 다시 확인해주세요.',
  goods_unavailable: '지금 주문할 수 없는 굿즈가 있어요. 판매기간과 재고를 확인해주세요.',
  adult_verification_required: '19금 굿즈는 성인 인증을 마친 회원만 주문할 수 있어요. 마이 > 성인 인증에서 인증한 뒤 다시 시도해주세요.',
  purchase_limit: '구매 가능한 수량을 확인해주세요.',
  purchase_restricted: '현재 굿즈 구매가 제한된 계정이에요. 자세한 내용은 고객센터에 문의해주세요.',
  payment_method_unavailable: '이 주문에 사용할 수 있는 결제수단이 없어요.',
  shipping_unresolved: '해당 배송지의 배송 가능 여부와 배송비를 확인해주세요.',
  collect_not_ready: '착불 배송을 준비 중이에요. 선불을 선택하거나 판매자에게 문의해주세요.',
  delivery_choice_required: '굿즈을 받을 방식과 배송비 결제방법을 선택해주세요.',
  coupon_unavailable: '선택한 쿠폰의 사용 조건이 바뀌었어요. 장바구니에서 쿠폰을 확인해주세요.',
  store_credit_unavailable: '적립금 잔액이나 사용 조건이 바뀌었어요. 사용 금액을 조정해주세요.',
  below_minimum_payment: '온라인 결제금액은 1,000원 이상이어야 해요.',
  amount_overflow: '주문 가능한 금액을 초과했어요. 수량을 조정해주세요.',
  source_changed: '주문 내용이 변경되었어요. 최신 내용을 다시 확인해주세요.',
};

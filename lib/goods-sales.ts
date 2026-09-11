import { parseShippingQuote, type ShippingQuote } from './fulfillment';
import { parseCouponQuote, type CouponQuote } from './coupon-targeting';
import { MIN_PAYABLE_TOTAL } from './coupons';
import { parseGoodsVariantSupply, type GoodsVariantSupply } from './goods-preorders';

/** Server-derived catalog/cart prices. The client displays this quote; place_order
 * still evaluates the same SQL rule under its quantity and catalog locks. */
export interface GoodsVariantPricing {
  regularPrice: number;
  effectivePrice: number;
  pricePeriodId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  calculatedAt: string;
  nextChangeAt?: string | null;
}

export type GoodsPurchaseReason =
  | 'purchase_limit_not_configured'
  | 'order_quantity_below_minimum'
  | 'order_quantity_above_maximum'
  | 'member_purchase_limit_exceeded';

export interface GoodsSalesQuoteLine extends Omit<GoodsVariantPricing, 'calculatedAt'> {
  goodId: string;
  variantId: string;
  qty: number;
  available: boolean;
  supply?: GoodsVariantSupply;
}

export interface GoodsSalesQuoteGood {
  goodId: string;
  qty: number;
  orderQuantityLimitEnabled: boolean;
  minOrderQty: number | null;
  maxOrderQty: number | null;
  memberPurchaseLimitEnabled: boolean;
  memberLifetimeQtyLimit: number | null;
  memberReservedQty: number | null;
  memberRemainingQty: number | null;
  reason: GoodsPurchaseReason | null;
}

export interface GoodsSalesQuote {
  calculatedAt: string;
  subtotal: number;
  lines: GoodsSalesQuoteLine[];
  goods: GoodsSalesQuoteGood[];
  paymentMethods: { card: boolean; bankTransfer: boolean };
  shipping: ShippingQuote;
  nextChangeAt?: string | null;
  coupon?: CouponQuote | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASONS = new Set<GoodsPurchaseReason>([
  'purchase_limit_not_configured', 'order_quantity_below_minimum',
  'order_quantity_above_maximum', 'member_purchase_limit_exceeded',
]);
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
function identity(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function priceFields(value: Record<string, unknown>): boolean {
  if (!nonnegative(value.regularPrice) || !nonnegative(value.effectivePrice) || value.effectivePrice > value.regularPrice) return false;
  if (value.pricePeriodId === null) {
    return value.effectivePrice === value.regularPrice && value.startsAt === null && value.endsAt === null;
  }
  return typeof value.pricePeriodId === 'string' && UUID.test(value.pricePeriodId)
    && instant(value.startsAt) && instant(value.endsAt)
    && Date.parse(value.startsAt) < Date.parse(value.endsAt)
    && value.effectivePrice < value.regularPrice;
}

export function parseGoodsVariantPricing(value: unknown): GoodsVariantPricing | null {
  if (!object(value) || !priceFields(value) || !instant(value.calculatedAt)) return null;
  if (value.nextChangeAt != null && (!instant(value.nextChangeAt) || Date.parse(value.nextChangeAt) <= Date.parse(value.calculatedAt))) return null;
  return value as unknown as GoodsVariantPricing;
}

export function parseGoodsSalesQuote(value: unknown, shippingParser: (value: unknown) => ShippingQuote | null = parseShippingQuote): GoodsSalesQuote | null {
  if (!object(value) || !instant(value.calculatedAt) || !nonnegative(value.subtotal)
    || !Array.isArray(value.lines) || !Array.isArray(value.goods)
    || !object(value.paymentMethods) || typeof value.paymentMethods.card !== 'boolean'
    || typeof value.paymentMethods.bankTransfer !== 'boolean') return null;
  const shipping = shippingParser(value.shipping);
  if (!shipping || (value.nextChangeAt != null && (!instant(value.nextChangeAt) || Date.parse(value.nextChangeAt) <= Date.parse(value.calculatedAt)))) return null;

  const quantities = new Map<string, number>();
  const identities = new Set<string>();
  let subtotal = 0;
  for (const line of value.lines) {
    if (!object(line) || !identity(line.goodId) || typeof line.variantId !== 'string' || !UUID.test(line.variantId)
      || !positive(line.qty) || !priceFields(line) || typeof line.available !== 'boolean') return null;
    if (line.supply !== undefined) {
      const supply = parseGoodsVariantSupply(line.supply);
      if (!supply || (line.available && line.qty > supply.availableQty)) return null;
    }
    const key = `${line.goodId}:${line.variantId}`;
    if (identities.has(key)) return null;
    identities.add(key);
    const nextQuantity = (quantities.get(line.goodId) ?? 0) + line.qty;
    subtotal += line.qty * (line.effectivePrice as number);
    if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(nextQuantity)) return null;
    quantities.set(line.goodId, nextQuantity);
  }
  if (subtotal !== value.subtotal || quantities.size !== value.goods.length) return null;
  if (value.coupon != null) {
    const coupon = parseCouponQuote(value.coupon);
    if (!coupon || coupon.eligibleSubtotal > subtotal
      || coupon.discount > Math.max(0, subtotal + shipping.totalFee - MIN_PAYABLE_TOTAL)) return null;
  }
  for (const good of value.goods) {
    if (!object(good) || !identity(good.goodId) || !positive(good.qty) || quantities.get(good.goodId) !== good.qty
      || typeof good.orderQuantityLimitEnabled !== 'boolean' || typeof good.memberPurchaseLimitEnabled !== 'boolean'
      || (good.minOrderQty !== null && !positive(good.minOrderQty))
      || (good.maxOrderQty !== null && !positive(good.maxOrderQty))
      || (good.memberLifetimeQtyLimit !== null && !positive(good.memberLifetimeQtyLimit))
      || (good.memberReservedQty !== null && !nonnegative(good.memberReservedQty))
      || (good.memberRemainingQty !== null && !nonnegative(good.memberRemainingQty))
      || (good.reason !== null && !REASONS.has(good.reason as GoodsPurchaseReason))) return null;
    if (good.minOrderQty !== null && good.maxOrderQty !== null && (good.minOrderQty as number) > (good.maxOrderQty as number)) return null;
    if (good.orderQuantityLimitEnabled && (good.minOrderQty === null || good.maxOrderQty === null)) return null;
    if (good.memberPurchaseLimitEnabled && good.memberLifetimeQtyLimit === null) return null;
    if (!good.memberPurchaseLimitEnabled || good.memberReservedQty === null) {
      if (good.memberRemainingQty !== null) return null;
    } else if (good.memberRemainingQty !== Math.max(0, (good.memberLifetimeQtyLimit as number) - (good.memberReservedQty as number))) return null;
    quantities.delete(good.goodId);
  }
  return { ...value, shipping } as unknown as GoodsSalesQuote;
}

export function goodsPurchaseReasonMessage(reason: GoodsPurchaseReason): string {
  const messages: Record<GoodsPurchaseReason, string> = {
    purchase_limit_not_configured: '상품의 구매 조건을 확인 중입니다. 잠시 후 다시 확인해주세요.',
    order_quantity_below_minimum: '같은 상품의 옵션을 합한 수량이 최소 구매 수량보다 적어요.',
    order_quantity_above_maximum: '같은 상품의 옵션을 합한 수량이 주문당 최대 수량을 초과해요.',
    member_purchase_limit_exceeded: '회원 누적 구매 한도를 초과해요. 결제 대기 중인 주문도 한도에 포함됩니다.',
  };
  return messages[reason];
}

export function goodsSalesQuoteProblem(quote: GoodsSalesQuote): string | null {
  if (quote.lines.some((line) => !line.available)) return '현재 판매 상태나 재고가 변경된 굿즈가 있어요. 수량을 다시 확인해주세요.';
  const reason = quote.goods.find((good) => good.reason)?.reason;
  if (reason) return goodsPurchaseReasonMessage(reason);
  if (quote.coupon?.reason) return '선택한 쿠폰의 적용 조건이 바뀌었어요. 장바구니에서 쿠폰을 다시 확인해주세요.';
  if (quote.lines.length && !quote.paymentMethods.card && !quote.paymentMethods.bankTransfer) {
    return '함께 결제할 수 있는 공통 결제수단이 없어요. 상품을 나누어 주문해주세요.';
  }
  return null;
}

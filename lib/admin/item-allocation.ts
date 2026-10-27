/**
 * 주문 할인·적립금을 품목에 나누는 규칙(10/14 회의 A5).
 *
 * 계산 버전 2 주문은 주문할 때 기록한 품목 배분 원장(`private.order_price_allocations`)을 그대로 쓴다.
 * 버전 1(legacy) 주문은 원장이 없으므로 주문 당시 쿠폰 기록(대상·대상 품목 합계)과 사용 적립금을
 * 거래확정 엑셀과 **같은 규칙**으로 나눈다 — 쿠폰은 대상 품목 금액 비례, 적립금은 쿠폰 차감 뒤 금액
 * 비례, 나머지는 큰 나머지 순·품목 UUID 순으로 1원씩 준다. 주문 당시 기록이 없거나 합계가 맞지 않으면
 * 추정하지 않고 배분하지 않는다.
 */

export interface LegacyCouponRecord {
  discountAmount: number;
  eligibleSubtotal: number | null;
  terms: { goodsScope: 'all' | 'selected_goods'; targetGoodIds: string[] } | null;
}

export const LEGACY_ALLOCATION_ISSUES = {
  couponUnrecorded: '쿠폰 대상·금액의 주문 당시 기록 미기록 또는 불일치',
  couponTargetMismatch: '쿠폰 대상 품목 합계 불일치',
  creditMismatch: '사용 적립금과 상품 금액 불일치',
} as const;

function toSafe(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error('품목 금액 배분을 계산하지 못했습니다.');
  return number;
}

/** Largest remainder allocation. UUID order is the deterministic tie breaker. */
export function allocateSettledAmount(amount: number, weights: { id: string; amount: number }[]): number[] | null {
  const total = weights.reduce((value, weight) => value + BigInt(weight.amount), BigInt(0));
  if (amount === 0) return weights.map(() => 0);
  if (total < BigInt(amount) || total <= BigInt(0)) return null;
  const shares = weights.map((weight, index) => ({ index, id: weight.id, base: BigInt(amount) * BigInt(weight.amount) / total, remainder: BigInt(amount) * BigInt(weight.amount) % total }));
  let remaining = BigInt(amount) - shares.reduce((value, share) => value + share.base, BigInt(0));
  const ranked = [...shares].sort((a, b) => a.remainder === b.remainder ? a.id.localeCompare(b.id, 'en') : a.remainder > b.remainder ? -1 : 1);
  for (const share of ranked) { if (!remaining) break; share.base += BigInt(1); remaining -= BigInt(1); }
  return shares.map(share => toSafe(share.base));
}

/**
 * 버전 1 주문의 쿠폰·적립금을 품목에 나눈다. `items[].amount`는 쿠폰 차감 전 품목 금액(단가 × 수량)이다.
 * 결과 배열은 입력 품목 순서와 같고, 배분할 수 없으면 null과 사유를 돌려준다.
 */
export function allocateLegacyOrderDiscounts(input: {
  couponDiscount: number; storeCredits: number; coupon: LegacyCouponRecord | null;
  items: readonly { id: string; goodId: string; amount: number }[];
}): { coupon: number[] | null; credits: number[] | null; issues: string[] } {
  const issues: string[] = [];
  let coupon: number[] | null = input.items.map(() => 0);
  if (input.couponDiscount) {
    const source = input.coupon;
    if (!source?.terms || source.eligibleSubtotal === null || source.discountAmount !== input.couponDiscount) {
      coupon = null; issues.push(LEGACY_ALLOCATION_ISSUES.couponUnrecorded);
    } else {
      const terms = source.terms;
      const weights = input.items.map(item => ({ id: item.id, amount: terms.goodsScope === 'all' || terms.targetGoodIds.includes(item.goodId) ? item.amount : 0 }));
      const eligible = weights.reduce((sum, weight) => sum + BigInt(weight.amount), BigInt(0));
      coupon = eligible === BigInt(source.eligibleSubtotal) ? allocateSettledAmount(input.couponDiscount, weights) : null;
      if (!coupon) issues.push(LEGACY_ALLOCATION_ISSUES.couponTargetMismatch);
    }
  }
  const afterCoupon = coupon ? input.items.map((item, index) => item.amount - coupon![index]) : null;
  const credits = afterCoupon ? allocateSettledAmount(input.storeCredits, input.items.map((item, index) => ({ id: item.id, amount: afterCoupon[index] }))) : null;
  if (afterCoupon && !credits) issues.push(LEGACY_ALLOCATION_ISSUES.creditMismatch);
  return { coupon, credits, issues };
}

/** 품목 하나의 할인·적립금 배분 후 금액. `paidGoodsTotal`은 배송비를 뺀 품목 실결제액이다. */
export interface OrderItemAllocation {
  source: 'recorded' | 'legacy';
  volumeDiscount: number; couponDiscount: number; storeCreditDiscount: number; paidGoodsTotal: number;
}
export interface OrderAllocationInput {
  orderId: string; calculationVersion: 1 | 2;
  couponDiscount: number; storeCredits: number; volumeDiscount: number;
  coupon: LegacyCouponRecord | null;
  items: {
    id: string; goodId: string; qty: number; unitPrice: number; regularUnitPrice: number | null;
    allocation: { volumeDiscount: number; couponDiscount: number; storeCreditDiscount: number; paidGoodsTotal: number } | null;
  }[];
}

/** 주문 한 건의 품목별 배분. 배분할 수 없는 주문은 빈 Map이다(화면·엑셀은 빈칸으로 둔다). */
export function orderItemAllocations(order: OrderAllocationInput): Map<string, OrderItemAllocation> {
  const result = new Map<string, OrderItemAllocation>();
  if (!order.items.length) return result;
  if (order.calculationVersion === 2) {
    if (order.items.some(item => !item.allocation)) return result;
    for (const item of order.items) result.set(item.id, { source: 'recorded', ...item.allocation! });
    return result;
  }
  if (order.volumeDiscount !== 0) return result;
  const items = order.items.map(item => ({ id: item.id, goodId: item.goodId, amount: toSafe(BigInt(item.unitPrice) * BigInt(item.qty)) }));
  const { coupon, credits } = allocateLegacyOrderDiscounts({ couponDiscount: order.couponDiscount, storeCredits: order.storeCredits, coupon: order.coupon, items });
  if (!coupon || !credits) return result;
  items.forEach((item, index) => result.set(item.id, {
    source: 'legacy', volumeDiscount: 0, couponDiscount: coupon[index], storeCreditDiscount: credits[index],
    paidGoodsTotal: item.amount - coupon[index] - credits[index],
  }));
  return result;
}

/**
 * 스마트스토어 양식의 `상품별 할인액`: 당시 정가와 판매 단가의 차이 + 복수구매·쿠폰·적립금 배분.
 * 정가 기록이 없거나 판매가보다 낮으면 총 할인액을 추정하지 않는다(DB 출고지시와 같은 규칙).
 */
export function smartStoreItemDiscount(item: { qty: number; unitPrice: number; regularUnitPrice: number | null }, allocation: OrderItemAllocation): number | null {
  if (item.regularUnitPrice === null || item.regularUnitPrice < item.unitPrice) return null;
  return toSafe(BigInt(item.regularUnitPrice - item.unitPrice) * BigInt(item.qty) + BigInt(allocation.volumeDiscount)
    + BigInt(allocation.couponDiscount) + BigInt(allocation.storeCreditDiscount));
}

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const money = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function parseCoupon(value: unknown): LegacyCouponRecord | null | undefined {
  if (value === null) return null;
  if (!record(value) || !money(value.discountAmount) || !(value.eligibleSubtotal === null || money(value.eligibleSubtotal))) return undefined;
  let terms: LegacyCouponRecord['terms'] = null;
  if (value.terms !== null && value.terms !== undefined) {
    const saved = value.terms;
    if (!record(saved) || (saved.goodsScope !== 'all' && saved.goodsScope !== 'selected_goods')) return undefined;
    const targets = saved.targetGoodIds ?? [];
    if (!Array.isArray(targets) || targets.some(id => typeof id !== 'string')) return undefined;
    terms = { goodsScope: saved.goodsScope, targetGoodIds: targets as string[] };
  }
  return { discountAmount: value.discountAmount, eligibleSubtotal: value.eligibleSubtotal as number | null, terms };
}

/** `admin_order_item_allocation_inputs` 응답을 좁힌다. 형식이 어긋난 주문은 버린다(그 주문만 빈칸). */
export function parseOrderAllocationInputs(value: unknown): OrderAllocationInput[] {
  if (!Array.isArray(value)) return [];
  const orders: OrderAllocationInput[] = [];
  for (const raw of value) {
    if (!record(raw) || typeof raw.orderId !== 'string' || (raw.calculationVersion !== 1 && raw.calculationVersion !== 2)
      || !money(raw.couponDiscount) || !money(raw.storeCredits) || !money(raw.volumeDiscount) || !Array.isArray(raw.items)) continue;
    const coupon = parseCoupon(raw.coupon ?? null);
    if (coupon === undefined) continue;
    const items: OrderAllocationInput['items'] = [];
    let valid = true;
    for (const item of raw.items) {
      if (!record(item) || typeof item.id !== 'string' || typeof item.goodId !== 'string' || !money(item.qty) || !item.qty || !money(item.unitPrice)
        || !(item.regularUnitPrice === null || money(item.regularUnitPrice))) { valid = false; break; }
      const saved = item.allocation;
      if (saved !== null && (!record(saved) || !money(saved.volumeDiscount) || !money(saved.couponDiscount) || !money(saved.storeCreditDiscount) || !money(saved.paidGoodsTotal))) { valid = false; break; }
      items.push({ id: item.id, goodId: item.goodId, qty: item.qty, unitPrice: item.unitPrice, regularUnitPrice: item.regularUnitPrice as number | null,
        allocation: saved === null ? null : { volumeDiscount: saved.volumeDiscount as number, couponDiscount: saved.couponDiscount as number, storeCreditDiscount: saved.storeCreditDiscount as number, paidGoodsTotal: saved.paidGoodsTotal as number } });
    }
    if (valid) orders.push({ orderId: raw.orderId, calculationVersion: raw.calculationVersion, couponDiscount: raw.couponDiscount, storeCredits: raw.storeCredits, volumeDiscount: raw.volumeDiscount, coupon, items });
  }
  return orders;
}

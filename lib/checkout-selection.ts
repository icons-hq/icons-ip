import { cartItemKey, type CartItem } from './cart';
import { couponErrorNeedsPendingOrder } from './coupons';
import { goodsCustomInputValues } from './goods-custom-inputs';
import { goodsPurchaseReasonMessage, quoteLineOptionLimitMessage, type GoodsSalesQuoteGood, type GoodsSalesQuoteLine } from './goods-sales';

/*
 * 장바구니 선택 주문·선택 삭제의 순수 판정(ADR-0030 · 10/14 회의 1014-031·035·036, SHEET-007).
 *
 * 화면은 고객이 체크를 푼 줄만 기억한다. 그래서 장바구니에 들어오면 전체가 체크된 채 열리고(지금 동작 보존),
 * 다른 탭에서 새로 담겨 동기화된 줄도 체크된 채 보인다. 주문할 수 없는 줄(품절·판매기간 밖·성인 인증 전 등)은
 * 선택에서 자동으로 빠지고 체크할 수 없다 — 나머지 줄의 주문을 막지 않는다. 이번 선택의 수량이 구매 조건(주문당 최소·최대,
 * 회원 누적 한도, 옵션별 한도)에 맞지 않는 줄은 살 수 있는 줄이라 체크만 풀고 사유를 보인다 — 다시 고르면 다시 견적한다.
 */

export type CartLineIdentity = Pick<CartItem, 'goodId' | 'variantId' | 'customInputs'>;

export function cartLineKey(line: CartLineIdentity): string {
  return cartItemKey(line.goodId, line.variantId, line.customInputs);
}

/** 체크된 줄. 고를 수 없는 줄은 고객의 체크와 무관하게 빠진다. */
export function selectedCartLines<T extends CartLineIdentity>(
  lines: readonly T[],
  deselected: ReadonlySet<string>,
  selectable: (line: T) => boolean,
): T[] {
  return lines.filter((line) => selectable(line) && !deselected.has(cartLineKey(line)));
}

/** 줄 하나의 체크를 바꾼 다음 해제 집합. */
export function toggleCartLineSelection(deselected: ReadonlySet<string>, key: string, checked: boolean): Set<string> {
  const next = new Set(deselected);
  if (checked) next.delete(key);
  else next.add(key);
  return next;
}

/** 전체 선택 체크박스. 켜면 고를 수 있는 모든 줄을, 끄면 모두 해제한다. */
export function toggleAllCartLines(deselected: ReadonlySet<string>, selectableKeys: readonly string[], checked: boolean): Set<string> {
  const next = new Set(deselected);
  for (const key of selectableKeys) {
    if (checked) next.delete(key);
    else next.add(key);
  }
  return next;
}

/** 장바구니에서 사라진 줄의 해제 기록을 버린다 — 같은 굿즈를 다시 담으면 체크된 채 보인다. */
export function pruneCartSelection(deselected: ReadonlySet<string>, lines: readonly CartLineIdentity[]): ReadonlySet<string> {
  if (!deselected.size) return deselected;
  const present = new Set(lines.map(cartLineKey));
  const kept = [...deselected].filter((key) => present.has(key));
  return kept.length === deselected.size ? deselected : new Set(kept);
}

/** 주문 버튼의 N(SHEET-007). 기존 데스크톱 문구 규칙과 같이 줄 수가 아니라 수량 합이다. */
export function cartSelectionQuantity(lines: readonly Pick<CartItem, 'qty'>[]): number {
  return lines.reduce((total, line) => total + line.qty, 0);
}

export function cartOrderButtonLabel(quantity: number): string {
  return `${quantity}개 주문하기`;
}

/** 장바구니 줄을 DB 줄 식별(굿즈·옵션·직접입력값)로 바꾼다. 일괄 삭제·선택 주문 초안이 같은 모양을 쓴다. */
export function cartLineIdentityPayload(line: CartLineIdentity) {
  return {
    good_id: line.goodId,
    variant_id: line.variantId,
    input_revision: line.customInputs?.revision ?? 0,
    input_values: goodsCustomInputValues(line.customInputs),
  };
}

/** 견적의 막힘 가운데 결제 대기 주문이 원인일 수 있는 사유만 본다(쿠폰·첫구매 예약·1인 누적 한도). */
export interface PendingOrderQuoteSignals {
  coupon?: { reason: string | null } | null;
  goods: readonly { reason: string | null }[];
  lines: readonly { optionLimit?: { reason: string | null } }[];
}

/**
 * 견적이 결제를 마치지 않은 주문 때문에 막혔을 수 있는지(ADR-0030). 결제 대기 주문은 쿠폰(사용 처리)·첫구매 예약·회원
 * 누적 구매 한도를 잡는다. 주문서·장바구니를 열기만 해서는 다른 탭의 결제를 끊지 않으므로, 이때 화면이 그 주문을 알리고
 * 고객이 누를 때만 닫는다(CheckoutPendingOrderRelease).
 */
export function quoteMayBeBlockedByPendingOrder(quote: PendingOrderQuoteSignals): boolean {
  const couponReason = quote.coupon?.reason ?? null;
  return couponErrorNeedsPendingOrder(couponReason) || couponReason === 'coupon_already_used'
    || quote.goods.some((good) => good.reason === 'member_purchase_limit_exceeded')
    || quote.lines.some((line) => line.optionLimit?.reason === 'option_member_limit_exceeded');
}

/** 거래 런타임 견적의 막힘 가운데 결제 대기 주문이 원인일 수 있는 사유(구매 한도·쿠폰). */
export function transactionIssuesMayBeBlockedByPendingOrder(issues: readonly { code: string }[]): boolean {
  return issues.some((issue) => issue.code === 'purchase_limit' || issue.code === 'coupon_unavailable');
}

/** 거래 런타임 견적이 지금 주문할 수 없다고 한 굿즈(판매기간·재고). 본인 결제 대기 주문이 그 재고를 잡고 있을 수 있다. */
export function transactionIssueStockGoodIds(issues: readonly { code: string; goodId?: string | null }[]): string[] {
  return [...new Set(issues.flatMap((issue) => (issue.code === 'goods_unavailable' && issue.goodId ? [issue.goodId] : [])))];
}

/** 견적이 지금 고른 줄을 옵션별 수량까지 그대로 덮는지. 다른 선택·바뀌기 전 수량의 견적으로 줄을 빼거나 체크를 풀지 않는다. */
export function quoteCoversSelection(
  selected: readonly Pick<CartItem, 'goodId' | 'variantId' | 'qty' | 'customInputs'>[],
  quote: { readonly lines: readonly Pick<GoodsSalesQuoteLine, 'goodId' | 'variantId' | 'qty'>[] },
): boolean {
  const chosen = new Map<string, number>();
  for (const item of selected) {
    const key = cartItemKey(item.goodId, item.variantId);
    chosen.set(key, (chosen.get(key) ?? 0) + item.qty);
  }
  const quoted = new Map(quote.lines.map((line) => [cartItemKey(line.goodId, line.variantId), line.qty]));
  return chosen.size === quoted.size && [...chosen].every(([key, qty]) => quoted.get(key) === qty);
}

/** 견적이 판정한 줄 단위 불가 — 화면을 연 뒤의 품절·판매기간 종료·재고 부족(ADR-0030 확정 동작 2). */
export interface QuoteLineExclusion {
  readonly message: string;
  /** 남은 재고가 있어 수량을 줄이면 다시 고를 수 있다. */
  readonly reducible: boolean;
  /** 재고가 고른 수량보다 적다 — 본인 결제 대기 주문이 그 재고를 잡고 있으면 해소 안내 대상이다. */
  readonly stockShort: boolean;
}

/** 견적 제외의 키. 줄 식별에 수량을 더한다 — 고객이 수량을 바꾸면 그 줄을 다시 고를 수 있고 견적이 다시 판정한다. */
export function quoteExclusionKey(line: Pick<CartItem, 'goodId' | 'variantId' | 'customInputs' | 'qty'>): string {
  return `${cartLineKey(line)}|${line.qty}`;
}

/**
 * 견적이 '이 줄은 지금 주문할 수 없다'고 판정한 고른 줄(ADR-0030 확정 동작 2 — 주문할 수 없는 줄은 선택에서 자동으로 빠지고
 * 전체 주문을 막지 않는다). 줄 단위 불가(품절·판매기간 종료·재고 부족)만 여기 온다 — 그 줄은 체크할 수 없게 빼고 사유를 줄에
 * 보인다. 견적 줄은 옵션 단위라 같은 옵션의 직접입력 줄은 함께 빠진다. 구매 수량 조건은 quoteLimitNotes다.
 */
export function quoteUnavailableLines(
  selected: readonly CartItem[],
  quote: { readonly lines: readonly GoodsSalesQuoteLine[] },
): Map<string, QuoteLineExclusion> {
  const excluded = new Map<string, QuoteLineExclusion>();
  const quoteLines = new Map(quote.lines.map((line) => [cartItemKey(line.goodId, line.variantId), line]));
  for (const item of selected) {
    const line = quoteLines.get(cartItemKey(item.goodId, item.variantId));
    if (!line || line.available) continue;
    const left = line.supply?.availableQty ?? 0;
    const reducible = left > 0 && left < line.qty;
    excluded.set(quoteExclusionKey(item), {
      message: reducible
        ? `재고가 ${left}개만 남아 이번 주문에서 빠졌어요. 수량을 줄이면 다시 고를 수 있어요.`
        : '판매 상태나 재고가 바뀌어 이번 주문에서 빠졌어요.',
      reducible,
      stockShort: line.supply ? left < line.qty : false,
    });
  }
  return excluded;
}

/** 굿즈 단위 구매 조건 사유의 줄 안내. 한도 수치가 있으면 그 수로 말하고, 남은 한도가 없으면 수량 조정을 권하지 않는다. */
export function goodsLimitNoteMessage(good: GoodsSalesQuoteGood): string | null {
  switch (good.reason) {
    case null:
      return null;
    case 'order_quantity_above_maximum':
      return good.maxOrderQty !== null
        ? `주문당 최대 ${good.maxOrderQty}개까지 구매할 수 있어요. 옵션을 합해 ${good.maxOrderQty}개 이하로 골라주세요.`
        : goodsPurchaseReasonMessage(good.reason);
    case 'order_quantity_below_minimum':
      return good.minOrderQty !== null
        ? `최소 ${good.minOrderQty}개부터 구매할 수 있어요. 옵션을 합해 ${good.minOrderQty}개 이상 골라주세요.`
        : goodsPurchaseReasonMessage(good.reason);
    case 'member_purchase_limit_exceeded':
      if (good.memberRemainingQty === 0) {
        return `회원 누적 구매 한도${good.memberLifetimeQtyLimit !== null ? `(${good.memberLifetimeQtyLimit}개)` : ''}에 도달했어요.`;
      }
      return good.memberRemainingQty !== null
        ? `회원 누적 구매 한도로 ${good.memberRemainingQty}개까지 더 구매할 수 있어요. 수량을 줄여 골라주세요.`
        : goodsPurchaseReasonMessage(good.reason);
    default:
      return goodsPurchaseReasonMessage(good.reason);
  }
}

/** 견적이 판정한 굿즈·옵션 단위 구매 조건(ADR-0030 · UI 재리뷰). 키는 굿즈 id다. */
export interface QuoteLimitNote {
  /** 체크를 풀 줄(줄 키)과 그 줄에 보일 사유. */
  readonly lines: ReadonlyMap<string, string>;
  /** 회원 누적 한도처럼 결제 대기 주문이 원인일 수 있다. */
  readonly pendingOrderMayBlock: boolean;
}

/**
 * 견적이 이번 선택의 수량을 문제 삼은 줄 — 주문당 최소·최대 수량, 회원 누적 한도(굿즈 사유는 그 굿즈의 고른 줄 모두), 옵션별
 * 한도(옵션 사유는 그 옵션의 고른 줄). 줄 자체는 살 수 있으므로 비활성으로 빼지 않는다: 화면은 그 줄의 체크만 풀고 사유를
 * 보이며, 고객이 일부 줄을 다시 고르면 그 선택으로 다시 견적한다(한도 안이면 주문할 수 있다). 줄 단위 불가가 우선이다.
 */
export function quoteLimitNotes(
  selected: readonly CartItem[],
  quote: { readonly lines: readonly GoodsSalesQuoteLine[]; readonly goods: readonly GoodsSalesQuoteGood[] },
  optionName: (item: CartItem) => string,
): Map<string, QuoteLimitNote> {
  const notes = new Map<string, { lines: Map<string, string>; pendingOrderMayBlock: boolean }>();
  const quoteLines = new Map(quote.lines.map((line) => [cartItemKey(line.goodId, line.variantId), line]));
  const goods = new Map(quote.goods.map((good) => [good.goodId, good]));
  for (const item of selected) {
    const line = quoteLines.get(cartItemKey(item.goodId, item.variantId));
    if (line && !line.available) continue;
    const good = goods.get(item.goodId);
    const goodMessage = good ? goodsLimitNoteMessage(good) : null;
    const optionReason = line?.optionLimit?.reason ?? null;
    const message = goodMessage
      ?? (optionReason ? quoteLineOptionLimitMessage(line, optionName(item)) ?? '옵션 구매 한도를 확인해주세요.' : null);
    if (!message) continue;
    const note = notes.get(item.goodId) ?? { lines: new Map<string, string>(), pendingOrderMayBlock: false };
    note.lines.set(cartLineKey(item), message);
    note.pendingOrderMayBlock ||= goodMessage ? good?.reason === 'member_purchase_limit_exceeded' : optionReason === 'option_member_limit_exceeded';
    notes.set(item.goodId, note);
  }
  return notes;
}

/** 장바구니 줄 하나의 식별·수량·체크 — 굿즈 줄 집합 서명의 재료. */
export interface CartLineCheckState {
  readonly goodId: string;
  readonly key: string;
  readonly qty: number;
  readonly checked: boolean;
}

/**
 * 굿즈 줄 집합의 서명 — 그 굿즈의 장바구니 줄(줄 키·수량)과 체크. 구매 조건 사유를 받은 뒤 이 값이 바뀌면(체크·해제·삭제·
 * 수량 변경) 사유는 낡은 것이라 바로 지운다 — 바뀐 선택은 다음 견적이 다시 판정한다.
 */
export function cartGoodSignature(lines: readonly CartLineCheckState[], goodId: string): string {
  return lines
    .filter((line) => line.goodId === goodId)
    .map((line) => `${line.key}|${line.qty}|${line.checked ? 'on' : 'off'}`)
    .sort()
    .join('\n');
}

/** 고객이 '결제 대기 주문 취소하고 계속'을 확인하기 전에 보는 결제 대기 주문(ADR-0030, service_list_unpaid_checkout_orders). */
export interface UnpaidCheckoutOrder {
  readonly id: string;
  readonly orderNumber: string | null;
  readonly total: number;
  readonly itemName: string | null;
  readonly itemCount: number;
  readonly goodIds: readonly string[];
  /** 닫을 수 있다. false면 결제 승인을 확인하고 있거나 결과를 알 수 없어 닫지 않는다. */
  readonly releasable: boolean;
}

const UNPAID_ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 목록 RPC 응답. 모양이 하나라도 틀리면 null — 화면은 해소 안내 없이 사유만 보인다. */
export function parseUnpaidCheckoutOrders(value: unknown): UnpaidCheckoutOrder[] | null {
  if (!Array.isArray(value) || value.length > 20) return null;
  const orders: UnpaidCheckoutOrder[] = [];
  for (const row of value) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
    const order = row as Record<string, unknown>;
    if (typeof order.id !== 'string' || !UNPAID_ORDER_ID.test(order.id)
      || (order.orderNumber !== null && typeof order.orderNumber !== 'string')
      || typeof order.total !== 'number' || !Number.isSafeInteger(order.total) || order.total < 0
      || (order.itemName !== null && typeof order.itemName !== 'string')
      || typeof order.itemCount !== 'number' || !Number.isSafeInteger(order.itemCount) || order.itemCount < 0
      || !Array.isArray(order.goodIds) || order.goodIds.some((goodId) => typeof goodId !== 'string')
      || typeof order.releasable !== 'boolean') return null;
    orders.push({
      id: order.id.toLowerCase(),
      orderNumber: order.orderNumber as string | null,
      total: order.total,
      itemName: order.itemName as string | null,
      itemCount: order.itemCount,
      goodIds: order.goodIds as string[],
      releasable: order.releasable,
    });
  }
  return orders;
}

/**
 * 지금 막힘의 원인일 수 있는 결제 대기 주문. 쿠폰·첫구매 혜택·회원 누적 한도는 어느 결제 대기 주문이든 잡을 수 있고(holdsBenefits),
 * 재고 부족은 그 굿즈를 담은 주문만 잡는다(stockGoodIds).
 */
export function relevantUnpaidCheckoutOrders(
  orders: readonly UnpaidCheckoutOrder[],
  { holdsBenefits, stockGoodIds }: { holdsBenefits: boolean; stockGoodIds: readonly string[] },
): UnpaidCheckoutOrder[] {
  if (holdsBenefits) return [...orders];
  const stock = new Set(stockGoodIds);
  return orders.filter((order) => order.goodIds.some((goodId) => stock.has(goodId)));
}

/** 확인창의 주문 한 줄 요약 — 첫 굿즈 이름과 나머지 품목 수. */
export function unpaidCheckoutOrderSummary(order: Pick<UnpaidCheckoutOrder, 'itemName' | 'itemCount'>): string {
  const name = order.itemName?.trim() || '굿즈';
  return order.itemCount > 1 ? `${name} 외 ${order.itemCount - 1}건` : name;
}

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

/**
 * 막힘의 원인일 수 있는 결제 대기 주문을 고르는 조건(ADR-0030). 결제 대기 주문은 그 주문이 담은 굿즈·옵션의 재고와 회원 누적
 * 한도, 그 주문이 쓴 쿠폰만 잡는다 — 그래서 막힘마다 그 굿즈·옵션·쿠폰을 담은(쓴) 주문만 원인으로 본다. 어느 결제 대기 주문이든
 * 원인일 수 있는 것은 첫구매 예약뿐이다. 원인 주문이 없으면 화면은 해소 안내 없이 사유만 보인다.
 */
export interface PendingOrderCauses {
  /** 첫구매 쿠폰이 결제 대기 주문에 예약돼 있다(DB coupon_first_purchase_reserved·pending). */
  readonly firstPurchase?: boolean;
  /** 이 보유 쿠폰을 쓴 결제 대기 주문(DB coupon_already_used). */
  readonly userCouponIds?: readonly string[];
  /** 회원 누적 구매 한도에 걸린 굿즈. */
  readonly limitGoodIds?: readonly string[];
  /** 옵션별 회원 누적 한도에 걸린 옵션. */
  readonly limitVariantIds?: readonly string[];
  /** 재고가 모자란 굿즈. */
  readonly stockGoodIds?: readonly string[];
}

export type PendingOrderCauseKind = 'firstPurchase' | 'coupon' | 'limit' | 'stock';

const NO_IDS: readonly string[] = [];

/** 원인 조건을 합친다(같은 값은 한 번만). */
export function mergePendingOrderCauses(...causes: readonly PendingOrderCauses[]): PendingOrderCauses {
  const union = (pick: (cause: PendingOrderCauses) => readonly string[] | undefined) => [...new Set(causes.flatMap((cause) => pick(cause) ?? NO_IDS))].sort();
  return {
    firstPurchase: causes.some((cause) => cause.firstPurchase === true),
    userCouponIds: union((cause) => cause.userCouponIds),
    limitGoodIds: union((cause) => cause.limitGoodIds),
    limitVariantIds: union((cause) => cause.limitVariantIds),
    stockGoodIds: union((cause) => cause.stockGoodIds),
  };
}

/** 원인 조건이 하나라도 있는지. 없으면 결제 대기 주문을 읽지도 않는다. */
export function hasPendingOrderCause(causes: PendingOrderCauses): boolean {
  return causes.firstPurchase === true || [causes.userCouponIds, causes.limitGoodIds, causes.limitVariantIds, causes.stockGoodIds]
    .some((ids) => (ids?.length ?? 0) > 0);
}

/** 원인 조건의 값 비교용 열쇠(효과 의존성). */
export function pendingOrderCauseKey(causes: PendingOrderCauses): string {
  const merged = mergePendingOrderCauses(causes);
  return JSON.stringify([merged.firstPurchase, merged.userCouponIds, merged.limitGoodIds, merged.limitVariantIds, merged.stockGoodIds]);
}

/** legacy 견적의 사유에서 원인 조건을 읽는다: 쿠폰(첫구매 예약·사용 처리), 회원 누적 한도(굿즈), 옵션 누적 한도(옵션). */
export function pendingOrderCausesFromQuote(quote: {
  readonly coupon?: { readonly reason: string | null; readonly userCouponId?: string | null } | null;
  readonly goods: readonly { readonly goodId: string; readonly reason: string | null }[];
  readonly lines: readonly { readonly variantId: string; readonly optionLimit?: { readonly reason: string | null } }[];
}): PendingOrderCauses {
  const couponReason = quote.coupon?.reason ?? null;
  return {
    firstPurchase: couponErrorNeedsPendingOrder(couponReason),
    userCouponIds: couponReason === 'coupon_already_used' && quote.coupon?.userCouponId ? [quote.coupon.userCouponId] : [],
    limitGoodIds: quote.goods.flatMap((good) => (good.reason === 'member_purchase_limit_exceeded' ? [good.goodId] : [])),
    limitVariantIds: quote.lines.flatMap((line) => (line.optionLimit?.reason === 'option_member_limit_exceeded' ? [line.variantId] : [])),
  };
}

/** 거래 런타임 견적 이슈에서 원인 조건을 읽는다: 구매 한도(그 굿즈), 쿠폰(지금 고른 쿠폰), 지금 주문할 수 없음(그 굿즈 재고). */
export function pendingOrderCausesFromTransactionIssues(
  issues: readonly { readonly code: string; readonly goodId?: string | null }[],
  selectedUserCouponIds: readonly string[],
): PendingOrderCauses {
  return {
    limitGoodIds: issues.flatMap((issue) => (issue.code === 'purchase_limit' && issue.goodId ? [issue.goodId] : [])),
    userCouponIds: issues.some((issue) => issue.code === 'coupon_unavailable') ? selectedUserCouponIds : [],
    stockGoodIds: transactionIssueStockGoodIds(issues),
  };
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
  /** 결제 대기 주문 원인 조건: 회원 누적 한도에 걸린 굿즈·옵션별 누적 한도에 걸린 옵션. */
  readonly pendingCauses: PendingOrderCauses;
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
  const notes = new Map<string, { lines: Map<string, string>; pendingOrderMayBlock: boolean; limitGoodIds: Set<string>; limitVariantIds: Set<string> }>();
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
    const note = notes.get(item.goodId)
      ?? { lines: new Map<string, string>(), pendingOrderMayBlock: false, limitGoodIds: new Set<string>(), limitVariantIds: new Set<string>() };
    note.lines.set(cartLineKey(item), message);
    if (goodMessage ? good?.reason === 'member_purchase_limit_exceeded' : optionReason === 'option_member_limit_exceeded') {
      note.pendingOrderMayBlock = true;
      if (goodMessage) note.limitGoodIds.add(item.goodId);
      else note.limitVariantIds.add(item.variantId);
    }
    notes.set(item.goodId, note);
  }
  return new Map([...notes].map(([goodId, note]) => [goodId, {
    lines: note.lines,
    pendingOrderMayBlock: note.pendingOrderMayBlock,
    pendingCauses: { limitGoodIds: [...note.limitGoodIds], limitVariantIds: [...note.limitVariantIds] },
  }]));
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
  /** 담긴 옵션(옵션별 누적 한도의 원인 판정). */
  readonly variantIds: readonly string[];
  /** 이 주문이 쓴 보유 쿠폰(쿠폰 사용 처리의 원인 판정). */
  readonly userCouponIds: readonly string[];
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
      || !Array.isArray(order.variantIds) || order.variantIds.some((variantId) => typeof variantId !== 'string' || !UNPAID_ORDER_ID.test(variantId))
      || !Array.isArray(order.userCouponIds) || order.userCouponIds.some((couponId) => typeof couponId !== 'string' || !UNPAID_ORDER_ID.test(couponId))
      || typeof order.releasable !== 'boolean') return null;
    orders.push({
      id: order.id.toLowerCase(),
      orderNumber: order.orderNumber as string | null,
      total: order.total,
      itemName: order.itemName as string | null,
      itemCount: order.itemCount,
      goodIds: order.goodIds as string[],
      variantIds: (order.variantIds as string[]).map((variantId) => variantId.toLowerCase()),
      userCouponIds: (order.userCouponIds as string[]).map((couponId) => couponId.toLowerCase()),
      releasable: order.releasable,
    });
  }
  return orders;
}

/** 이 결제 대기 주문이 지금 막힘의 원인일 수 있는 이유(첫구매 예약·쿠폰·구매 한도·재고). 없으면 원인이 아니다. */
export function unpaidOrderCauseKinds(order: UnpaidCheckoutOrder, causes: PendingOrderCauses): PendingOrderCauseKind[] {
  const has = (ids: readonly string[] | undefined, values: readonly string[]) => Boolean(ids?.length) && values.some((value) => ids!.includes(value));
  const kinds: PendingOrderCauseKind[] = [];
  if (causes.firstPurchase) kinds.push('firstPurchase');
  if (has(causes.userCouponIds?.map((id) => id.toLowerCase()), order.userCouponIds)) kinds.push('coupon');
  if (has(causes.limitGoodIds, order.goodIds) || has(causes.limitVariantIds?.map((id) => id.toLowerCase()), order.variantIds)) kinds.push('limit');
  if (has(causes.stockGoodIds, order.goodIds)) kinds.push('stock');
  return kinds;
}

/** 지금 막힘의 원인일 수 있는 결제 대기 주문 — 그 굿즈·옵션·쿠폰을 담은(쓴) 주문, 첫구매 예약이면 모든 결제 대기 주문. */
export function relevantUnpaidCheckoutOrders(orders: readonly UnpaidCheckoutOrder[], causes: PendingOrderCauses): UnpaidCheckoutOrder[] {
  return orders.filter((order) => unpaidOrderCauseKinds(order, causes).length > 0);
}

const CAUSE_LABELS: Record<PendingOrderCauseKind, string> = { coupon: '쿠폰', firstPurchase: '첫구매 혜택', limit: '구매 한도', stock: '재고' };

/** 받침이 있으면 '을', 없으면 '를'. */
function objectParticle(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return code >= 0 && code < 11172 && code % 28 !== 0 ? '을' : '를';
}

/** 해소 상자의 안내: 원인 주문 건수와 그 주문들이 잡은 것. 첫구매 예약은 어느 주문인지 몰라 '있을 수 있어요'로 말한다. */
export function unpaidOrderCauseMessage(orders: readonly UnpaidCheckoutOrder[], causes: PendingOrderCauses): string {
  const kinds = new Set(orders.flatMap((order) => unpaidOrderCauseKinds(order, causes)));
  const count = orders.length;
  const only = kinds.size === 1 ? [...kinds][0] : null;
  if (only === 'coupon') return `결제 대기 주문 ${count}건이 이 쿠폰을 쓰고 있어요.`;
  if (only === 'firstPurchase') return `결제 대기 주문 ${count}건이 첫구매 혜택을 잡고 있을 수 있어요.`;
  if (only === 'limit') return `결제 대기 주문 ${count}건이 이 굿즈의 구매 한도를 잡고 있어요.`;
  if (only === 'stock') return `결제 대기 주문 ${count}건이 이 굿즈의 재고를 잡고 있어요.`;
  const labels = (['coupon', 'firstPurchase', 'limit', 'stock'] as const).filter((kind) => kinds.has(kind)).map((kind) => CAUSE_LABELS[kind]);
  const subject = labels.join('·') || '혜택';
  return `결제 대기 주문 ${count}건이 ${subject}${objectParticle(subject)} 잡고 있${kinds.has('firstPurchase') ? '을 수 있' : ''}어요.`;
}

/** 확인창의 주문 한 줄 요약 — 첫 굿즈 이름과 나머지 품목 수. */
export function unpaidCheckoutOrderSummary(order: Pick<UnpaidCheckoutOrder, 'itemName' | 'itemCount'>): string {
  const name = order.itemName?.trim() || '굿즈';
  return order.itemCount > 1 ? `${name} 외 ${order.itemCount - 1}건` : name;
}

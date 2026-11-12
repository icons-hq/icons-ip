import { cartItemKey, type CartItem } from './cart';
import { couponErrorNeedsPendingOrder } from './coupons';
import { goodsCustomInputValues } from './goods-custom-inputs';
import { goodsPurchaseReasonMessage, quoteLineOptionLimitMessage, type GoodsSalesQuoteGood, type GoodsSalesQuoteLine } from './goods-sales';

/*
 * 장바구니 선택 주문·선택 삭제의 순수 판정(ADR-0030 · 10/14 회의 1014-031·035·036, SHEET-007).
 *
 * 화면은 고객이 체크를 푼 줄만 기억한다. 그래서 장바구니에 들어오면 전체가 체크된 채 열리고(지금 동작 보존),
 * 다른 탭에서 새로 담겨 동기화된 줄도 체크된 채 보인다. 주문할 수 없는 줄(품절·판매기간 밖·성인 인증 전 등)은
 * 선택에서 자동으로 빠지고 체크할 수 없다 — 나머지 줄의 주문을 막지 않는다.
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

/** 견적이 판정해 선택에서 뺀 줄의 사유(ADR-0030 확정 동작 2). */
export interface QuoteLineExclusion {
  readonly message: string;
  /** 회원 누적 한도처럼 결제 대기 주문이 원인일 수 있다 — 화면이 그 주문을 알리고 고객이 누를 때만 닫는다. */
  readonly pendingOrderMayBlock: boolean;
}

/** 견적 제외의 키. 줄 식별에 수량을 더한다 — 고객이 수량을 바꾸면 그 줄을 다시 고를 수 있고 견적이 다시 판정한다. */
export function quoteExclusionKey(line: Pick<CartItem, 'goodId' | 'variantId' | 'customInputs' | 'qty'>): string {
  return `${cartLineKey(line)}|${line.qty}`;
}

/** 견적이 지금 고른 줄(옵션 단위)을 그대로 덮는지. 다른 선택의 견적으로 줄을 빼지 않는다. */
export function quoteCoversSelection(selected: readonly Pick<CartItem, 'goodId' | 'variantId'>[], quote: { readonly lines: readonly Pick<GoodsSalesQuoteLine, 'goodId' | 'variantId'>[] }): boolean {
  const chosen = new Set(selected.map((item) => cartItemKey(item.goodId, item.variantId)));
  const quoted = new Set(quote.lines.map((line) => cartItemKey(line.goodId, line.variantId)));
  return chosen.size === quoted.size && [...chosen].every((key) => quoted.has(key));
}

/**
 * 견적이 판정한 '주문할 수 없는 줄'(ADR-0030 확정 동작 2 — 주문할 수 없는 줄은 선택에서 자동으로 빠지고 전체 주문을 막지
 * 않는다). 화면을 연 뒤의 품절·판매기간 종료·재고 부족(줄 불가), 회원 누적 한도·주문당 수량(굿즈 사유 — 그 굿즈의 고른 줄
 * 모두), 옵션별 한도(옵션 사유)를 받은 고른 줄을 사유와 함께 돌려준다. 견적 줄은 옵션 단위라 같은 옵션의 직접입력 줄은 함께 빠진다.
 */
export function quoteExcludedLines(
  selected: readonly CartItem[],
  quote: { readonly lines: readonly GoodsSalesQuoteLine[]; readonly goods: readonly GoodsSalesQuoteGood[] },
  optionName: (item: CartItem) => string,
): Map<string, QuoteLineExclusion> {
  const excluded = new Map<string, QuoteLineExclusion>();
  const quoteLines = new Map(quote.lines.map((line) => [cartItemKey(line.goodId, line.variantId), line]));
  const goodReasons = new Map(quote.goods.flatMap((good) => (good.reason ? [[good.goodId, good.reason] as const] : [])));
  for (const item of selected) {
    const line = quoteLines.get(cartItemKey(item.goodId, item.variantId));
    const goodReason = goodReasons.get(item.goodId);
    let exclusion: QuoteLineExclusion | null = null;
    if (line && !line.available) {
      const left = line.supply?.availableQty ?? 0;
      exclusion = {
        message: left > 0 && left < line.qty
          ? `재고가 ${left}개만 남아 이번 주문에서 빠졌어요. 수량을 줄이면 다시 고를 수 있어요.`
          : '판매 상태나 재고가 바뀌어 이번 주문에서 빠졌어요.',
        pendingOrderMayBlock: false,
      };
    } else if (goodReason) {
      exclusion = { message: goodsPurchaseReasonMessage(goodReason), pendingOrderMayBlock: goodReason === 'member_purchase_limit_exceeded' };
    } else if (line?.optionLimit?.reason) {
      exclusion = {
        message: quoteLineOptionLimitMessage(line, optionName(item)) ?? '옵션 구매 한도를 확인해주세요.',
        pendingOrderMayBlock: line.optionLimit.reason === 'option_member_limit_exceeded',
      };
    }
    if (exclusion) excluded.set(quoteExclusionKey(item), exclusion);
  }
  return excluded;
}

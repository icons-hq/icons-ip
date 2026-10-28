/**
 * 옵션 판매 규칙(D7② 옵션별 구매 제한)의 타입·파서·문구.
 *
 * 진실원은 DB다. 주문당·1인 누적 한도는 `order_items` BEFORE INSERT 트리거
 * (`private.guard_order_item_variant_purchase_limit`)가 막고, 여기 값은 안내용이다.
 * - 옵션 컬럼: `goods_variants.order_max_qty`·`member_max_qty`(양의 정수, null = 제한 없음).
 * - legacy 장바구니 견적 `quote_goods_sales`의 `lines[].optionLimit`.
 * - 주문 생성 거절: `option_order_limit_exceeded: <variantId>`·`option_member_limit_exceeded: <variantId>`.
 */

export type GoodsOptionLimitReason = 'option_order_limit_exceeded' | 'option_member_limit_exceeded';

export interface GoodsOptionLimitPolicy {
  /** 한 주문의 같은 옵션 수량 합 상한. null = 제한 없음. */
  orderMaxQty: number | null;
  /** 같은 회원의 취소 완료가 아닌 주문(결제 대기 포함) 누적 상한. null = 제한 없음. */
  memberMaxQty: number | null;
}

/** 견적 `lines[].optionLimit`. 회원 누적 값은 로그인했고 memberMaxQty가 있을 때만 있다. */
export interface GoodsOptionLimit extends GoodsOptionLimitPolicy {
  memberReservedQty: number | null;
  memberRemainingQty: number | null;
  reason: GoodsOptionLimitReason | null;
}

const OPTION_LIMIT_REASONS = new Set<GoodsOptionLimitReason>(['option_order_limit_exceeded', 'option_member_limit_exceeded']);

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function positiveOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
}
function nonnegativeOrNull(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

export function parseGoodsOptionLimit(value: unknown): GoodsOptionLimit | null {
  if (!record(value) || !positiveOrNull(value.orderMaxQty) || !positiveOrNull(value.memberMaxQty)
    || !nonnegativeOrNull(value.memberReservedQty) || !nonnegativeOrNull(value.memberRemainingQty)
    || (value.reason !== null && !OPTION_LIMIT_REASONS.has(value.reason as GoodsOptionLimitReason))) return null;
  if (value.memberMaxQty === null || value.memberReservedQty === null) {
    if (value.memberReservedQty !== null || value.memberRemainingQty !== null) return null;
  } else if (value.memberRemainingQty !== Math.max(0, value.memberMaxQty - value.memberReservedQty)) return null;
  return {
    orderMaxQty: value.orderMaxQty, memberMaxQty: value.memberMaxQty,
    memberReservedQty: value.memberReservedQty, memberRemainingQty: value.memberRemainingQty,
    reason: value.reason as GoodsOptionLimitReason | null,
  };
}

/** 상품 상세의 정적 안내(확정 카피). 남은 수량은 보이지 않는다. */
export function goodsOptionLimitNotices(optionName: string, limit: GoodsOptionLimitPolicy): string[] {
  const notices: string[] = [];
  if (limit.orderMaxQty !== null) notices.push(`'${optionName}'은 한 번에 ${limit.orderMaxQty}개까지 주문할 수 있습니다.`);
  if (limit.memberMaxQty !== null) notices.push(`'${optionName}'은 1인당 ${limit.memberMaxQty}개까지 구매할 수 있습니다.`);
  return notices;
}

/** 장바구니 품목 줄 안내. 견적 사유에 맞는 확정 카피 한 문장. */
export function goodsOptionLimitMessage(reason: GoodsOptionLimitReason, optionName: string, limit: GoodsOptionLimitPolicy): string {
  const max = reason === 'option_order_limit_exceeded' ? limit.orderMaxQty : limit.memberMaxQty;
  return reason === 'option_order_limit_exceeded'
    ? `'${optionName}'은 한 번에 ${max}개까지 주문할 수 있습니다.`
    : `'${optionName}'은 1인당 ${max}개까지 구매할 수 있습니다.`;
}

/** 주문 생성이 거절됐을 때(장바구니 안내 뒤의 경합) 주문서 문구. DB 오류에는 옵션 이름이 없다. */
export const PLACE_ORDER_OPTION_LIMIT_MESSAGES: Record<GoodsOptionLimitReason, string> = {
  option_order_limit_exceeded: '한 번에 주문할 수 있는 수량이 정해진 옵션이 있어요. 장바구니에서 수량을 다시 확인해주세요.',
  option_member_limit_exceeded: '1인당 구매 수량이 정해진 옵션이 있어요. 결제 대기 중인 주문도 포함됩니다. 장바구니에서 수량을 다시 확인해주세요.',
};

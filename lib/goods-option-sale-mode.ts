/**
 * 옵션 판매 규칙의 타입·파서·문구 — D5② 랜덤 판매(R24)와 D7② 옵션별 구매 제한.
 *
 * 진실원은 DB다. 여기 값은 화면 안내와 오류 문구용이다.
 *
 * 랜덤 판매(`goods.option_sale_mode = 'random'`):
 * - 고객은 기본 옵션(is_default) 한 줄로 담고, 주문 생성 때 DB(`private.allocate_random_option_items`)가 같은 굿즈의 활성 옵션
 *   재고에 비례해 무작위로 배정한다. 배정 결과는 고객에게 숨긴다 — `order_items`의 랜덤 행은 고객 직접 select에서 빠지고
 *   (restrictive RLS), 고객 화면은 `my_order_items` RPC(옵션명 '랜덤')로 읽는다.
 * - 운영자 setter `admin_set_goods_option_sale_mode(p_good_id, p_mode, p_expected_updated_at)`, 조회 `admin_goods_option_sale_mode(p_good_id)`.
 *
 * 옵션별 구매 제한:
 * - 주문당·1인 누적 한도는 `order_items` BEFORE INSERT 트리거(`private.guard_order_item_variant_purchase_limit`)가 막는다.
 * - 옵션 컬럼: `goods_variants.order_max_qty`·`member_max_qty`(양의 정수, null = 제한 없음).
 * - legacy 장바구니 견적 `quote_goods_sales`의 `lines[].optionLimit`.
 * - 주문 생성 거절: `option_order_limit_exceeded: <variantId>`·`option_member_limit_exceeded: <variantId>`.
 */

export type GoodsOptionSaleMode = 'select' | 'random';

export function isGoodsOptionSaleMode(value: unknown): value is GoodsOptionSaleMode {
  return value === 'select' || value === 'random';
}

/** 고객 화면의 옵션 표기(확정 카피). */
export const RANDOM_OPTION_LABEL = '랜덤';
/** 상품 상세 안내(확정 카피). */
export const RANDOM_OPTION_NOTICE = '옵션은 주문 후 재고에서 무작위로 정해져 발송됩니다. 같은 옵션이 중복될 수 있습니다.';
/** 주문 생성이 random_option_unavailable로 거절됐을 때 주문서 문구. */
export const PLACE_ORDER_RANDOM_OPTION_MESSAGE = '랜덤 판매 조건이 바뀐 굿즈가 있어요. 장바구니에서 다시 확인해주세요.';

/** `private.goods_random_option_problem`이 돌려주는 랜덤 판매 불가 사유(setter 거절·커밋 거절 메시지와 같다). */
export const RANDOM_OPTION_PROBLEMS = [
  'random_option_count',
  'random_option_default_inactive',
  'random_option_preorder',
  'random_option_price_mismatch',
  'random_option_variant_limits',
  'random_option_custom_inputs',
  'random_option_aggregation',
  'random_option_group',
] as const;
export type RandomOptionProblem = typeof RANDOM_OPTION_PROBLEMS[number];

/* 운영자 화면 어휘는 '상품'·'옵션'이다. */
const RANDOM_OPTION_PROBLEM_MESSAGES: Record<RandomOptionProblem, string> = {
  random_option_count: '판매 중인 옵션이 2개 이상이어야 랜덤 판매를 쓸 수 있습니다.',
  random_option_default_inactive: '첫 번째(기본) 옵션이 판매 중이어야 랜덤 판매를 쓸 수 있습니다.',
  random_option_preorder: '예약판매 옵션이 있으면 랜덤 판매를 쓸 수 없습니다.',
  random_option_price_mismatch: '랜덤 판매 상품은 판매 중인 모든 옵션의 판매가와 기간 할인이 같아야 합니다. 기간 할인은 모든 옵션에 한 번에 넣으세요.',
  random_option_variant_limits: '랜덤 판매 상품은 옵션별 구매 제한을 쓸 수 없습니다.',
  random_option_custom_inputs: '직접 입력 옵션이 있으면 랜덤 판매를 쓸 수 없습니다.',
  random_option_aggregation: '옵션을 상품으로 나눈 이력이 있는 상품은 랜덤 판매를 쓸 수 없습니다.',
  random_option_group: '그룹상품에 묶인 상품은 랜덤 판매를 쓸 수 없습니다.',
};

/**
 * setter·옵션 저장·기간 할인 저장이 랜덤 조건으로 거절됐을 때의 운영자 문구. DB 메시지를 그대로 받아도 된다.
 * 상품 저장 액션(`app/admin/actions.ts`)도 같은 함수로 random_option_* 거절을 옮길 수 있다.
 */
export function goodsOptionSaleModeErrorMessage(message: string): string {
  const problem = RANDOM_OPTION_PROBLEMS.find((code) => message.includes(code));
  if (problem) return RANDOM_OPTION_PROBLEM_MESSAGES[problem];
  if (message.includes('goods_changed')) return '다른 곳에서 상품이 바뀌었습니다. 새로고침한 뒤 다시 시도하세요.';
  if (message.includes('operator_capability_required') || message.includes('forbidden')) return '상품 판매 방식을 바꿀 권한이 없습니다.';
  if (message.includes('catalog_archived')) return '보관된 상품은 판매 방식을 바꿀 수 없습니다.';
  if (message.includes('good_not_found')) return '상품을 찾지 못했습니다.';
  return '판매 방식을 바꾸지 못했습니다. 잠시 후 다시 시도하세요.';
}

/** `admin_goods_option_sale_mode` 응답. randomProblem이 null이면 지금 랜덤 판매로 바꿀 수 있다. */
export interface GoodsOptionSaleModeState {
  goodId: string;
  optionSaleMode: GoodsOptionSaleMode;
  updatedAt: string;
  randomProblem: RandomOptionProblem | null;
  activeOptionCount: number;
}

export function parseGoodsOptionSaleModeState(value: unknown): GoodsOptionSaleModeState | null {
  if (!record(value) || typeof value.goodId !== 'string' || !value.goodId || !isGoodsOptionSaleMode(value.optionSaleMode)
    || typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))
    || (value.randomProblem !== null && !RANDOM_OPTION_PROBLEMS.includes(value.randomProblem as RandomOptionProblem))
    || typeof value.activeOptionCount !== 'number' || !Number.isSafeInteger(value.activeOptionCount) || value.activeOptionCount < 0) return null;
  return {
    goodId: value.goodId, optionSaleMode: value.optionSaleMode, updatedAt: value.updatedAt,
    randomProblem: value.randomProblem as RandomOptionProblem | null, activeOptionCount: value.activeOptionCount,
  };
}

/**
 * service role로 `order_items`를 읽는 고객용 경로(메일 등)의 마스킹. RLS가 걸리지 않으므로 코드에서 가린다.
 * 랜덤 행은 옵션명 '랜덤', 옵션 코드 없음, variant_id는 장바구니 키(기본 옵션)로 바꾼다. cartVariantId를 모르면 null.
 */
export function maskCustomerOrderItem<T extends {
  variant_id: string | null;
  variant_name_snapshot: string | null;
  variant_code_snapshot?: string | null;
  option_sale_mode_snapshot: 'random' | null;
}>(row: T, cartVariantId: string | null): T {
  if (row.option_sale_mode_snapshot !== 'random') return row;
  return {
    ...row,
    variant_id: cartVariantId,
    variant_name_snapshot: RANDOM_OPTION_LABEL,
    ...('variant_code_snapshot' in row ? { variant_code_snapshot: null } : {}),
  };
}

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

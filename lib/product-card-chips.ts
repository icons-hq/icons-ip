import type { Good } from '@/lib/data';

/*
 * 상품 카드 칩(X SQUARE 스토어프런트 · 공용 부품 계약 §3).
 *
 * 카드는 가격 아래 한 줄에 칩을 그린다. 어떤 칩을 달지는 굿즈 데이터에서 이 순수 함수 하나로 정한다 — 목록·홈·검색이
 * 같은 규칙을 쓰도록 화면이 따로 판정하지 않는다. 진실원은 카탈로그 투영이고, 이 함수는 표시 정책일 뿐 돈·재고·권한을
 * 판정하지 않는다.
 */

export type ProductCardChipKind = 'preorder' | 'freeShipping' | 'random' | 'tag';

export interface ProductCardChip {
  kind: ProductCardChipKind;
  label: string;
}

export const PRODUCT_CARD_CHIP_LABELS = {
  preorder: '예약판매',
  freeShipping: '무료배송',
  random: '캡슐토이',
} as const satisfies Record<Exclude<ProductCardChipKind, 'tag'>, string>;

/**
 * 순서: 예약판매 → 무료배송 → 캡슐토이 → 운영 배지.
 *
 * - 예약판매: 옵션 하나라도 예약 접수 중이고 남은 물량이 있다(`preorderSupplyLabel`이 '예약판매'를 돌려주는 판정과 같다).
 * - 무료배송: `shippingFeeType === 'free'`. 필드가 없는 옛 투영·목업은 칩을 그리지 않는다.
 * - 캡슐토이: 랜덤 판매(ADR-0027) 굿즈. 옵션이 주문 때 무작위로 배정되는 상품이다.
 * - 운영 배지: 저장된 `badge`(NEW·EXCLUSIVE) 그대로. 스토어 표시 설정이 태그를 끄면(`showTags: false`) 뺀다.
 *
 * SALE 은 칩이 아니다 — 할인은 가격 줄의 할인율이 대신한다.
 */
export function productCardChips(
  good: Pick<Good, 'options' | 'optionSaleMode' | 'badge' | 'shippingFeeType'>,
  options: { showTags?: boolean } = {},
): ProductCardChip[] {
  const chips: ProductCardChip[] = [];
  const preorderOpen = good.options?.some((option) => {
    const supply = option.supply;
    return supply?.mode === 'preorder' && supply.state === 'open' && supply.availableQty > 0;
  });
  if (preorderOpen) chips.push({ kind: 'preorder', label: PRODUCT_CARD_CHIP_LABELS.preorder });
  if (good.shippingFeeType === 'free') chips.push({ kind: 'freeShipping', label: PRODUCT_CARD_CHIP_LABELS.freeShipping });
  if (good.optionSaleMode === 'random') chips.push({ kind: 'random', label: PRODUCT_CARD_CHIP_LABELS.random });
  const tag = good.badge?.trim();
  if (tag && options.showTags !== false) chips.push({ kind: 'tag', label: tag });
  return chips;
}

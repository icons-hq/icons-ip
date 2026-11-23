import type { Good, GoodOption } from '@/lib/data';
import { preorderUnavailableLabel } from '@/lib/goods-preorders';
import { goodsSaleUnavailableLabel, type GoodsSalePeriod } from '@/lib/goods-sale-period';

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

/**
 * 카드 이미지 위 판매 불가 덮개와 이름 옆 숨은 상태 문구(`ProductCard`의 `unavailableLabel`).
 *
 * 상세 구매 패널(`GoodPurchasePanel`)과 같은 순서로 판정한다 — 판매기간(시작 전·종료)이 먼저, 그다음 예약 상태다. 모든 옵션이
 * 예약 판매이고 지금 주문할 수 있는 물량이 없을 때만 예약 문구(접수 예정·물량 마감·접수 종료·접수 중지)를 돌려준다. 접수 중이고
 * 물량이 남았으면 품절이 아니라 null 이고, 그때 카드는 덮개 없이 '예약판매' 칩만 단다(`productCardChips`).
 * null 이면서 `soldOut`이면 카드는 'SOLD OUT'·'(품절)'을 그린다. 표시 정책일 뿐 주문·재고 판정은 DB가 한다.
 *
 * 홈·카테고리 추천처럼 서버가 카드 뷰모델을 만드는 곳은 서버에서, 굿즈를 그대로 받는 목록·검색·IP관 카드는 카드가 이 함수를 부른다.
 */
export function productCardUnavailableLabel(
  good: { salePeriod?: GoodsSalePeriod | null; options?: readonly Pick<GoodOption, 'stockQty' | 'supply'>[] },
  soldOut: boolean,
): string | null {
  return goodsSaleUnavailableLabel(good.salePeriod) ?? preorderUnavailableLabel(good.options, soldOut);
}

/* 굿즈 배지(어드민 '상품 표시문구')의 표준 값 (#326 migration 20260828100000).
 *
 * 배지는 DB CHECK(goods_badge_check·goods_badges_allowed)와 같은 목록이어야 한다 — 여기가 어드민 폼 선택지의
 * 진실원이고, DB 는 마지막 방어선이다.
 *
 * 한 상품에 여러 개를 고를 수 있다(2026-11-24, migration 20261125140000). goods.badges 배열 순서가 카드·상세 노출 순서이고
 * 같은 값은 한 번만이다. goods.badge 는 첫 값 거울로 남아 한 칸만 아는 옛 투영·쓰기가 계속 읽고 쓴다.
 *
 * 상품 유형은 ADR-0044로 폐기됐다. 굿즈의 종류는 대표 카테고리이고, 상품에 유형 칸이 없다.
 *
 * SALE 배지는 여기 없다 — 저장 값이 아니라 compare_at_price > price 에서
 * 파생된다(할인 없는 SALE 배지라는 모순을 스키마가 금지한다).
 */

export const GOOD_BADGES = ['NEW', 'EXCLUSIVE'] as const;

export type GoodBadge = (typeof GOOD_BADGES)[number];

export function isGoodBadge(value: unknown): value is GoodBadge {
  return typeof value === 'string' && (GOOD_BADGES as readonly string[]).includes(value);
}

/**
 * 굿즈에 단 표시문구 목록 — 고른 순서 그대로, 같은 값은 한 번만(대소문자 무시), 빈 값은 뺀다.
 *
 * `badges`(goods.badges)가 있으면 그것이 진실원이다(빈 배열이면 표시문구 없음). 그 칸을 싣지 않는 옛 투영·목업·어드민
 * 미리보기는 첫 값 거울 `badge` 하나로 읽는다. 카드 칩·상세 배지·NEW 목록·검색이 모두 이 함수로 같은 목록을 본다.
 */
export function goodBadgeList(good: { badge?: string | null; badges?: readonly string[] | null }): string[] {
  const source = Array.isArray(good.badges) ? good.badges : good.badge ? [good.badge] : [];
  const seen = new Set<string>();
  const list: string[] = [];
  for (const raw of source) {
    if (typeof raw !== 'string') continue;
    const label = raw.trim();
    const key = label.toUpperCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    list.push(label);
  }
  return list;
}

/** 표시문구 여러 개를 한 칸에 쓸 때의 구분(어드민 폼 숨은 칸 'badge'·상품 엑셀 '상품 표시문구' 열). 쉼표 또는 줄바꿈. */
const GOOD_BADGE_TEXT_SEPARATOR = /[,\n]/;

/** 표시문구 목록을 한 칸 글자로 쓴다(`NEW, EXCLUSIVE`). 어드민 폼 숨은 칸·상품 엑셀 내보내기·편집 요약이 같은 모양이다. */
export function formatGoodBadgeText(badges: readonly string[]): string {
  return badges.join(', ');
}

/**
 * 한 칸에 쓴 표시문구(`NEW, EXCLUSIVE`, 옛 한 값 `NEW` 포함)를 목록으로 읽는다. 적은 순서를 지키고, 표준 값은 대문자 표기로 맞추며,
 * 같은 값은 한 번만 남긴다. 표준 값이 아닌 글자는 `invalid`로 돌려준다 — 저장하지 않고 그 칸 오류로 알린다.
 */
export function parseGoodBadgeText(text: string): { badges: GoodBadge[]; invalid: string[] } {
  const badges: GoodBadge[] = [];
  const invalid: string[] = [];
  for (const part of text.split(GOOD_BADGE_TEXT_SEPARATOR)) {
    const label = part.trim();
    if (!label) continue;
    const value = label.toUpperCase();
    if (!isGoodBadge(value)) invalid.push(label);
    else if (!badges.includes(value)) badges.push(value);
  }
  return { badges, invalid };
}

/**
 * 카드·상세에 표기할 배지 목록 — 저장 표시문구(여러 개, 고른 순서)에 할인 파생 SALE 을 더한다.
 *
 * 할인율 표시를 끈 굿즈(#543 `show_discount_rate = false`)는 목록·상세가 취소선과 할인율 없이
 * 할인가만 보인다. 거기에 SALE 배지만 남으면 숨긴 할인을 배지가 다시 광고하는 셈이라 파생하지
 * 않는다(PD-15). 결제 금액·주문 단가와는 무관한 표시 규칙이다.
 */
export function goodDisplayBadges(good: {
  badge: string | null;
  badges?: readonly string[] | null;
  price: number;
  compareAtPrice?: number | null;
  showDiscountRate?: boolean;
}): string[] {
  /* 저장 표시문구는 고른 순서 그대로(goodBadgeList) 앞에 두고, 할인 파생 SALE 은 맨 뒤 한 번만이다. */
  const badges = goodBadgeList(good);
  if (good.showDiscountRate !== false && typeof good.compareAtPrice === 'number' && good.compareAtPrice > good.price
    && !badges.some((badge) => badge.toUpperCase() === 'SALE')) {
    badges.push('SALE');
  }
  return badges;
}

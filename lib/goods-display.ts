import type { Stock } from './data';

/* 굿즈 표시 파생. lib/ip-display.ts와 같은 자리의 module이다. */

/** 재고 배지 문구. `ok`는 배지를 띄우지 않는다는 뜻이라 null이다. */
export const STOCK_LABEL: Record<Stock, string | null> = {
  low: '품절임박',
  soldout: '품절',
  ok: null,
};

/** 굿즈 상세페이지 경로 (#173). id 는 slug 지만 경로 조립을 한 곳에 모아둔다. */
export function goodDetailHref(goodId: string): string {
  return `/shop/${encodeURIComponent(goodId)}`;
}


/* 굿즈 표시 파생. lib/ip-display.ts와 같은 자리의 module이다. */

/** 굿즈 상세페이지 경로 (#173). id 는 slug 지만 경로 조립을 한 곳에 모아둔다. */
export function goodDetailHref(goodId: string): string {
  return `/shop/${encodeURIComponent(goodId)}`;
}

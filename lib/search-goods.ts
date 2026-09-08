import type { Good } from '@/lib/data';

/* /search 의 굿즈 결과 페이지 (#326 유저 스토리 18·19 · 규모 후속).
 *
 * lib/search.ts 의 getSearchSnapshot 은 통합 검색(IP·카드·포스트·태그)용이고 그룹당
 * 6건만 준다 — 굿즈가 주 결과인 결과 페이지에는 모자란다.
 *
 * 순위(이름 → IP 이름 → 유형·배지)와 자르기는 **서버**(`storefront_goods_search`)가 한다.
 * 전에는 카탈로그 전량을 메모리에서 훑어 매겼다 — 검색 한 번에 카탈로그 전부를 나르는
 * 셈이고, 1,000개를 넘으면 그 뒤의 상품은 「검색되지 않는 상품」이 됐다. 여기 남은 것은
 * 페이지 번호를 다듬는 순수 규칙뿐이다. */

/** 검색 결과 페이지당 굿즈 수 (R-03 §2.4 — 레퍼런스 실측 40개). */
export const SEARCH_GOODS_PAGE_SIZE = 40;

export interface GoodsSearchResult {
  /** 요청 페이지 슬라이스. */
  items: Good[];
  total: number;
  /** 1-base. [1, pageCount] 로 클램프된 값이라 화면은 그대로 믿어도 된다. */
  page: number;
  /** 최소 1 — 결과가 없어도 "1페이지 중 1페이지"다. */
  pageCount: number;
}

/**
 * 서버에 묻기 전에 페이지 번호를 다듬는다.
 *
 * NaN·소수·음수 같은 URL 쓰레기가 여기까지 온다. 총 건수는 아직 모르므로 하한만 잡고,
 * 상한 클램프는 결과를 받은 뒤 `goodsSearchPage` 가 마무리한다.
 */
export function requestedGoodsSearchPage(page: number): number {
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.max(requested, 1);
}

/** 페이지 시작 offset. */
export function goodsSearchOffset(page: number): number {
  return (requestedGoodsSearchPage(page) - 1) * SEARCH_GOODS_PAGE_SIZE;
}

/**
 * 서버가 준 한 페이지를 화면 계약으로 접는다.
 *
 * 총 건수 밖의 페이지를 열면 마지막 페이지 번호로 당긴다 — 화면이 다시 방어하지 않도록
 * 여기서 끝낸다. (그 페이지의 항목은 부르는 쪽이 다시 묻는다.)
 */
export function goodsSearchPage(input: { items: Good[]; total: number; page: number }): GoodsSearchResult {
  const total = Math.max(0, input.total);
  const pageCount = Math.max(1, Math.ceil(total / SEARCH_GOODS_PAGE_SIZE));
  const page = Math.min(requestedGoodsSearchPage(input.page), pageCount);
  return { items: total === 0 ? [] : input.items, total, page, pageCount };
}

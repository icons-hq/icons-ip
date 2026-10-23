import type { CatalogCategory } from '@/lib/catalog-categories';
import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good } from '@/lib/data';
import { selectCollectionGoods, type ShopListQuery, type ShopListResult } from '@/lib/shop-catalog';

/* /search 의 굿즈 결과 선택자 (#326 유저 스토리 18·19, LFS 패리티 2차 L4 · SR-01~03).
 *
 * lib/search.ts 의 getSearchSnapshot 은 통합 검색(IP·카드·포스트·태그)용이고 그룹당
 * 6건만 준다 — 굿즈가 주 결과인 결과 페이지에는 모자란다. 여기서 카탈로그 스냅샷을
 * 직접 훑어 굿즈 전량을 매기고, 굿즈샵과 같은 필터·정렬(관련성·가격)을 얹어 페이지로 자른다.
 * 스냅샷 계약은 건드리지 않는다. 카탈로그 스냅샷은 이미 공개·미보관·판매 제한 없음만 담는다. */

/** 검색 결과 페이지당 굿즈 수 (R-03 §2.4 — 레퍼런스 실측 40개). */
export const SEARCH_GOODS_PAGE_SIZE = 40;

/** 페이지 창 크기 — 데스크톱 10칸, 767px 이하 5칸(11 §6 B8). */
export const SEARCH_PAGE_WINDOW = { wide: 10, narrow: 5 } as const;

export interface GoodsSearchResult {
  /** 요청 페이지 슬라이스. */
  items: Good[];
  total: number;
  /** 1-base. [1, pageCount] 로 클램프된 값이라 화면은 그대로 믿어도 된다. */
  page: number;
  /** 최소 1 — 결과가 없어도 "1페이지 중 1페이지"다. */
  pageCount: number;
}

/** 필터·정렬이 걸린 검색 결과 한 페이지. result.goods 는 이 페이지 슬라이스만 담는다. */
export interface SearchGoodsCollection {
  result: ShopListResult;
  page: number;
  pageCount: number;
}

/* 상수 객체를 돌려쓰면 호출부가 items 를 만졌을 때 다음 호출까지 오염된다. 매번 새로 만든다. */
function emptyResult(): GoodsSearchResult {
  return { items: [], total: 0, page: 1, pageCount: 1 };
}

function includesFold(haystack: string | null | undefined, needle: string) {
  return (haystack ?? '').toLowerCase().includes(needle);
}

function includesKeyword(keywords: readonly string[] | undefined, needle: string) {
  return (keywords ?? []).some((keyword) => includesFold(keyword, needle));
}

/**
 * 관련성 순서로 매긴 검색 스코프 — 굿즈명 > 검색 키워드 > 소속 IP 제목 > 분류·배지.
 * 순위별 버킷에 담으면 정렬 없이 카탈로그 원순서가 그대로 동순위 순서가 된다.
 * 부분일치는 문자열 포함 비교라 %·_ 같은 와일드카드가 특별한 뜻을 갖지 않는다.
 */
export function matchSearchGoods(catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>, query: string): Good[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const ipTitleById = new Map(catalog.ips.map((ip) => [ip.id, ip.title]));
  const byName: Good[] = [];
  const byKeyword: Good[] = [];
  const byIp: Good[] = [];
  const rest: Good[] = [];

  for (const good of catalog.goods) {
    if (includesFold(good.name, needle)) {
      byName.push(good);
      continue;
    }
    if (includesKeyword(good.searchKeywords, needle)) {
      byKeyword.push(good);
      continue;
    }
    if (includesFold(ipTitleById.get(good.ip), needle)) {
      byIp.push(good);
      continue;
    }
    if (includesFold(good.type, needle) || includesFold(good.badge, needle)) {
      rest.push(good);
    }
  }

  return [...byName, ...byKeyword, ...byIp, ...rest];
}

/* NaN·소수·음수 같은 URL 쓰레기가 여기까지 온다. 화면이 다시 방어하지 않도록 여기서 끝낸다. */
function clampPage(page: number, pageCount: number) {
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  return Math.min(Math.max(requested, 1), pageCount);
}

export function searchGoods(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>,
  query: string,
  page: number,
): GoodsSearchResult {
  const matched = matchSearchGoods(catalog, query);
  const total = matched.length;
  if (total === 0) return emptyResult();

  const pageCount = Math.max(1, Math.ceil(total / SEARCH_GOODS_PAGE_SIZE));
  const safePage = clampPage(page, pageCount);
  const start = (safePage - 1) * SEARCH_GOODS_PAGE_SIZE;

  return {
    items: matched.slice(start, start + SEARCH_GOODS_PAGE_SIZE),
    total,
    page: safePage,
    pageCount,
  };
}

/**
 * 검색 결과에 굿즈샵 사이드바(카테고리·IP·타입·가격)와 관련성·가격 정렬을 얹는다(SR-01).
 * facet 과 가격 상한은 필터 전 검색 스코프에서, 페이지 수는 필터 뒤 개수에서 센다.
 */
export function selectSearchGoods(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'> & { categories?: readonly CatalogCategory[] },
  term: string,
  query: ShopListQuery,
  page: number,
): SearchGoodsCollection {
  const full = selectCollectionGoods(matchSearchGoods(catalog, term), catalog, query);
  const pageCount = Math.max(1, Math.ceil(full.filteredTotal / SEARCH_GOODS_PAGE_SIZE));
  const safePage = clampPage(page, pageCount);
  const start = (safePage - 1) * SEARCH_GOODS_PAGE_SIZE;

  return {
    result: { ...full, goods: full.goods.slice(start, start + SEARCH_GOODS_PAGE_SIZE) },
    page: safePage,
    pageCount,
  };
}

export interface SearchPageWindow {
  start: number;
  end: number;
  /** 이전 창의 마지막 페이지. 첫 창이면 지금이 1페이지가 아닐 때만 1, 1페이지면 null. */
  prev: number | null;
  /** 다음 창의 첫 페이지. 마지막 창이면 지금이 끝이 아닐 때만 마지막 페이지, 끝이면 null. */
  next: number | null;
}

/**
 * 고정 창 페이지네이션(11 §6 B8 — 이전·다음은 창 단위로 건너뛴다).
 * 창은 1–10, 11–20 처럼 고정 구간이라 같은 창 안에서 움직이면 셀이 흔들리지 않는다. 창 이동 화살표는
 * 죽은 링크를 만들지 않는다 — 더 갈 창이 없으면 첫·마지막 페이지로 보내고, 이미 거기면 그리지 않는다.
 */
export function searchPageWindow(page: number, pageCount: number, size: number): SearchPageWindow {
  const safePage = clampPage(page, Math.max(1, pageCount));
  const start = Math.floor((safePage - 1) / size) * size + 1;
  const end = Math.min(pageCount, start + size - 1);
  return {
    start,
    end,
    prev: start > 1 ? start - 1 : safePage > 1 ? 1 : null,
    next: end < pageCount ? end + 1 : safePage < pageCount ? pageCount : null,
  };
}

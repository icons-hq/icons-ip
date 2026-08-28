import type { CatalogSnapshot } from '@/lib/catalog';
import type { Good } from '@/lib/data';

/* /search 의 굿즈 결과 선택자 (#326 유저 스토리 18·19).
 *
 * lib/search.ts 의 getSearchSnapshot 은 통합 검색(IP·카드·포스트·태그)용이고 그룹당
 * 6건만 준다 — 굿즈가 주 결과인 결과 페이지에는 모자란다. 여기서 카탈로그 스냅샷을
 * 직접 훑어 굿즈 전량을 매기고 페이지로 자른다. 스냅샷 계약은 건드리지 않는다. */

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

/* 상수 객체를 돌려쓰면 호출부가 items 를 만졌을 때 다음 호출까지 오염된다. 매번 새로 만든다. */
function emptyResult(): GoodsSearchResult {
  return { items: [], total: 0, page: 1, pageCount: 1 };
}

function includesFold(haystack: string | null | undefined, needle: string) {
  return (haystack ?? '').toLowerCase().includes(needle);
}

export function searchGoods(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>,
  query: string,
  page: number,
): GoodsSearchResult {
  const needle = query.trim().toLowerCase();
  if (!needle) return emptyResult();

  const ipTitleById = new Map(catalog.ips.map((ip) => [ip.id, ip.title]));

  /* 순위별 버킷에 담으면 정렬 없이 카탈로그 원순서가 그대로 동순위 순서가 된다. */
  const byName: Good[] = [];
  const byIp: Good[] = [];
  const rest: Good[] = [];

  for (const good of catalog.goods) {
    if (includesFold(good.name, needle)) {
      byName.push(good);
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

  const matched = [...byName, ...byIp, ...rest];
  const total = matched.length;
  if (total === 0) return emptyResult();

  const pageCount = Math.max(1, Math.ceil(total / SEARCH_GOODS_PAGE_SIZE));
  /* NaN·소수·음수 같은 URL 쓰레기가 여기까지 온다. 화면이 다시 방어하지 않도록 여기서 끝낸다. */
  const requested = Number.isFinite(page) ? Math.trunc(page) : 1;
  const safePage = Math.min(Math.max(requested, 1), pageCount);
  const start = (safePage - 1) * SEARCH_GOODS_PAGE_SIZE;

  return {
    items: matched.slice(start, start + SEARCH_GOODS_PAGE_SIZE),
    total,
    page: safePage,
    pageCount,
  };
}

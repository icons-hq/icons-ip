import type { CatalogSnapshot } from './catalog';
import type { Good } from './data';
import { GOOD_TYPES, isGoodType } from './goods-taxonomy';

/* 굿즈샵·NEW·BEST 컬렉션의 목록 상태 하나 (#326). URL 이 유일한 진실원이라
   파싱·필터·정렬·facet 계산을 전부 여기서 끝내고, 화면은 결과만 그린다.
   수치와 동작의 정본은 R-03 §1(컬렉션 전체)이다. */

export type ShopSort = 'recommended' | 'newest' | 'price_asc' | 'price_desc';

export const SHOP_SORTS: readonly ShopSort[] = ['recommended', 'newest', 'price_asc', 'price_desc'];

export const SHOP_SORT_LABELS: Record<ShopSort, string> = {
  recommended: '추천순',
  newest: '최신순',
  price_asc: '낮은 가격순',
  price_desc: '높은 가격순',
};

export type ShopView = 'all' | 'new' | 'best';

/** VIEW MORE 1회 append 단위 (R-03 §1.6). */
export const SHOP_PAGE_SIZE = 20;

/* 정렬 기본값은 컬렉션마다 다르다 — NEW 는 최신순이 컬렉션의 정의 자체다(R-03 §1.4). */
export const SHOP_DEFAULT_SORT: Record<ShopView, ShopSort> = {
  all: 'recommended',
  new: 'newest',
  best: 'recommended',
};

export interface ShopListQuery {
  ips: string[];
  types: string[];
  priceMin: number | null;
  priceMax: number | null;
  sort: ShopSort;
  view: ShopView;
}

export interface ShopFacetOption {
  value: string;
  label: string;
  count: number;
}

export interface ShopListResult {
  goods: Good[];
  filteredTotal: number;
  total: number;
  priceCeil: number;
  ipFacets: ShopFacetOption[];
  typeFacets: ShopFacetOption[];
}

type SearchParamValue = string | string[] | undefined;

function valuesOf(value: SearchParamValue): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function firstOf(value: SearchParamValue): string | undefined {
  return valuesOf(value)[0];
}

/* 원 단위 정수만 받는다. 음수·소수·공백은 필터를 조용히 왜곡하느니 없는 값으로 떨어뜨린다. */
function parsePrice(value: SearchParamValue): number | null {
  const raw = firstOf(value);
  if (raw === undefined || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

export function parseShopSearchParams(
  params: Record<string, SearchParamValue>,
  options: { view: ShopView; validIpIds: ReadonlySet<string> },
): ShopListQuery {
  const sortParam = firstOf(params.sort);

  return {
    ips: dedupe(valuesOf(params.ip).filter((id) => options.validIpIds.has(id))),
    types: dedupe(valuesOf(params.type).filter(isGoodType)),
    priceMin: parsePrice(params.min),
    priceMax: parsePrice(params.max),
    sort: SHOP_SORTS.find((candidate) => candidate === sortParam) ?? SHOP_DEFAULT_SORT[options.view],
    view: options.view,
  };
}

/** 뷰가 정하는 스코프 — 필터·정렬·facet·카운트가 모두 이 목록 위에서만 움직인다. */
function scopeFor(
  goods: readonly Good[],
  view: ShopView,
  bestGoodIds: readonly string[],
): Good[] {
  if (view === 'new') return goods.filter((good) => good.badge === 'NEW');
  if (view !== 'best') return [...goods];

  /* BEST 는 카탈로그가 아니라 큐레이션이 순서를 정한다. 없는 id 는 빈 카드가 아니라
     그냥 빠지고(resolveHomeGoodsCards 와 같은 규칙), 중복 지정도 한 번만 센다. */
  const goodsById = new Map(goods.map((good) => [good.id, good]));
  const seen = new Set<string>();
  const curated: Good[] = [];
  for (const id of bestGoodIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const good = goodsById.get(id);
    if (good) curated.push(good);
  }
  return curated;
}

function timeOf(good: Good): number | null {
  if (!good.createdAt) return null;
  const parsed = Date.parse(good.createdAt);
  return Number.isFinite(parsed) ? parsed : null;
}

/* 정렬은 스코프 순서(추천순)를 기준선으로 놓고 그 위에서만 재배열한다.
   동점·시각 부재 항목이 원순서를 잃지 않도록 인덱스를 타이브레이커로 쓴다. */
function sortGoods(goods: Good[], sort: ShopSort): Good[] {
  if (sort === 'recommended') return goods;

  return goods
    .map((good, index) => ({ good, index }))
    .sort((a, b) => {
      if (sort === 'price_asc' && a.good.price !== b.good.price) return a.good.price - b.good.price;
      if (sort === 'price_desc' && a.good.price !== b.good.price) return b.good.price - a.good.price;
      if (sort === 'newest') {
        const at = timeOf(a.good);
        const bt = timeOf(b.good);
        if (at !== null && bt !== null && at !== bt) return bt - at;
        if (at !== null && bt === null) return -1;
        if (at === null && bt !== null) return 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.good);
}

export function selectShopGoods(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods'>,
  query: ShopListQuery,
  bestGoodIds: readonly string[] = [],
): ShopListResult {
  const scope = scopeFor(catalog.goods, query.view, bestGoodIds);

  const selectedIps = new Set(query.ips);
  const selectedTypes = new Set(query.types);
  const filtered = scope.filter((good) => {
    if (selectedIps.size > 0 && !selectedIps.has(good.ip)) return false;
    if (selectedTypes.size > 0 && !selectedTypes.has(good.type)) return false;
    if (query.priceMin !== null && good.price < query.priceMin) return false;
    if (query.priceMax !== null && good.price > query.priceMax) return false;
    return true;
  });

  /* facet 카운트와 가격 상한은 필터 적용 전 스코프에서 뽑는다 — 필터를 걸 때마다
     체크박스가 사라지거나 슬라이더 최대값이 줄면 되돌릴 방법이 없어진다(R-03 §1.3). */
  const countByIp = new Map<string, number>();
  const countByType = new Map<string, number>();
  for (const good of scope) {
    countByIp.set(good.ip, (countByIp.get(good.ip) ?? 0) + 1);
    countByType.set(good.type, (countByType.get(good.type) ?? 0) + 1);
  }

  return {
    goods: sortGoods(filtered, query.sort),
    filteredTotal: filtered.length,
    total: scope.length,
    priceCeil: scope.reduce((max, good) => Math.max(max, good.price), 0),
    ipFacets: catalog.ips
      .filter((ip) => (countByIp.get(ip.id) ?? 0) > 0)
      .map((ip) => ({ value: ip.id, label: ip.title, count: countByIp.get(ip.id) ?? 0 })),
    typeFacets: GOOD_TYPES.filter((type) => (countByType.get(type) ?? 0) > 0).map((type) => ({
      value: type,
      label: type,
      count: countByType.get(type) ?? 0,
    })),
  };
}

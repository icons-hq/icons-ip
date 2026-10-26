import { categoryAncestorIds, orderedCatalogCategories, type CatalogCategory } from './catalog-categories';
import type { CatalogSnapshot } from './catalog';
import type { Good } from './data';
import { pickGoodsReviewSummaries, type GoodsReviewSummaries, type GoodsReviewSummary } from './goods-review-summary';
import { GOOD_TYPES, isGoodType } from './goods-taxonomy';

/* 굿즈샵·NEW·BEST·검색 결과·온라인 팝업 IP관이 공유하는 목록 상태 하나 (#326, LFS 패리티 2차 L4).
   URL 이 유일한 진실원이라 파싱·필터·정렬·facet 계산을 전부 여기서 끝내고, 화면은 결과만 그린다.
   수치와 동작의 정본은 R-03 §1(컬렉션 전체)·§2(검색)·§1.9(브랜드관)다. */

export type ShopSort =
  | 'recommended'
  | 'relevance'
  | 'name_asc'
  | 'name_desc'
  | 'price_asc'
  | 'price_desc'
  | 'oldest'
  | 'newest';

/** 서버 페이지네이션(카테고리 전시 RPC `get_category_display_page`)도 받는 정렬 — DB 화이트리스트와 같아야 한다.
 *  컬렉션 목록(`SHOP_VIEW_SORTS.all`)과 같은 7종이다 — 카테고리 전시도 같은 정렬 문법을 쓴다(LFS 패리티 2차 L5, 12 LD-13).
 *  클라이언트에서 정렬하는 목록은 뷰별 목록(`SHOP_VIEW_SORTS`)을 쓴다. */
export const SHOP_SORTS: readonly ShopSort[] = ['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest'];

export const SHOP_SORT_LABELS: Record<ShopSort, string> = {
  recommended: '추천순',
  relevance: '관련성순',
  name_asc: '이름 가나다순',
  name_desc: '이름 역순',
  price_asc: '낮은 가격순',
  price_desc: '높은 가격순',
  oldest: '오래된순',
  newest: '최신순',
};

export type ShopView = 'all' | 'new' | 'best' | 'search' | 'ip';

/* 목록 정렬은 레퍼런스 순서(추천 → 이름 2 → 가격 2 → 출시 2)를 따른다. 베스트셀러는 운영 가주문이
   판매 순위를 왜곡하는 동안 보류한다(12 LD-13). 검색은 관련성·가격 2종이다(R-03 §2.4). */
const COLLECTION_SORTS: readonly ShopSort[] = ['recommended', 'name_asc', 'name_desc', 'price_asc', 'price_desc', 'oldest', 'newest'];

export const SHOP_VIEW_SORTS: Record<ShopView, readonly ShopSort[]> = {
  all: COLLECTION_SORTS,
  new: COLLECTION_SORTS,
  best: COLLECTION_SORTS,
  ip: COLLECTION_SORTS,
  search: ['relevance', 'price_asc', 'price_desc'],
};

/** VIEW MORE 1회 append 단위 (R-03 §1.6). */
export const SHOP_PAGE_SIZE = 20;

/* 정렬 기본값은 컬렉션마다 다르다 — NEW 는 최신순이 컬렉션의 정의 자체고(R-03 §1.4), 검색은 관련성이다. */
export const SHOP_DEFAULT_SORT: Record<ShopView, ShopSort> = {
  all: 'recommended',
  new: 'newest',
  best: 'recommended',
  ip: 'recommended',
  search: 'relevance',
};

/* 레퍼런스의 상품타입 필터는 NEW·PRE-ORDER·SALE 이다(11 §3 Δ6). ICONS 의 타입 축은 굿즈 분류라
   NEW·SALE 은 배지로만 두고, 예약판매만 타입 축의 값 하나로 표기한다(12 §3.1 "타입 축 표기만").
   예약판매 옵션을 하나라도 가진 굿즈가 이 값에 걸린다 — 저장 값이 아니라 옵션 공급 방식에서 파생된다. */
export const SHOP_PREORDER_TYPE = '예약판매';

export function isPreorderGood(good: Pick<Good, 'options'>): boolean {
  return Boolean(good.options?.some((option) => option.supply?.mode === 'preorder'));
}

export interface ShopListQuery {
  /** A separate editorial destination; it never changes the legacy category filter. */
  displayCategory?: string;
  ips: string[];
  categories?: string[];
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
  depth?: number;
}

export interface ShopListResult {
  goods: Good[];
  filteredTotal: number;
  total: number;
  priceCeil: number;
  ipFacets: ShopFacetOption[];
  typeFacets: ShopFacetOption[];
  categoryFacets?: ShopFacetOption[];
  /** 목록 카드 별점(CL-02) — 이 결과의 굿즈 몫만 담는다. 리뷰 0건 굿즈는 키가 없다. */
  reviewSummaries?: Record<string, GoodsReviewSummary>;
}

const naturalIdCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function displayOrderOf(good: Good) {
  return typeof good.displayOrder === 'number' && Number.isInteger(good.displayOrder) && good.displayOrder >= 0
    ? good.displayOrder
    : null;
}

/** 추천순의 기본 키. 중복·미설정 값은 상품 ID로 고정해 페이지 경계를 흔들지 않는다. */
function compareRecommendedGoods(left: Good, right: Good) {
  const leftOrder = displayOrderOf(left);
  const rightOrder = displayOrderOf(right);
  if (leftOrder !== null && rightOrder === null) return -1;
  if (leftOrder === null && rightOrder !== null) return 1;
  if (leftOrder !== null && rightOrder !== null && leftOrder !== rightOrder) return leftOrder - rightOrder;
  return naturalIdCollator.compare(left.id, right.id);
}

function sortRecommendedGoods(goods: Good[]) {
  return [...goods].sort(compareRecommendedGoods);
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
  options: { view: ShopView; validIpIds: ReadonlySet<string>; validCategoryIds?: ReadonlySet<string> },
): ShopListQuery {
  const sortParam = firstOf(params.sort);

  return {
    ips: dedupe(valuesOf(params.ip).filter((id) => options.validIpIds.has(id))),
    types: dedupe(valuesOf(params.type).filter((type) => isGoodType(type) || type === SHOP_PREORDER_TYPE)),
    ...(options.validCategoryIds ? { categories: dedupe(valuesOf(params.category).filter((id) => options.validCategoryIds!.has(id))) } : {}),
    priceMin: parsePrice(params.min),
    priceMax: parsePrice(params.max),
    sort: SHOP_VIEW_SORTS[options.view].find((candidate) => candidate === sortParam) ?? SHOP_DEFAULT_SORT[options.view],
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

/* 이름순은 한국어 가나다(숫자 → 한글 → 영문)다. 숫자는 자연수로 비교해 '2번'이 '10번' 앞에 온다. */
const nameCollator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

/* 등록 시각 비교. 시각이 없는 굿즈는 어느 방향이든 뒤로 보낸다 — "가장 오래된"이 될 근거가 없다. */
function compareTime(a: Good, b: Good, direction: 1 | -1): number {
  const at = timeOf(a);
  const bt = timeOf(b);
  if (at !== null && bt !== null && at !== bt) return (at - bt) * direction;
  if (at !== null && bt === null) return -1;
  if (at === null && bt !== null) return 1;
  return 0;
}

/* 정렬은 스코프 순서(추천순·검색 관련성)를 기준선으로 놓고 그 위에서만 재배열한다.
   동점·시각 부재 항목이 원순서를 잃지 않도록 인덱스를 타이브레이커로 쓴다. */
function sortGoods(goods: Good[], sort: ShopSort): Good[] {
  if (sort === 'recommended' || sort === 'relevance') return goods;

  return goods
    .map((good, index) => ({ good, index }))
    .sort((a, b) => {
      let order = 0;
      if (sort === 'price_asc') order = a.good.price - b.good.price;
      else if (sort === 'price_desc') order = b.good.price - a.good.price;
      else if (sort === 'name_asc') order = nameCollator.compare(a.good.name, b.good.name);
      else if (sort === 'name_desc') order = nameCollator.compare(b.good.name, a.good.name);
      else if (sort === 'newest') order = compareTime(a.good, b.good, -1);
      else if (sort === 'oldest') order = compareTime(a.good, b.good, 1);
      return order || a.index - b.index;
    })
    .map((entry) => entry.good);
}

type CollectionCatalog = Pick<CatalogSnapshot, 'ips'> & {
  categories?: readonly CatalogCategory[];
  reviewSummaries?: GoodsReviewSummaries;
};

/**
 * 이미 정해진 스코프(뷰·검색 결과·IP관) 위에서 필터·정렬·facet 을 계산한다.
 * BEST 큐레이션과 검색 관련성은 스코프 순서 자체가 추천 기준이라 진열 순서로 다시 줄 세우지 않는다.
 */
export function selectCollectionGoods(
  scope: readonly Good[],
  catalog: CollectionCatalog,
  query: ShopListQuery,
): ShopListResult {
  const selectedIps = new Set(query.ips);
  const selectedTypes = new Set(query.types);
  const wantsPreorder = selectedTypes.has(SHOP_PREORDER_TYPE);
  const categories = catalog.categories ?? [];
  const selectedCategories = new Set(query.categories ?? []);
  const goodCategoryIds = new Map(scope.map((good) => [good.id, good.categoryId ? categoryAncestorIds(categories, good.categoryId) : []]));
  const filtered = scope.filter((good) => {
    if (selectedCategories.size > 0 && !goodCategoryIds.get(good.id)?.some((id) => selectedCategories.has(id))) return false;
    if (selectedIps.size > 0 && !selectedIps.has(good.ip)) return false;
    /* 타입 그룹 안의 값끼리는 OR 다 — 예약판매도 같은 그룹의 값 하나로 고른다. */
    if (selectedTypes.size > 0 && !selectedTypes.has(good.type) && !(wantsPreorder && isPreorderGood(good))) return false;
    if (query.priceMin !== null && good.price < query.priceMin) return false;
    if (query.priceMax !== null && good.price > query.priceMax) return false;
    return true;
  });

  /* facet 카운트와 가격 상한은 필터 적용 전 스코프에서 뽑는다 — 필터를 걸 때마다
     체크박스가 사라지거나 슬라이더 최대값이 줄면 되돌릴 방법이 없어진다(R-03 §1.3). */
  const countByIp = new Map<string, number>();
  const countByType = new Map<string, number>();
  const countByCategory = new Map<string, number>();
  let preorderCount = 0;
  for (const good of scope) {
    countByIp.set(good.ip, (countByIp.get(good.ip) ?? 0) + 1);
    countByType.set(good.type, (countByType.get(good.type) ?? 0) + 1);
    /* 굿즈의 카테고리 ID 목록은 자기와 모든 조상이라 부모 개수는 자손 합계가 된다. */
    for (const id of goodCategoryIds.get(good.id) ?? []) countByCategory.set(id, (countByCategory.get(id) ?? 0) + 1);
    if (isPreorderGood(good)) preorderCount += 1;
  }
  /* 결과 0개 카테고리는 IP·타입처럼 숨긴다 — 좁힌 스코프(검색·IP관)에서 고르면 빈 목록으로만 가는 값이다.
     지금 고른 카테고리와 그 조상은 개수와 무관하게 남겨 해제할 길과 트리 모양을 지킨다. */
  const keptCategoryIds = new Set([...selectedCategories].flatMap((id) => categoryAncestorIds(categories, id)));

  const scopeIsRecommended = query.view === 'best' || query.view === 'search';
  const recommended = scopeIsRecommended ? filtered : sortRecommendedGoods(filtered);
  const sorted = query.sort === 'recommended' ? recommended : sortGoods(filtered, query.sort);

  return {
    goods: sorted,
    ...(catalog.reviewSummaries ? { reviewSummaries: pickGoodsReviewSummaries(catalog.reviewSummaries, sorted.map((good) => good.id)) } : {}),
    filteredTotal: filtered.length,
    total: scope.length,
    priceCeil: scope.reduce((max, good) => Math.max(max, good.price), 0),
    ipFacets: catalog.ips
      .filter((ip) => (countByIp.get(ip.id) ?? 0) > 0)
      .map((ip) => ({ value: ip.id, label: ip.title, count: countByIp.get(ip.id) ?? 0 })),
    ...(categories.length ? { categoryFacets: orderedCatalogCategories(categories)
      .filter((category) => (countByCategory.get(category.id) ?? 0) > 0 || keptCategoryIds.has(category.id))
      .map((category) => ({
        value: category.id, label: category.name, depth: category.depth,
        count: countByCategory.get(category.id) ?? 0,
      })) } : {}),
    typeFacets: [
      ...GOOD_TYPES.filter((type) => (countByType.get(type) ?? 0) > 0).map((type) => ({
        value: type,
        label: type,
        count: countByType.get(type) ?? 0,
      })),
      ...(preorderCount > 0 ? [{ value: SHOP_PREORDER_TYPE, label: SHOP_PREORDER_TYPE, count: preorderCount }] : []),
    ],
  };
}

export function selectShopGoods(
  catalog: Pick<CatalogSnapshot, 'ips' | 'goods' | 'reviewSummaries'> & { categories?: readonly CatalogCategory[] },
  query: ShopListQuery,
  bestGoodIds: readonly string[] = [],
): ShopListResult {
  return selectCollectionGoods(scopeFor(catalog.goods, query.view, bestGoodIds), catalog, query);
}

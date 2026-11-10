import type { Stock } from '@/lib/data';
import { customerServiceDate } from './customer-service-list';
import { GOODS_READINESS_REASONS, goodsReadinessAnchor, type AdminGoodsReadiness, type GoodsReadinessFilter, type GoodsReadinessTarget } from './goods-readiness';

export const GOODS_LIST_PATH = '/admin/catalog/goods';
export const GOODS_LIST_PAGE_SIZE = 20;
export const GOODS_LIST_PAGE_SIZES = [20, 50, 100] as const;
export const GOODS_LIST_SEARCH_FIELDS = [
  { value: 'all', label: '전체' }, { value: 'name', label: '상품명' }, { value: 'id', label: '상품번호' },
  { value: 'code', label: '판매자상품코드·옵션코드' }, { value: 'erp', label: 'ERP 코드·품명' }, { value: 'barcode', label: '바코드' },
] as const;
export const GOODS_LIST_DATE_FIELDS = [
  { value: 'created', label: '상품등록일' }, { value: 'updated', label: '상품수정일' }, { value: 'published', label: '전시시작일' },
] as const;
export const GOODS_LIST_SORT_OPTIONS = [
  { value: 'created_desc', label: '상품등록일순' }, { value: 'updated_desc', label: '상품수정일순' },
  { value: 'name_asc', label: '상품명순' }, { value: 'id_asc', label: '상품번호순' },
  { value: 'price_asc', label: '판매가 낮은순' }, { value: 'price_desc', label: '판매가 높은순' },
  { value: 'stock_asc', label: '재고 적은순' }, { value: 'stock_desc', label: '재고 많은순' },
] as const;
/**
 * 판매상태 필터(MD-0026). 판매중지(운영자가 판매상태를 판매중지로 바꾼 상품, goods.stock='soldout')와
 * 품절(판매중지가 아닌데 사용 옵션 할당 재고 0)을 나눈다. 'soldout'은 둘 다를 찾는 이전 값으로,
 * 저장된 주소와 홈 요약 링크가 그대로 열리도록 남긴다. 고객 화면은 둘 다 '품절'이다.
 */
export const GOODS_LIST_STOCK_OPTIONS = [
  { value: 'all', label: '전체' }, { value: 'ok', label: '판매중' }, { value: 'low', label: '소량 재고' },
  { value: 'out_of_stock', label: '품절' }, { value: 'stopped', label: '판매중지' }, { value: 'soldout', label: '품절·판매중지 모두' },
] as const;
export type GoodsListSearchField = (typeof GOODS_LIST_SEARCH_FIELDS)[number]['value'];
export type GoodsListDateField = (typeof GOODS_LIST_DATE_FIELDS)[number]['value'];
export type GoodsListSort = (typeof GOODS_LIST_SORT_OPTIONS)[number]['value'];
export type GoodsListStatus = 'active' | 'all' | 'draft' | 'published' | 'archived';
export type GoodsListStock = (typeof GOODS_LIST_STOCK_OPTIONS)[number]['value'];
export interface GoodsListFilters {
  query: string;
  ipId: string;
  categoryId: string;
  readiness: GoodsReadinessFilter;
  page: number;
  status: GoodsListStatus;
  stock: GoodsListStock;
  field?: GoodsListSearchField;
  dateField?: GoodsListDateField;
  from?: string | null;
  to?: string | null;
  sort?: GoodsListSort;
  pageSize?: number;
  originId?: string;
  payment?: 'all' | 'card' | 'bank' | 'none';
  saleType?: 'all' | 'stock' | 'preorder';
  image?: 'all' | 'with' | 'without';
  restriction?: 'all' | 'none' | 'adult';
  /** 판매기간 기준(R16): 판매대기(시작 전)·판매기간 종료. 판매 중·기간 없음은 'all'에 들어 있다. */
  salePeriod?: 'all' | 'scheduled' | 'ended';
}
export interface AdminGoodSummary {
  id: string;
  code: string;
  name: string;
  ipId: string;
  ipTitle: string;
  publishedAt: string | null;
  archivedAt: string | null;
  stock: Stock;
  stockQty: number;
  activeStockQty: number;
  saleAvailableQty?: number;
  lowStockOptionCount: number;
  allowCardPayment?: boolean;
  allowBankTransfer?: boolean;
  saleRestriction?: 'none' | 'adult';
  noticeComplete: boolean;
  imageUrl?: string | null;
  categoryName?: string | null;
  priceMin?: number | null;
  priceMax?: number | null;
  readiness?: AdminGoodsReadiness;
  createdAt?: string;
  updatedAt?: string;
  /** 목록 바로 수정(A9): 기본 판매가(goods.price). 옵션 추가금은 옵션별로 유지한다. */
  basePrice?: number;
  /** 상품 할인(정가 표시). 있으면 편집기의 판매가는 이 값이라 목록에서 바로 고치지 않는다. */
  compareAtPrice?: number | null;
  /** 진행·예정 즉시할인의 마지막 종료 시각. 있으면 옵션가 보호 때문에 판매가를 바꿀 수 없다. */
  activeDiscountEndsAt?: string | null;
  /** 사용 중인 옵션 수(-1: 확인 불가). 1개일 때만 목록에서 재고수량을 바로 고친다(옵션 재고는 옵션 단위). */
  activeVariantCount?: number;
  inlineStock?: { variantId: string; stockQty: number } | null;
  /** 고객 상세(`/shop/<id>`)가 열리는 상품(전시·미보관·판매 제한 없음·IP 공개). 아니면 상품번호가 편집기 미리보기로 간다(R15). */
  customerVisible?: boolean;
}
/** 품절 보기·소량 재고 보기 칸의 건수. 키는 판매상태 필터 값이고, 재고 조건만 뺀 같은 검색 조건에서 센다 — 숫자가 곧 그 칸을 눌렀을 때의 목록 개수다. */
export type GoodsListStockCounts = Record<'out_of_stock' | 'low', number>;
export interface AdminGoodsListData {
  filters: GoodsListFilters;
  goods: AdminGoodSummary[];
  total: number;
  pageSize?: number;
  counts?: Record<GoodsListStatus, number>;
  /** 없으면(`null`) 건수를 읽지 못한 상태다. 목록은 그대로 보이고 칸만 '집계 없음'이 된다. */
  stockCounts?: GoodsListStockCounts | null;
  origins?: { id: string; name: string; active: boolean }[];
  checkedAt?: string;
  categories?: { id: string; name: string; depth: number; archivedAt: string | null }[];
  ips: { id: string; title: string; archivedAt: string | null }[];
}
const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : '';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function goodsListPageSize(value: unknown): number {
  const size = typeof value === 'string' || typeof value === 'number' ? Number(value) : 0;
  return GOODS_LIST_PAGE_SIZES.some(allowed => allowed === size) ? size : GOODS_LIST_PAGE_SIZE;
}
export function normalizeGoodsListFilters(values: Record<string, string | string[] | undefined>): GoodsListFilters {
  const page = Number(single(values.page));
  const ipId = single(values.ipId);
  const status = single(values.status);
  const categoryId = single(values.categoryId);
  const readiness = single(values.readiness);
  const stock = single(values.stock);
  let from = customerServiceDate(values.from);
  let to = customerServiceDate(values.to);
  if (from && to && from > to) { from = null; to = null; }
  const field = single(values.field);
  const dateField = single(values.dateField);
  const sort = single(values.sort);
  const originId = single(values.originId);
  const payment = single(values.payment);
  const saleType = single(values.saleType);
  const image = single(values.image);
  const restriction = single(values.restriction);
  const salePeriod = single(values.salePeriod);
  return {
    categoryId: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(categoryId) ? categoryId.toLowerCase() : '',
    readiness: ['ready', 'review_required'].includes(readiness) || Object.hasOwn(GOODS_READINESS_REASONS, readiness) ? readiness as GoodsReadinessFilter : 'all',
    query: single(values.q).trim().slice(0, 100),
    ipId: /^[a-z0-9][a-z0-9-]*$/.test(ipId) ? ipId.slice(0, 100) : '',
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 100000) : 1,
    status: ['active', 'all', 'draft', 'published', 'archived'].includes(status) ? status as GoodsListStatus : 'active',
    stock: GOODS_LIST_STOCK_OPTIONS.some(option => option.value === stock) ? stock as GoodsListStock : 'all',
    field: GOODS_LIST_SEARCH_FIELDS.some(option => option.value === field) ? field as GoodsListSearchField : 'all',
    dateField: GOODS_LIST_DATE_FIELDS.some(option => option.value === dateField) ? dateField as GoodsListDateField : 'created',
    from,
    to,
    sort: GOODS_LIST_SORT_OPTIONS.some(option => option.value === sort) ? sort as GoodsListSort : 'created_desc',
    pageSize: goodsListPageSize(values.pageSize),
    originId: UUID_PATTERN.test(originId) ? originId.toLowerCase() : '',
    payment: ['card', 'bank', 'none'].includes(payment) ? payment as 'card' | 'bank' | 'none' : 'all',
    saleType: ['stock', 'preorder'].includes(saleType) ? saleType as 'stock' | 'preorder' : 'all',
    image: ['with', 'without'].includes(image) ? image as 'with' | 'without' : 'all',
    restriction: ['none', 'adult'].includes(restriction) ? restriction as 'none' | 'adult' : 'all',
    salePeriod: ['scheduled', 'ended'].includes(salePeriod) ? salePeriod as 'scheduled' | 'ended' : 'all',
  };
}
/** 검색어·조건으로 좁힌 목록인가. 0건일 때 "아직 등록한 상품이 없다"고 잘못 말하지 않게 한다(건수는 조건을 탄다). */
export function goodsListIsNarrowed(filters: GoodsListFilters): boolean {
  return Boolean(filters.query || filters.ipId || filters.categoryId || filters.from || filters.to || filters.originId)
    || filters.stock !== 'all' || filters.readiness !== 'all'
    || (filters.payment ?? 'all') !== 'all' || (filters.saleType ?? 'all') !== 'all' || (filters.image ?? 'all') !== 'all'
    || (filters.restriction ?? 'all') !== 'all' || (filters.salePeriod ?? 'all') !== 'all';
}

export function goodsListHref(filters: GoodsListFilters, page = filters.page): string {
  const params = new URLSearchParams({ status: filters.status, stock: filters.stock, page: String(page) });
  if (filters.query) params.set('q', filters.query);
  if (filters.ipId) params.set('ipId', filters.ipId);
  if (filters.categoryId) params.set('categoryId', filters.categoryId);
  if (filters.readiness && filters.readiness !== 'all') params.set('readiness', filters.readiness);
  if (filters.field && filters.field !== 'all') params.set('field', filters.field);
  if (filters.dateField && filters.dateField !== 'created') params.set('dateField', filters.dateField);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  if (filters.sort && filters.sort !== 'created_desc') params.set('sort', filters.sort);
  if (filters.pageSize && filters.pageSize !== GOODS_LIST_PAGE_SIZE) params.set('pageSize', String(filters.pageSize));
  if (filters.originId) params.set('originId', filters.originId);
  for (const key of ['payment', 'saleType', 'image', 'restriction', 'salePeriod'] as const) if (filters[key] && filters[key] !== 'all') params.set(key, filters[key]);
  return `${GOODS_LIST_PATH}?${params}`;
}

/** The list and export send the same predicates; pagination never changes the export scope. */
export function goodsConsoleFilterValues(filters: GoodsListFilters) {
  return {
    field: filters.field ?? 'all', dateField: filters.dateField ?? 'created',
    from: filters.from ?? null, to: filters.to ?? null, sort: filters.sort ?? 'created_desc',
    originId: filters.originId || null, payment: filters.payment ?? 'all',
    saleType: filters.saleType ?? 'all', image: filters.image ?? 'all', restriction: filters.restriction ?? 'all',
    salePeriod: filters.salePeriod ?? 'all',
  };
}
export function goodEditorHref(filters: GoodsListFilters, id: string, target?: GoodsReadinessTarget): string {
  return `${goodsListHref(filters)}&${new URLSearchParams({ goodId: id })}${target ? `#${goodsReadinessAnchor(target)}` : ""}`;
}
/** 공개 전 상품의 상품번호 목적지: 편집기의 '공개 화면 미리보기'(`<details id="good-preview">`). */
export function goodPreviewHref(filters: GoodsListFilters, id: string): string {
  return `${goodEditorHref(filters, id)}#good-preview`;
}

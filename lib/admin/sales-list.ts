/** Shared URL contract for the sales worklists. Sorting always happens before DB pagination. */
export const SALES_PAGE_SIZES = [20, 50, 100] as const;
export const SHIPMENT_PAGE_SIZES = [50, 100, 200, 500] as const;
export const SALES_SORT_OPTIONS = [
  { value: 'newest', label: '조회기준일 최신순' },
  { value: 'oldest', label: '조회기준일 오래된순' },
  { value: 'amount_high', label: '주문금액 높은순' },
  { value: 'amount_low', label: '주문금액 낮은순' },
] as const;
export type SalesListSort = (typeof SALES_SORT_OPTIONS)[number]['value'];
export const SALES_DATE_FIELDS = [
  { value: 'ordered', label: '주문일' },
  { value: 'paid', label: '결제일' },
  { value: 'confirmed', label: '발주확인일' },
  { value: 'shipped', label: '발송처리일' },
  { value: 'delivered', label: '배송완료일' },
  { value: 'settled', label: '거래확정일' },
] as const;
export type SalesDateField = (typeof SALES_DATE_FIELDS)[number]['value'];
/** 주문 통합검색과 거래확정은 같은 원장 검색 계약을 사용한다. */
export const SALES_ORDER_SEARCH_FIELDS = [
  { value: 'all', label: '전체' },
  { value: 'order', label: '주문번호' },
  { value: 'nickname', label: '구매자명' },
  { value: 'email', label: '이메일' },
  { value: 'recipient', label: '수취인' },
  { value: 'tracking', label: '운송장번호' },
  { value: 'phone', label: '수취인 연락처' },
  { value: 'product', label: '상품명 · 옵션' },
] as const;
export type SalesOrderSearchField = (typeof SALES_ORDER_SEARCH_FIELDS)[number]['value'];
export interface SalesListOptions { pageSize?: number; sort?: SalesListSort }
type SearchParams = Record<string, string | string[] | undefined>;

export function salesParam(params: SearchParams, key: string) {
  return typeof params[key] === 'string' ? params[key].trim() : '';
}
export function salesPage(value: string | string[] | undefined, pageSize: number) {
  const page = typeof value === 'string' ? Number(value) : 1;
  return Number.isSafeInteger(page) && page > 0 && page <= Math.floor(2147483647 / pageSize) + 1 ? page : 1;
}
export function normalizeSalesListOptions(
  params: SearchParams,
  defaultPageSize = 20,
  defaultSort: SalesListSort = 'newest',
  pageSizes: readonly number[] = SALES_PAGE_SIZES,
): SalesListOptions {
  const pageSize = Number(salesParam(params, 'pageSize'));
  const sort = salesParam(params, 'sort');
  return {
    ...(pageSizes.includes(pageSize) && pageSize !== defaultPageSize ? { pageSize } : {}),
    ...(SALES_SORT_OPTIONS.some((option) => option.value === sort) && sort !== defaultSort
      ? { sort: sort as SalesListSort } : {}),
  };
}
export function appendSalesListOptions(params: URLSearchParams, filters: SalesListOptions) {
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.sort) params.set('sort', filters.sort);
}
export function salesDateField(params: SearchParams): SalesDateField | undefined {
  const field = salesParam(params, 'dateField');
  return field !== 'ordered' && SALES_DATE_FIELDS.some((option) => option.value === field)
    ? field as SalesDateField : undefined;
}
export function salesListHiddenFields(href: string, excluded: readonly string[] = []) {
  const params = new URL(href, 'https://icons-admin.invalid').searchParams;
  return Object.fromEntries([...params].filter(([key]) => !['page', 'order', ...excluded].includes(key)));
}

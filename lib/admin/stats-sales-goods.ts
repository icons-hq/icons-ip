import { adminStatsHref, type AdminSalesGoodRow, type AdminStatsFilters } from './stats';

export const ADMIN_SALES_GOODS_PAGE_SIZES = [20, 50, 100] as const;
export const ADMIN_SALES_GOODS_EXPORT_LIMIT = 10_000;
export const ADMIN_SALES_GOODS_EXPORT_FETCH = ADMIN_SALES_GOODS_EXPORT_LIMIT + 1;
export type AdminSalesGoodsPagination = { page: number; pageSize: number };
export type AdminSalesGoodsRow = AdminSalesGoodRow & { rank: number };
export type AdminSalesGoodsPage = AdminSalesGoodsPagination & {
  rows: AdminSalesGoodsRow[];
  totalCount: number;
  asOf: string;
};

export class SalesGoodsExportLimitError extends Error {
  constructor() {
    super(`상품 순위 엑셀은 조회기간별 최대 ${ADMIN_SALES_GOODS_EXPORT_LIMIT.toLocaleString('ko-KR')}개 상품까지 내려받을 수 있습니다. 기간 또는 IP 조건을 좁혀주세요.`);
    this.name = 'SalesGoodsExportLimitError';
  }
}

export function normalizeAdminSalesGoodsPagination(params: Record<string, string | string[] | undefined>): AdminSalesGoodsPagination {
  const first = (key: string) => Array.isArray(params[key]) ? params[key]?.[0] : params[key];
  const rawPage = first('goodsPage') ?? '';
  const page = /^\d+$/.test(rawPage) ? Number(rawPage) : 1;
  const pageSize = Number(first('goodsPageSize'));
  return {
    page: Number.isSafeInteger(page) && page >= 1 && page <= 2_147_483_647 ? page : 1,
    pageSize: ADMIN_SALES_GOODS_PAGE_SIZES.some(size => size === pageSize) ? pageSize : 20,
  };
}

export function adminSalesGoodsHref(filters: AdminStatsFilters, page: number, pageSize: number) {
  const base = adminStatsHref('/admin/stats/sales', filters);
  const params = new URLSearchParams(base.split('?')[1]);
  if (page > 1) params.set('goodsPage', String(page));
  if (pageSize !== 20) params.set('goodsPageSize', String(pageSize));
  const query = params.toString();
  return `/admin/stats/sales${query ? `?${query}` : ''}#goods-ranking`;
}

export function adminSalesGoodsExportDisabledReason(currentCount: number, comparisonCount?: number) {
  const periods = [currentCount > ADMIN_SALES_GOODS_EXPORT_LIMIT ? '현재기간' : '',
    comparisonCount !== undefined && comparisonCount > ADMIN_SALES_GOODS_EXPORT_LIMIT ? '비교기간' : ''].filter(Boolean);
  return periods.length ? `${periods.join('·')} 상품이 10,000개를 초과했습니다. 전체 엑셀을 내려받으려면 기간 또는 IP 조건을 좁혀주세요.` : undefined;
}

const integer = (value: unknown, minimum = 0): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Reject malformed or truncated responses before they become a visible page or file. */
export function parseAdminSalesGoodsPage(value: unknown, requested: AdminSalesGoodsPagination): AdminSalesGoodsPage {
  const invalid = () => new Error('Incomplete sales goods report');
  if (!object(value) || !Array.isArray(value.rows) || !integer(value.totalCount) || !integer(value.page, 1)
    || value.pageSize !== requested.pageSize || typeof value.asOf !== 'string' || !Number.isFinite(Date.parse(value.asOf))) throw invalid();
  const expectedPage = Math.min(requested.page, Math.max(1, Math.ceil(value.totalCount / requested.pageSize)));
  const offset = (expectedPage - 1) * requested.pageSize;
  if (value.page !== expectedPage || value.rows.length !== Math.min(requested.pageSize, value.totalCount - offset)) throw invalid();
  const seen = new Set<string>();
  const rows = value.rows.map((row, index): AdminSalesGoodsRow => {
    if (!object(row) || row.rank !== offset + index + 1 || typeof row.goodId !== 'string' || !row.goodId
      || seen.has(row.goodId) || typeof row.name !== 'string' || typeof row.ipId !== 'string'
      || !integer(row.qty, 1) || !integer(row.revenue)) throw invalid();
    seen.add(row.goodId);
    return { rank: offset + index + 1, goodId: row.goodId, name: row.name, ipId: row.ipId, qty: row.qty, revenue: row.revenue };
  });
  return { rows, totalCount: value.totalCount, page: expectedPage, pageSize: requested.pageSize, asOf: value.asOf };
}

export function assertCompleteSalesGoodsExport(report: AdminSalesGoodsPage) {
  if (report.totalCount > ADMIN_SALES_GOODS_EXPORT_LIMIT) throw new SalesGoodsExportLimitError();
  if (report.page !== 1 || report.rows.length !== report.totalCount
    || report.rows.some((row, index) => row.rank !== index + 1)
    || new Set(report.rows.map(row => row.goodId)).size !== report.totalCount) {
    throw new Error('Incomplete sales goods export');
  }
}

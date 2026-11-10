import { describe, expect, it } from 'vitest';
import { normalizeAdminStatsFilters } from './stats';
import { adminSalesGoodsHref, assertCompleteSalesGoodsExport, normalizeAdminSalesGoodsPagination, parseAdminSalesGoodsPage, SalesGoodsExportLimitError, type AdminSalesGoodsPage } from './stats-sales-goods';

const row = { rank: 21, goodId: '000021', name: '상품 21', ipId: 'qa', qty: 2, revenue: 1000 };
const page: AdminSalesGoodsPage = { rows: [row], page: 2, pageSize: 20, totalCount: 21, asOf: '2026-10-14T00:00:00Z' };

describe('상품 전체 순위 계약', () => {
  it('URL 입력은 유효한 페이지와 화면 크기만 받는다', () => {
    expect(normalizeAdminSalesGoodsPagination({ goodsPage: ['3', '8'], goodsPageSize: '50' })).toEqual({ page: 3, pageSize: 50 });
    for (const goodsPage of ['-1', '0', '2.5', '100x', '2147483648']) expect(normalizeAdminSalesGoodsPagination({ goodsPage, goodsPageSize: '10001' })).toEqual({ page: 1, pageSize: 20 });
  });
  it('처음·이전·다음·마지막 URL에서 기간·IP·비교·단위를 보존한다', () => {
    const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-12', ip: 'qa', compare: 'year', bucket: 'week' });
    for (const target of [1, 2, 3, 100]) {
      const url = new URL(adminSalesGoodsHref(filters, target, 50), 'https://example.test');
      expect(Object.fromEntries(url.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-12', ip: 'qa', compare: 'year', bucket: 'week', goodsPageSize: '50', ...(target > 1 ? { goodsPage: String(target) } : {}) });
      expect(url.hash).toBe('#goods-ranking');
    }
    expect(adminSalesGoodsHref({ days: 7, ipId: '' }, 2, 20)).toContain('days=7&goodsPage=2');
  });
  it('실제 마지막 페이지·0건 보정은 총건수와 반환행을 함께 검사한다', () => {
    expect(parseAdminSalesGoodsPage(page, { page: 999, pageSize: 20 })).toEqual(page);
    expect(parseAdminSalesGoodsPage({ ...page, rows: [], totalCount: 0, page: 1 }, { page: 999, pageSize: 20 }).page).toBe(1);
    for (const value of [null, { ...page, rows: [] }, { ...page, page: 1 }, { ...page, rows: [{ ...row, rank: 1 }] }, { ...page, rows: [{ ...row, qty: 2.5 }] }, { ...page, rows: [{ ...row, revenue: Number.MAX_SAFE_INTEGER + 1 }] }]) {
      expect(() => parseAdminSalesGoodsPage(value, { page: 2, pageSize: 20 })).toThrow('Incomplete');
    }
  });
  it('10,000개까지 전체만 내보내고 초과·누락·중복·잘못된 순위는 거절한다', () => {
    const full = { ...page, page: 1, pageSize: 10001, totalCount: 10000, rows: Array.from({ length: 10000 }, (_, index) => ({ ...row, rank: index + 1, goodId: String(index) })) };
    expect(() => assertCompleteSalesGoodsExport(full)).not.toThrow();
    expect(() => assertCompleteSalesGoodsExport({ ...full, totalCount: 10001 })).toThrow(SalesGoodsExportLimitError);
    expect(() => assertCompleteSalesGoodsExport({ ...full, rows: full.rows.slice(0, 20) })).toThrow('Incomplete');
    expect(() => assertCompleteSalesGoodsExport({ ...full, rows: full.rows.map(item => ({ ...item, goodId: 'same' })) })).toThrow('Incomplete');
    expect(() => assertCompleteSalesGoodsExport({ ...full, rows: full.rows.map(item => ({ ...item, rank: 1 })) })).toThrow('Incomplete');
    expect(() => assertCompleteSalesGoodsExport({ ...full, totalCount: 0, rows: [] })).not.toThrow();
  });
});

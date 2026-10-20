import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), sales: vi.fn(), claims: vi.fn(), customers: vi.fn(), goods: vi.fn(), workbook: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/stats.server', () => ({ getAdminSalesReport: mocks.sales, getAdminClaimsReport: mocks.claims, getAdminCustomerReport: mocks.customers }));
vi.mock('@/lib/admin/stats-workbook.server', () => ({ buildStatsWorkbook: mocks.workbook }));
vi.mock('@/lib/admin/stats-sales-goods.server', () => ({ getAdminSalesGoodsExport: mocks.goods }));
import { SalesGoodsExportLimitError } from '@/lib/admin/stats-sales-goods';
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.goods.mockResolvedValue({ rows: [], totalCount: 0 }); mocks.workbook.mockResolvedValue(Buffer.from('xlsx')); mocks.sales.mockResolvedValue({ daily: [] }); mocks.claims.mockResolvedValue({}); mocks.customers.mockResolvedValue({}); });
describe('통계 내려받기 경계', () => {
  it('인증 실패 뒤에는 집계나 파일을 생성하지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(GET(new Request('https://example.test/api/admin/stats-workbook?report=sales'))).rejects.toThrow('forbidden');
    expect(mocks.sales).not.toHaveBeenCalled(); expect(mocks.goods).not.toHaveBeenCalled(); expect(mocks.workbook).not.toHaveBeenCalled();
  });
  it('잘못된 날짜·리포트 입력은 집계를 실행하지 않는다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/stats-workbook?report=sales&from=2026-02-30&to=2026-03-01'));
    expect(response.status).toBe(400); expect(mocks.sales).not.toHaveBeenCalled();
    expect((await GET(new Request('https://example.test/api/admin/stats-workbook?report=other'))).status).toBe(400);
  });
  it('화면과 같은 범위·IP·직전기간으로 집계하고 개인 캐시만 허용한다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/stats-workbook?report=sales&from=2026-10-01&to=2026-10-12&ip=test&compare=previous&bucket=week'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin/stats/sales');
    expect(mocks.sales).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: '2026-10-01', to: '2026-10-12', ipId: 'test', bucket: 'week' }), expect.any(Date));
    expect(mocks.sales).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: '2026-09-19', to: '2026-09-30', ipId: 'test' }), expect.any(Date));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('content-disposition')).toContain('icons-sales-report.xlsx');
  });
  it.each(['sales', 'claims', 'customers'] as const)('%s 전년 비교는 같은 RPC를 두 범위로 조회하고 파일 조건을 보존한다', async kind => {
    const response = await GET(new Request(`https://example.test/api/admin/stats-workbook?report=${kind}&from=2024-02-29&to=2024-02-29&ip=sample&compare=year&bucket=month`));
    expect(response.status).toBe(200);
    expect(mocks.guard).toHaveBeenCalledWith(`/admin/stats/${kind}`);
    expect(mocks[kind]).toHaveBeenCalledTimes(2);
    expect(mocks[kind]).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: '2024-02-29', to: '2024-02-29', compare: true, comparisonMode: 'year', bucket: 'month', ipId: 'sample' }), expect.any(Date));
    expect(mocks[kind]).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: '2023-02-28', to: '2023-02-28', compare: false, bucket: 'month', ipId: 'sample' }), expect.any(Date));
    expect(mocks.workbook).toHaveBeenCalledWith(expect.objectContaining({ kind }), expect.objectContaining({ comparisonMode: 'year', from: '2024-02-29', to: '2024-02-29' }), expect.any(Date));
  });
  it.each(['sales', 'claims', 'customers'] as const)('%s 비교 없음은 조회 RPC를 한 번만 실행한다', async kind => {
    const response = await GET(new Request(`https://example.test/api/admin/stats-workbook?report=${kind}&from=2024-02-29&to=2024-02-29&compare=none`));
    expect(response.status).toBe(200); expect(mocks[kind]).toHaveBeenCalledTimes(1);
    expect(mocks.workbook).toHaveBeenCalledWith(expect.objectContaining({ kind, comparison: null }), expect.objectContaining({ compare: false }), expect.any(Date));
  });
  it('현재와 전년의 상품 전체를 각각 한 번 받아 367일 파생범위를 보존한다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/stats-workbook?report=sales&from=2025-02-28&to=2026-02-28&compare=year&ip=qa&goodsPage=3'));
    expect(response.status).toBe(200); expect(mocks.goods).toHaveBeenCalledTimes(2);
    expect(mocks.goods).toHaveBeenNthCalledWith(1, expect.objectContaining({ from: '2025-02-28', to: '2026-02-28', ipId: 'qa' }), expect.any(Date));
    expect(mocks.goods).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: '2024-02-28', to: '2025-02-28', ipId: 'qa' }), expect.any(Date));
    expect(mocks.workbook).toHaveBeenCalledWith(expect.objectContaining({ goods: { rows: [], totalCount: 0 }, comparisonGoods: { rows: [], totalCount: 0 } }), expect.any(Object), expect.any(Date));
  });
  it('조회기간의 10,000개 상한 초과·반환행 누락은 첨부파일을 만들지 않는다', async () => {
    mocks.goods.mockRejectedValueOnce(new SalesGoodsExportLimitError());
    const limited = await GET(new Request('https://example.test/api/admin/stats-workbook?report=sales'));
    expect(limited.status).toBe(422); expect(await limited.json()).toEqual({ error: expect.stringContaining('10,000') });
    expect(limited.headers.get('content-disposition')).toBeNull(); expect(mocks.workbook).not.toHaveBeenCalled();
    mocks.goods.mockRejectedValueOnce(new Error('Incomplete sales goods report'));
    const incomplete = await GET(new Request('https://example.test/api/admin/stats-workbook?report=sales'));
    expect(incomplete.status).toBe(500); expect(incomplete.headers.get('content-disposition')).toBeNull(); expect(mocks.workbook).not.toHaveBeenCalled();
  });

});

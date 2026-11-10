import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), report: vi.fn(), workbook: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/customer-purchase-report.server', () => ({ getCustomerPurchaseReport: mocks.report }));
vi.mock('@/lib/admin/customer-purchase-workbook.server', () => ({ buildCustomerPurchaseWorkbook: mocks.workbook }));
import { GET } from './route';
beforeEach(() => { vi.clearAllMocks(); mocks.workbook.mockResolvedValue(Buffer.from('xlsx')); mocks.report.mockResolvedValue({}); });
describe('고객 구매 분석 파일 경계', () => {
  it('현재 화면 권한을 검사한 뒤 집계한다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(GET(new Request('https://example.test/api/admin/customer-purchase-workbook'))).rejects.toThrow('forbidden');
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('잘못된 범위는 조회하지 않고 오류를 캐시하지 않는다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/customer-purchase-workbook?from=2026-02-30&to=2026-03-31'));
    expect(response.status).toBe(400); expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(mocks.report).not.toHaveBeenCalled();
  });
  it('선택된 조회·비교 조건의 새 파일을 내려준다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/customer-purchase-workbook?grain=month&from=2025-08-01&to=2025-08-31&compare=off'));
    expect(mocks.guard).toHaveBeenCalledWith('/admin/stats/customers');
    expect(mocks.report).toHaveBeenCalledWith(expect.objectContaining({ from: '2025-08-01', to: '2025-08-31', compare: false }));
    expect(response.headers.get('Content-Disposition')).toContain('icons-customer-purchase-report.xlsx');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
  it('집계 실패를 성공 파일로 변환하지 않는다', async () => {
    mocks.report.mockRejectedValueOnce(new Error('permission revoked'));
    const response = await GET(new Request('https://example.test/api/admin/customer-purchase-workbook'));
    expect(response.status).toBe(500); expect(mocks.workbook).not.toHaveBeenCalled();
  });
});

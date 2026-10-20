import { beforeEach, describe, expect, it, vi } from 'vitest';
import { salesHourlyFixture } from './stats-hourly.test-fixtures';
import { normalizeAdminSalesHourlyFilters } from './stats-hourly';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), client: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.client }));
import { getAdminSalesHourlyReport } from './stats-hourly.server';
beforeEach(() => { mocks.rpc.mockReset(); mocks.client.mockReset().mockResolvedValue({ rpc: mocks.rpc }); });
describe('시간대별 판매 서버 읽기', () => {
  it('DB가 오늘과 기본 비교일·마감시각을 한 번 결정한다', async () => {
    mocks.rpc.mockResolvedValue({ data: salesHourlyFixture(), error: null });
    const result = await getAdminSalesHourlyReport(normalizeAdminSalesHourlyFilters({}));
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('admin_sales_hourly_report', { p_compare_date: null, p_ip_id: null, p_cutoff: null });
    expect(result.completedHours).toBe(7);
  });
  it('입력 오류에서는 DB를 읽지 않는다', async () => {
    await expect(getAdminSalesHourlyReport(normalizeAdminSalesHourlyFilters({ compareDate: 'bad' }))).rejects.toMatchObject({ code: 'invalid_filters' });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([['42501', 'forbidden'], ['22023', 'invalid_filters'], ['57014', 'read_failed']])('DB 오류 %s를 빈 값 대신 명시 오류로 전달한다', async (code, expected) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: 'internal detail' } });
    await expect(getAdminSalesHourlyReport(normalizeAdminSalesHourlyFilters({}))).rejects.toMatchObject({ code: expected });
  });
  it('잘린 응답을 정상 0건으로 취급하지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: { ...salesHourlyFixture(), hours: [] }, error: null });
    await expect(getAdminSalesHourlyReport(normalizeAdminSalesHourlyFilters({}))).rejects.toMatchObject({ code: 'read_failed' });
  });
});

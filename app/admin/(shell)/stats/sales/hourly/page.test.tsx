import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SalesHourlyReadError } from '@/lib/admin/stats-hourly';
import { salesHourlyFixture } from '@/lib/admin/stats-hourly.test-fixtures';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), load: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/stats-hourly.server', () => ({ getAdminSalesHourlyReport: mocks.load }));
import Page from './page';
beforeEach(() => { mocks.guard.mockReset().mockResolvedValue({}); mocks.load.mockReset().mockResolvedValue(salesHourlyFixture()); });
describe('시간대 판매 page', () => {
  it('stats.read 화면 게이트가 데이터 로더보다 먼저다', async () => {
    mocks.guard.mockRejectedValue(new Error('denied'));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toThrow('denied');
    expect(mocks.guard).toHaveBeenCalledWith('/admin/stats/sales/hourly'); expect(mocks.load).not.toHaveBeenCalled();
  });
  it('유효한 조건은 한 번의 전체 응답으로 읽는다', async () => {
    await Page({ searchParams: Promise.resolve({ compareDate: '2026-10-07', ip: 'hourly-ip' }) });
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith({ comparisonDate: '2026-10-07', ipId: 'hourly-ip', cutoff: null });
  });
  it('입력 오류는 조회하지 않고, 서버 날짜 경계 오류는 조건 수정 화면으로 보낸다', async () => {
    const invalid = await Page({ searchParams: Promise.resolve({ compareDate: '2026-02-30' }) });
    expect(mocks.load).not.toHaveBeenCalled(); expect(invalid.props.children.props.error).toBeTruthy();
    mocks.load.mockRejectedValue(new SalesHourlyReadError('invalid_filters'));
    const stale = await Page({ searchParams: Promise.resolve({}) }); expect(stale.props.children.props.error).toContain('최신 현황');
  });
  it.each(['forbidden', 'read_failed'] as const)('실제 %s 오류를 빈 데이터로 바꾸지 않는다', async code => {
    mocks.load.mockRejectedValue(new SalesHourlyReadError(code));
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({ code });
  });
});

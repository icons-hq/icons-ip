import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), report: vi.fn(), issuances: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/access', () => ({ canAccessAdminScreen: () => true }));
vi.mock('@/lib/admin/benefit-report.server', () => ({ getBenefitReport: mocks.report, getBenefitIssuances: mocks.issuances }));
import Page from './page';

beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({}); mocks.report.mockResolvedValue({}); mocks.issuances.mockResolvedValue({ rows: [], totalCount: 0, paidUseCount: 0, asOf: '2026-10-14T00:00:00Z' }); });

describe('혜택 리포트 발급 상세 페이지', () => {
  it('권한과 날짜 검사 전에 발급 내역을 읽지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('denied'));
    await expect(Page({ searchParams: Promise.resolve({ code: 'ABC', detail: 'issuances' }) })).rejects.toThrow('denied');
    await Page({ searchParams: Promise.resolve({ code: 'ABC', detail: 'issuances', from: '2026-02-30', to: '2026-03-01' }) });
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.issuances).not.toHaveBeenCalled();
  });
  it('기존 상세와 비교는 유지하며 선택한 발급 상세를 한 번 읽는다', async () => {
    await Page({ searchParams: Promise.resolve({ code: 'ABC' }) });
    expect(mocks.issuances).not.toHaveBeenCalled();
    vi.clearAllMocks();
    const result = await Page({ searchParams: Promise.resolve({ code: 'ABC', detail: 'issuances', page: '2', compare: 'previous', from: '2026-10-01', to: '2026-10-12' }) });
    expect(mocks.report).toHaveBeenCalledTimes(2);
    expect(mocks.issuances).toHaveBeenCalledTimes(1);
    expect(mocks.issuances).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC', detail: 'issuances', page: 2 }), expect.any(Date));
    expect(result.props.issuances).toMatchObject({ totalCount: 0, rows: [] });
  });
  it('발급 조회 오류를 정상 0건 상세로 바꾸지 않는다', async () => {
    mocks.issuances.mockRejectedValueOnce(new Error('read failed'));
    await expect(Page({ searchParams: Promise.resolve({ code: 'ABC', detail: 'issuances' }) })).rejects.toThrow('read failed');
  });
});

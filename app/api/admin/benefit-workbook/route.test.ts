import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ guard: vi.fn(), report: vi.fn(), issuances: vi.fn(), workbook: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/benefit-report.server', () => ({ getBenefitReport: mocks.report, getBenefitIssuances: mocks.issuances }));
vi.mock('@/lib/admin/benefit-workbook.server', () => ({ buildBenefitWorkbook: mocks.workbook }));
import { GET } from './route';
import { BenefitIssuanceError } from '@/lib/admin/benefit-report';
beforeEach(() => { vi.clearAllMocks(); mocks.report.mockResolvedValue({}); mocks.issuances.mockResolvedValue({ rows: [], totalCount: 0, paidUseCount: 0, asOf: '2026-10-14T00:00:00Z' }); mocks.workbook.mockResolvedValue(Buffer.from('xlsx')); });
describe('혜택 리포트 다운로드', () => {
  it('화면 권한 거절과 잘못된 날짜 뒤에는 데이터를 읽지 않는다', async () => {
    mocks.guard.mockRejectedValueOnce(new Error('forbidden'));
    await expect(GET(new Request('https://example.test/api/admin/benefit-workbook'))).rejects.toThrow('forbidden');
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.issuances).not.toHaveBeenCalled();
    expect((await GET(new Request('https://example.test/api/admin/benefit-workbook?from=2026-02-30&to=2026-03-01'))).status).toBe(400);
    expect(mocks.report).not.toHaveBeenCalled();
  });
  it('조회조건 전체와 직전기간을 읽어 private 파일로 내린다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/benefit-workbook?from=2026-10-01&to=2026-10-12&q=benefit&code=ABC&compare=previous&page=3'));
    expect(mocks.report).toHaveBeenNthCalledWith(1, expect.objectContaining({ query: 'benefit', code: 'ABC' }), expect.any(Date), true);
    expect(mocks.report).toHaveBeenNthCalledWith(2, expect.objectContaining({ from: '2026-09-19', to: '2026-09-30', query: 'benefit', code: 'ABC' }), expect.any(Date));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.issuances).not.toHaveBeenCalled();
  });
  it('발급 상세를 선택해도 기존 사용 이력의 한도를 함께 적용한다', async () => {
    mocks.report.mockRejectedValueOnce(new Error('benefit_export_limit'));
    const response = await GET(new Request('https://example.test/api/admin/benefit-workbook?code=ABC&detail=issuances'));
    expect(response.status).toBe(400);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.workbook).not.toHaveBeenCalled();
  });
  it('발급 상세만 한 번 전체 조회하고 현재 조건의 파일에 함께 전달한다', async () => {
    const response = await GET(new Request('https://example.test/api/admin/benefit-workbook?from=2026-10-01&to=2026-10-12&q=50%25&code=ABC&detail=issuances&compare=previous&page=3&bucket=month'));
    expect(response.status).toBe(200);
    expect(mocks.issuances).toHaveBeenCalledTimes(1);
    expect(mocks.issuances).toHaveBeenCalledWith(expect.objectContaining({ code: 'ABC', detail: 'issuances', query: '50%', bucket: 'month', page: 3 }), expect.any(Date), true);
    expect(mocks.workbook).toHaveBeenCalledWith({}, {}, expect.objectContaining({ detail: 'issuances' }), expect.any(Date), expect.objectContaining({ totalCount: 0, rows: [] }));
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([
    ['benefit_issuance_export_limit', 400], ['benefit_issuance_invalid_filters', 400],
    ['benefit_issuance_forbidden', 403], ['benefit_issuance_read_failed', 500],
  ] as const)('발급 상세 오류 %s를 %s로 반환하고 파일은 생성하지 않는다', async (code, status) => {
    mocks.issuances.mockRejectedValueOnce(new BenefitIssuanceError(code));
    const response = await GET(new Request('https://example.test/api/admin/benefit-workbook?code=ABC&detail=issuances'));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.workbook).not.toHaveBeenCalled();
  });
});

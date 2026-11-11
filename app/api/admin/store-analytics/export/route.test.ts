import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ guard: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/admin/guard.server', () => ({ requireAdminScreenAccess: mocks.guard }));
vi.mock('@/lib/admin/store-analytics.server', () => ({ getTrafficReport: mocks.report }));
vi.mock('next/navigation', () => ({ unstable_rethrow: vi.fn() }));
import { GET } from './route';

const metrics = { sessions: 1200, pageViews: 3400, productViews: 800, linkLandings: 50, orders: 12, convertedSessions: 10, conversionRate: 3.25, grossAmount: 1500000, refundAmount: 10000, netAmount: 1490000 };
const report = {
  from: '2026-10-01', to: '2026-10-07', comparisonFrom: null, comparisonTo: null, selectedLabel: null, total: 1, observedAt: '2026-10-07T15:00:00Z',
  collection: { enabled: true }, coverage: { observed_days: 7, partial_days: 0, missing_days: 0, archived_days: 0 },
  rows: [{ key: '=direct', label: '직접', metrics, comparison: null, archived: false, observedUntil: '2026-10-07T14:30:00Z' }],
  trend: [{ date: '2026-10-01', metrics: { ...metrics, conversionRate: null, grossAmount: null }, states: ['observed'], archived: false }],
};
const request = (query = 'from=2026-10-01&to=2026-10-07&dimension=channel') => new Request(`https://example.test/api/admin/store-analytics/export?${query}`);

beforeEach(() => { vi.clearAllMocks(); mocks.guard.mockResolvedValue({}); mocks.report.mockResolvedValue(report); });

describe('방문·유입 엑셀', () => {
  it('공용 모양·숫자 셀·KST 문자열과 맨 뒤 내려받기 정보로 만든다', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(decodeURIComponent(response.headers.get('content-disposition')!)).toMatch(/icons-방문유입분석-\d{8}-\d{4}\.xlsx/);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as never);
    expect(book.worksheets.map(sheet => sheet.name)).toEqual(['분석 결과', '추이', '내려받기 정보']);
    const sheet = book.worksheets[0], trend = book.worksheets[1];
    for (const table of [sheet, trend]) {
      expect(table.getCell('A1').font).toMatchObject({ name: '맑은 고딕', size: 10, bold: true });
      expect(table.getCell('A1').fill).toMatchObject({ fgColor: { argb: 'FFEFF2F0' } });
      expect(table.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(table.autoFilter).toBeTruthy();
    }
    expect(sheet.getCell('A2').value).toBe('=direct'); expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
    expect(sheet.getCell('C2').value).toBe(1200); expect(sheet.getCell('C2').numFmt).toBe('#,##0');
    expect(sheet.getCell('I2').value).toBe(3.25); expect(sheet.getCell('I2').numFmt).toBe('#,##0.00');
    expect(sheet.getCell('J2').value).toBe(1500000); expect(sheet.getCell('J2').numFmt).toBe('#,##0');
    expect(sheet.getCell('Q2').value).toBe('2026-10-07 23:30');
    expect(trend.getCell('F2').value).toBeNull();
    const info = JSON.stringify(book.worksheets[2].getSheetValues());
    expect(info).toContain('방문·유입 분석'); expect(info).toContain('2026-10-08 00:00'); expect(info).not.toContain('2026-10-07T15:00:00Z');
  });
  it('마케팅 링크 성과는 화면 이름으로 내려받는다', async () => {
    const response = await GET(request('from=2026-10-01&to=2026-10-07&dimension=link'));
    expect(decodeURIComponent(response.headers.get('content-disposition')!)).toMatch(/icons-마케팅링크성과-\d{8}-\d{4}\.xlsx/);
  });
  it('10,000개를 넘으면 파일을 만들지 않는다', async () => {
    mocks.report.mockResolvedValue({ ...report, total: 10001 });
    expect((await GET(request())).status).toBe(400);
  });
});

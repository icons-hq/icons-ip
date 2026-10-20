import ExcelJS from 'exceljs';
import { expect, it } from 'vitest';
import { buildBenefitWorkbook } from './benefit-workbook.server';
import { normalizeBenefitReportFilters, type BenefitIssuances, type BenefitReport } from './benefit-report';

it('내보낸 요약·전체행·주간 합계·안전한 문자열·조회조건이 일치한다', async () => {
  const summary = { issued: 2, paidUses: 7, discountAmount: 7000, orderAmount: 35000, released: 1, cohortPaidUses: 1 };
  const report: BenefitReport = { summary, daily: [{ date: '2026-10-01', ...summary }], couponCount: 1, coupons: [{ code: 'QA-COUPON', name: '=HYPERLINK("bad")', ...summary }], useCount: 1, uses: [{ id: 'use-1', orderId: 'order-1', appliedAt: '2026-09-30T15:00:00Z', releasedAt: null, status: 'paid', discountAmount: 1000, orderAmount: 5000 }] };
  const filters = normalizeBenefitReportFilters({ from: '2026-10-01', to: '2026-10-12', bucket: 'week', code: 'QA-COUPON', q: '조건' });
  const bytes = await buildBenefitWorkbook(report, null, filters, new Date('2026-10-12T10:00:00Z'));
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
  expect(book.getWorksheet('요약')?.getRow(2).values).toEqual([, '조회기간', 2, 7, 7000, 35000, 1, 0.5]);
  expect(book.getWorksheet('요약')?.getCell('G2').numFmt).toBe('0.0%');
  expect(book.getWorksheet('혜택별 지급현황')?.getCell('B2').type).toBe(ExcelJS.ValueType.String);
  expect(book.getWorksheet('기간별 추이')?.getCell('A2').value).toBe('2026-09-28');
  expect(book.getWorksheet('사용 상세')?.getCell('D2').value).toBe('결제 완료');
  expect(book.getWorksheet('조회 기준')?.getCell('B4').value).toBe('조건');
});

const emptyMetrics = { issued: 0, paidUses: 0, discountAmount: 0, orderAmount: 0, released: 0, cohortPaidUses: 0 };
const emptyReport: BenefitReport = { summary: emptyMetrics, daily: [], coupons: [], couponCount: 0, uses: [], useCount: 0 };
const issuanceFilters = normalizeBenefitReportFilters({ from: '2026-10-01', to: '2026-10-12', code: 'ABC', detail: 'issuances', page: '2', compare: 'previous' });
const issuanceData: BenefitIssuances = {
  totalCount: 51, paidUseCount: 1, asOf: '2026-10-12T14:59:59Z',
  rows: Array.from({ length: 51 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, couponCode: 'ABC', issuedAt: '2026-09-30T15:00:00Z', isPaidUse: index === 0 })),
};

it('발급 상세 전체행·현재 사용 집계와 숫자형 KST 날짜를 보존하고 기존 시트를 유지한다', async () => {
  const bytes = await buildBenefitWorkbook(emptyReport, emptyReport, issuanceFilters, new Date('2026-10-12T15:00:00Z'), issuanceData);
  const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as unknown as Parameters<typeof book.xlsx.load>[0]);
  expect(book.worksheets.map(sheet => sheet.name)).toEqual(['요약', '혜택별 지급현황', '기간별 추이', '비교기간 추이', '사용 상세', '발급 상세', '조회 기준']);
  const sheet = book.getWorksheet('발급 상세')!;
  expect(sheet.rowCount).toBe(52);
  expect(sheet.getRow(1).values).toEqual([, '발급 ID', '쿠폰 ID', '발급일시(KST)', '현재 결제 사용 집계 여부']);
  expect(sheet.getCell('A52').value).toBe(issuanceData.rows[50].id);
  expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell('C2').type).toBe(ExcelJS.ValueType.Date);
  expect((sheet.getCell('C2').value as Date).toISOString()).toBe('2026-10-01T00:00:00.000Z');
  expect(sheet.getCell('C2').numFmt).toBe('yyyy-mm-dd hh:mm:ss');
  expect(sheet.getCell('D2').value).toBe('예');
  expect(sheet.getCell('D52').value).toBe('아니오');
  const info = new Map<string, ExcelJS.CellValue>();
  book.getWorksheet('조회 기준')!.eachRow(row => info.set(String(row.getCell(1).value), row.getCell(2).value));
  expect(info.get('발급 상세 전체 건수')).toBe(51);
  expect(info.get('발급 상세 현재 결제 사용수')).toBe(1);
  expect((info.get('발급 상세 조회시각(KST)') as Date).toISOString()).toBe('2026-10-12T23:59:59.000Z');
  expect(info.get('현재 결제 사용 집계 여부')).toContain('사용 가능·미사용·환불 완료를 뜻하지 않음');
  expect(sheet.columnCount).toBe(4);
});

it('기존 다운로드에는 발급 시트를 추가하지 않고 명시된 빈 상세는 빈 목록으로 내보낸다', async () => {
  const legacyBytes = await buildBenefitWorkbook(emptyReport, null, { ...issuanceFilters, detail: 'uses' }, new Date(), issuanceData);
  const legacy = new ExcelJS.Workbook(); await legacy.xlsx.load(legacyBytes as unknown as Parameters<typeof legacy.xlsx.load>[0]);
  expect(legacy.getWorksheet('발급 상세')).toBeUndefined();
  const emptyBytes = await buildBenefitWorkbook(emptyReport, null, issuanceFilters, new Date(), { ...issuanceData, totalCount: 0, paidUseCount: 0, rows: [] });
  const empty = new ExcelJS.Workbook(); await empty.xlsx.load(emptyBytes as unknown as Parameters<typeof empty.xlsx.load>[0]);
  expect(empty.getWorksheet('발급 상세')?.rowCount).toBe(1);
});

it('발급 상세 누락·페이지 일부·10000건 초과를 완성된 파일로 만들지 않는다', async () => {
  await expect(buildBenefitWorkbook(emptyReport, null, issuanceFilters)).rejects.toMatchObject({ code: 'benefit_issuance_read_failed' });
  await expect(buildBenefitWorkbook(emptyReport, null, issuanceFilters, new Date(), { ...issuanceData, rows: issuanceData.rows.slice(0, 50) })).rejects.toMatchObject({ code: 'benefit_issuance_read_failed' });
  await expect(buildBenefitWorkbook(emptyReport, null, issuanceFilters, new Date(), { ...issuanceData, totalCount: 10001 })).rejects.toMatchObject({ code: 'benefit_issuance_export_limit' });
});

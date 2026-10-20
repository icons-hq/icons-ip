import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildStatsWorkbook } from './stats-workbook.server';
import type { AdminSalesGoodRow } from './stats';
import { normalizeAdminStatsFilters } from './stats';

const allGoods = (rows: AdminSalesGoodRow[] = []) => ({ rows: rows.map((row, index) => ({ ...row, rank: index + 1 })), totalCount: rows.length, page: 1, pageSize: 10001, asOf: '2026-10-14T00:00:00Z' });

describe('통계 엑셀', () => {
  it('실제 숫자·상품 식별자·직전기간·조회조건을 시트별로 보존한다', async () => {
    const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-02', compare: 'previous' });
    const data = { daily: [{ date: '2026-10-01', orderCount: 2, revenue: 15000, averageOrderValue: 7500 }], paymentMethods: [], goods: [{ goodId: '0000123', name: '=HYPERLINK("https://example.test")', ipId: 'test', qty: 2, revenue: 15000 }], tickets: [], ticketOccurrences: [] };
    const bytes = await buildStatsWorkbook({ kind: 'sales', data, goods: allGoods(data.goods), comparison: { ...data, daily: [] }, comparisonGoods: allGoods(data.goods) }, filters, new Date('2026-10-12T06:00:00Z'));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('매출 추이')?.getCell('C2').value).toBe(15000);
    expect(book.getWorksheet('매출 추이')?.getCell('C3').value).toBe(0);
    expect(book.getWorksheet('상품 전체')?.getCell('B2').value).toBe('0000123');
    expect(book.getWorksheet('상품 전체')?.getCell('C2').type).toBe(ExcelJS.ValueType.String);
    expect(book.getWorksheet('비교 매출 추이')?.getCell('A2').value).toBe('2026-09-29');
    expect(JSON.stringify(book.getWorksheet('조회 정보')?.getSheetValues())).toContain('2026-10-02');
  });
  it('요청 철회와 진행을 구분하고 집계 불가 값은 0으로 바꾸지 않는다', async () => {
    const bytes = await buildStatsWorkbook({ kind: 'claims', data: { orderCount: 0, claimCount: 2, byType: [{ claimType: 'return', total: 2, completed: 0, rejected: 0, withdrawn: 1, open: 1, ratePerMille: null }], byReason: [], refunds: { completedCount: 0, averageHours: null, within72h: 0 } } }, { days: 30, ipId: '' });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('유형별 클레임')?.getCell('E2').value).toBe(1);
    expect(book.getWorksheet('유형별 클레임')?.getCell('F2').value).toBe(1);
    expect(book.getWorksheet('유형별 클레임')?.getCell('G2').value).toBeNull();
  });
  it('전년 윤일 보정 뒤의 실제 날짜·금액과 비교 방식 설명을 재열어 확인한다', async () => {
    const filters = normalizeAdminStatsFilters({ from: '2024-02-28', to: '2024-03-01', compare: 'year', ip: 'sample' });
    const data = { daily: [{ date: '2024-02-29', orderCount: 2, revenue: 14000, averageOrderValue: 7000 }], paymentMethods: [], goods: [], tickets: [], ticketOccurrences: [] };
    const comparison = { ...data, daily: [{ date: '2023-02-28', orderCount: 1, revenue: 5000, averageOrderValue: 5000 }] };
    const bytes = await buildStatsWorkbook({ kind: 'sales', data, goods: allGoods(), comparison, comparisonGoods: allGoods() }, filters, new Date('2026-10-14T00:00:00Z'));
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    const current = book.getWorksheet('매출 추이')!; const previous = book.getWorksheet('비교 매출 추이')!;
    expect(current.rowCount).toBe(4); expect(previous.rowCount).toBe(3);
    expect(current.getCell('A3').value).toBe('2024-02-29'); expect(current.getCell('C3').value).toBe(14000);
    expect(previous.getCell('A2').value).toBe('2023-02-28'); expect(previous.getCell('A3').value).toBe('2023-03-01'); expect(previous.getCell('C2').value).toBe(5000);
    const info = JSON.stringify(book.getWorksheet('조회 정보')!.getSheetValues());
    expect(info).toContain('전년 동일 날짜 비교'); expect(info).toContain('2023-02-28 ~ 2023-03-01'); expect(info).toContain('sample');
    expect(info).toContain('2월 29일은 2월 28일'); expect(info).toContain('비교기간의 일수가 달라질 수');
  });
  it.each(['week', 'month'] as const)('전년 고객 가입 %s 추이는 비교기간 날짜와 집계 합계를 사용한다', async bucket => {
    const filters = normalizeAdminStatsFilters({ from: '2025-02-28', to: '2025-03-01', compare: 'year', bucket });
    const data = { signups: [], signupTotal: 0, buyerCount: 0, repeatBuyerCount: 0, inquiries: { total: 0, unanswered: 0, averageFirstResponseHours: null }, reviews: { total: 0, unanswered: 0, averageRating: null, distribution: [0, 0, 0, 0, 0] } };
    const comparison = { ...data, signupTotal: 7, signups: [{ date: '2024-02-28', total: 2 }, { date: '2024-02-29', total: 3 }, { date: '2024-03-01', total: 2 }] };
    const bytes = await buildStatsWorkbook({ kind: 'customers', data, comparison }, filters);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    const trend = book.getWorksheet('비교 가입 추이')!;
    if (bucket === 'week') { expect(trend.getCell('A2').value).toBe('2024-02-26'); expect(trend.getCell('B2').value).toBe(7); }
    else { expect(trend.getCell('A2').value).toBe('2024-02'); expect(trend.getCell('B2').value).toBe(5); expect(trend.getCell('A3').value).toBe('2024-03'); expect(trend.getCell('B3').value).toBe(2); }
    expect(JSON.stringify(book.getWorksheet('조회 정보')!.getSheetValues())).toContain('2024-02-28 ~ 2024-03-01');
  });
  it('21위 이후 전체 상품과 비교기간 전체를 파일에 담고 요약 TOP20을 섞지 않는다', async () => {
    const filters = normalizeAdminStatsFilters({ from: '2025-02-28', to: '2026-02-28', compare: 'year', ip: 'qa' });
    const rows = Array.from({ length: 45 }, (_, index) => ({ goodId: `00${index + 1}`, name: `상품 ${index + 1}`, ipId: 'qa', qty: 2, revenue: 1000 }));
    const data = { daily: [], paymentMethods: [], goods: rows.slice(0, 20), tickets: [], ticketOccurrences: [] };
    const bytes = await buildStatsWorkbook({ kind: 'sales', data, goods: allGoods(rows), comparison: data, comparisonGoods: allGoods(rows.slice(0, 31)) }, filters);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    const goods = book.getWorksheet('상품 전체')!;
    expect(goods.rowCount).toBe(46); expect(goods.getCell('A22').value).toBe(21);
    expect(goods.getCell('B46').value).toBe('0045'); expect(goods.getCell('F46').value).toBe(1000);
    expect(book.getWorksheet('비교 상품 전체')!.rowCount).toBe(32);
    expect(book.getWorksheet('상품 TOP20')).toBeUndefined();
    expect(book.getWorksheet('이벤트 TOP20')).toBeDefined(); expect(book.getWorksheet('회차 TOP20')).toBeDefined();
    const info = JSON.stringify(book.getWorksheet('조회 정보')!.getSheetValues());
    expect(info).toContain('2024-02-28 ~ 2025-02-28'); expect(info).toContain('상품 전체 건수');
    expect(info).toContain('최대 10,000개'); expect(info).not.toContain('현재 화면과 같은 상위 20개');
    expect(book.getWorksheet('비교 매출 추이')!.rowCount).toBe(368);
  });
  it('부분 페이지나 비교 상품 누락으로 전체 파일을 생성하지 않는다', async () => {
    const data = { daily: [], paymentMethods: [], goods: [], tickets: [], ticketOccurrences: [] };
    const filters = normalizeAdminStatsFilters({ from: '2026-10-01', to: '2026-10-02', compare: 'year' });
    await expect(buildStatsWorkbook({ kind: 'sales', data, goods: { ...allGoods(), totalCount: 45 } }, filters)).rejects.toThrow('Incomplete');
    await expect(buildStatsWorkbook({ kind: 'sales', data, goods: allGoods(), comparison: data }, filters)).rejects.toThrow('Missing comparison');
    await expect(buildStatsWorkbook({ kind: 'sales', data, goods: { ...allGoods(), totalCount: 10001 } }, filters)).rejects.toThrow('10,000');
  });

});

import { describe, expect, it } from 'vitest';
import { buildAdminListExportWorkbook } from './list-export.server';
import { ADMIN_LIST_EXPORT_PRIVACY_NOTICE, ADMIN_LIST_EXPORT_ROW_LIMIT, type AdminListExportSheet } from './list-export';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';

function sheet(overrides: Partial<AdminListExportSheet> = {}): AdminListExportSheet {
  return {
    screen: 'dispatch',
    title: '발주·발송 관리 - 발송 대기',
    columns: [
      { header: '주문번호', kind: 'code', width: 12 },
      { header: '연락처', kind: 'code', width: 14 },
      { header: '우편번호', kind: 'code', width: 8 },
      { header: '상품명', kind: 'text', width: 30 },
      { header: '수량', kind: 'count', width: 8 },
      { header: '결제금액', kind: 'amount', width: 12 },
    ],
    rows: [
      ['00AB12CD', '01012345678', '04524', '=HYPERLINK("https://example.test","열기")', 2, 1_234_000],
      ['00AB12CE', null, '00001', '+SUM(A1:A2)', 1, null],
    ],
    recordCount: 2,
    conditions: [['탭', '발송 대기'], ['검색어', '전체']],
    notes: ['한 행은 배송 건의 상품 한 줄입니다.'],
    filters: { tab: 'ready' },
    ...overrides,
  };
}

describe('목록 엑셀 워크북', () => {
  it('머리글을 고정하고 번호는 텍스트, 금액은 천 단위 숫자 셀로 쓴다', async () => {
    const bytes = await buildAdminListExportWorkbook(sheet(), new Date('2026-10-07T06:04:00.000Z'));
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    const data = workbook.worksheets[0];
    expect(data.name).toBe('발주·발송 관리 - 발송 대기');
    expect(data.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(data.getRow(1).getCell(1).value).toBe('주문번호');
    expect(data.getRow(1).getCell(1).font?.bold).toBe(true);
    expect(data.autoFilter).toBeTruthy();

    const first = data.getRow(2);
    expect(first.getCell(1).value).toBe('00AB12CD');
    expect(first.getCell(2).value).toBe('01012345678');
    expect(first.getCell(2).numFmt).toBe('@');
    expect(first.getCell(3).value).toBe('04524');
    expect(first.getCell(5).value).toBe(2);
    expect(first.getCell(6).value).toBe(1_234_000);
    expect(first.getCell(6).numFmt).toBe('#,##0');
    expect(data.getRow(3).getCell(6).value).toBeNull();
  });

  it('수식처럼 보이는 문자열도 계산되지 않는 텍스트로 남는다', async () => {
    const bytes = await buildAdminListExportWorkbook(sheet(), new Date('2026-10-07T06:04:00.000Z'));
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    for (const worksheet of workbook.worksheets) {
      worksheet.eachRow((row) => row.eachCell((cell) => {
        expect(readSafeWorkbookCell(cell).error, `${worksheet.name}!${cell.address}`).toBeUndefined();
      }));
    }
    const data = workbook.worksheets[0];
    expect(data.getRow(2).getCell(4).value).toBe('=HYPERLINK("https://example.test","열기")');
    expect(data.getRow(3).getCell(4).value).toBe('+SUM(A1:A2)');
  });

  it('안내 시트에 화면·조건·KST 시각·건수·개인정보 주의를 남긴다', async () => {
    const bytes = await buildAdminListExportWorkbook(sheet(), new Date('2026-10-07T06:04:00.000Z'));
    const workbook = await loadSafeWorkbook(bytes, { fileBytes: 5 * 1024 * 1024 });
    const info = workbook.getWorksheet('내려받기 정보')!;
    const lines = new Map<string, string[]>();
    info.eachRow((row) => {
      const key = String(row.getCell(1).value);
      lines.set(key, [...(lines.get(key) ?? []), String(row.getCell(2).value)]);
    });
    expect(lines.get('화면')).toEqual(['발주·발송 관리']);
    expect(lines.get('탭')).toEqual(['발송 대기']);
    expect(lines.get('내려받은 시각 (KST)')).toEqual(['2026-10-07 15:04']);
    expect(lines.get('건수')).toEqual(['2건 · 엑셀 2행']);
    expect(lines.get('안내')).toEqual(['한 행은 배송 건의 상품 한 줄입니다.']);
    expect(lines.get('개인정보')).toEqual([ADMIN_LIST_EXPORT_PRIVACY_NOTICE]);
  });

  it('상한을 넘는 행은 파일로 만들지 않는다', async () => {
    const rows = Array.from({ length: ADMIN_LIST_EXPORT_ROW_LIMIT + 1 }, () => ['x', null, null, null, 1, 1]);
    await expect(buildAdminListExportWorkbook(sheet({ rows }), new Date())).rejects.toThrow('최대 10,000건');
  });
});

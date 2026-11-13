import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseTrackingWorkbook } from './tracking-workbook.server';
import { parseSmartStoreReplyText } from './smartstore-tracking-workbook.server';
import { trackingImportCommand } from './warehouse-templates.server';

const item = '60000000-0000-4000-8000-000000000001';
const other = '60000000-0000-4000-8000-000000000002';
const headers = ['운송장번호', '상품주문번호', '택배사'];
const carriers = [{ code: 'hanjin', label: '한진택배', active: true, trackingUrlTemplate: 'https://example.test/{trackingNumber}' },
  { code: 'inactive', label: '비활성택배', active: false, trackingUrlTemplate: 'https://example.test/{trackingNumber}' }];
async function bytes(rows: unknown[][], name = '아무 시트 이름', columns = headers) {
  const book = new ExcelJS.Workbook(); book.addWorksheet(name).addRows([columns, ...rows]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
function expectStandard(parsed: Awaited<ReturnType<typeof parseTrackingWorkbook>>) {
  if (!('kind' in parsed) || parsed.kind !== 'smartstore') throw new Error('Expected ICONS standard reply');
  return parsed;
}

describe('ICONS 표준 양식 회신', () => {
  it('시트 이름·열 순서와 관계없이 등록된 택배사와 운송장번호를 읽는다', async () => {
    const parsed = expectStandard(await parseTrackingWorkbook(await bytes([['001234567890', item, '한진택배']]), carriers));
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [
      { line: 2, reference: item, carrier: 'hanjin', trackingNumber: '001234567890' },
    ] } });
  });
  it('열 수를 제한하지 않는다', async () => {
    const wide = [...headers, ...Array.from({ length: 80 }, (_, index) => `추가 ${index}`)];
    const parsed = await parseTrackingWorkbook(await bytes([['001234567890', item, 'hanjin']], '목록', wide), carriers);
    expect(parsed.issues).toEqual([]); expect(parsed.rows).toHaveLength(1);
  });
  it('잘못된 행을 같은 배송 묶음의 RPC 검사까지 원래 순서로 남긴다', async () => {
    const parsed = expectStandard(await parseTrackingWorkbook(await bytes([[1234567890, item, 'hanjin'], ['001234567890', other, 'hanjin']]), carriers));
    expect(parsed.rows).toHaveLength(1); expect(parsed.issues[0]).toMatchObject({ line: 2, reference: item });
    expect(trackingImportCommand(parsed, '').args.target_rows).toEqual([
      { line: 2, reference: item, carrier: '', trackingNumber: '' },
      { line: 3, reference: other, carrier: 'hanjin', trackingNumber: '001234567890' },
    ]);
  });
  it('사용하지 않는 택배사·숫자 번호·수식·짧은 번호를 거절한다', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([
      ['001234567890', other, 'inactive'],
      ['001234567890', 2026102012345678, 'hanjin'],
      [{ formula: '1+1' }, item, 'hanjin'],
      ['001234567890', '00000001', 'hanjin'],
    ]), carriers);
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map(issue => issue.line)).toEqual([2, 3, 4, 5]);
    expect(parsed.issues[2].reason).toContain('수식');
  });
  it('어느 칸이 숫자인지 말하고, 빈 운송장·택배사는 비어 있다고 알린다', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([
      [1234567890, item, 'hanjin'],
      ['001234567890', 2026102012345678, 'hanjin'],
      ['', other, 'hanjin'],
      ['001234567890', '60000000-0000-4000-8000-000000000003', ''],
    ]), carriers);
    expect(parsed.issues.map(issue => issue.reason)).toEqual([
      '운송장번호는 숫자 대신 텍스트 형식으로 입력해주세요.',
      '상품주문번호는 숫자 대신 텍스트 형식으로 입력해주세요.',
      '택배사가 비어 있습니다.',
    ]);
    // 운송장 칸만 비운 줄은 실패가 아니라 건너뛴 줄이다(김포 회신과 같은 기준).
    expect((parsed as { skipped: unknown[] }).skipped).toEqual([{ line: 4, reference: other }]);
  });
  it('다른 칸의 수식도 거절한다', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([['001234567890', item, 'hanjin', { formula: '1+1' }]], '목록', [...headers, '메모']), carriers);
    expect(parsed.rows).toEqual([]); expect(parsed.issues[0].reason).toContain('수식');
  });
  it('필수 머리글은 각각 하나여야 하고 머리글의 수식은 거절한다', async () => {
    await expect(parseTrackingWorkbook(await bytes([], '목록', ['상품주문번호', '택배사', '운송장번호', '운송장번호']), carriers)).rejects.toThrow('각각 하나');
    await expect(parseTrackingWorkbook(await bytes([], '목록', ['상품주문번호', '택배사', '운송장번호', '송장번호']), carriers)).rejects.toThrow('각각 하나');
    await expect(parseTrackingWorkbook(await bytes([], '목록', ['상품주문번호', '운송장번호']), carriers)).rejects.toThrow('각각 하나');
    await expect(parseTrackingWorkbook(await bytes([], '목록', ['상품주문번호', '택배사', '운송장번호', '배송방법', '배송방법']), carriers)).rejects.toThrow('각각 하나');
    const book = new ExcelJS.Workbook(); book.addWorksheet('목록').addRow([...headers, { formula: '1+1' }]);
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('헤더의 수식');
  });
  it('내려받기 정보 시트는 표준 양식에서만 건너뛰고 수식이 있으면 거절한다', async () => {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('목록').addRows([headers, ['001234567890', item, 'hanjin']]);
    const info = book.addWorksheet('내려받기 정보'); info.addRow(['화면', '발주(주문)확인/발송관리']);
    expect((await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rows).toHaveLength(1);
    info.getCell('B1').value = { formula: '1+1' };
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('허용되지 않는 셀');
    info.getCell('B1').value = '일반 문구';
    info.getCell('C1').value = '세 번째 칸';
    await expect(parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers)).rejects.toThrow('내려받기 정보 시트의 형식');
    const plain = new ExcelJS.Workbook();
    plain.addWorksheet('운송장').addRows([['배송건번호', '택배사', '운송장번호'], ['00000001', 'hanjin', '12345678']]);
    plain.addWorksheet('내려받기 정보').addRow(['화면', '목록']);
    await expect(parseTrackingWorkbook(Buffer.from(await plain.xlsx.writeBuffer()), carriers)).rejects.toThrow('시트 하나');
  });
});

describe('ICONS 표준 양식 CSV·붙여넣기 회신', () => {
  const csv = (rows: string[][], columns = headers) => [columns, ...rows].map(row => row.join(',')).join('\r\n');

  it('12자리 운송장번호와 열 순서가 바뀐 CSV를 XLSX와 같은 명령으로 보낸다', () => {
    const parsed = parseSmartStoreReplyText(`\uFEFF${csv([['123456789012', item, '한진택배']])}`, carriers)!;
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [
      { line: 2, reference: item, carrier: 'hanjin', trackingNumber: '123456789012' },
    ] } });
  });
  it('따옴표 안의 쉼표·줄바꿈을 한 칸으로 읽고 줄 번호는 표의 행 번호다', () => {
    const text = '상품주문번호,배송메시지,택배사,운송장번호\r\n'
      + `"${item}","문 앞, 부탁\n합니다","한진택배","123456789012"\r\n`
      + `"${other}","경비실","한진택배",""\r\n`;
    const parsed = parseSmartStoreReplyText(text, carriers)!;
    expect(parsed.rows).toEqual([{ line: 2, reference: item, referenceId: item, carrier: 'hanjin', trackingNumber: '123456789012' }]);
    expect(parsed.issues).toEqual([]); expect(parsed.skipped).toEqual([{ line: 3, reference: other }]);
  });
  it('수식·비활성 택배사·짧은 번호를 XLSX와 똑같이 거절하고 다른 칸의 수식도 거절한다', () => {
    const parsed = parseSmartStoreReplyText(csv([
      ['=1+1', item, 'hanjin'],
      ['123456789012', other, 'inactive'],
      ['123456789012', '00000001', 'hanjin'],
      ['123456789012', item, '=hanjin'],
    ]), carriers)!;
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map(issue => issue.line)).toEqual([2, 3, 4, 5]);
    expect(parsed.issues[0].reason).toContain('수식');
    expect(parsed.issues[1].reason).toContain('사용하지 않는 택배사');
    expect(parsed.issues[2].reason).toContain('전체 상품주문번호');
    expect(parsed.issues[3].reason).toContain('수식');
    const other_cell = parseSmartStoreReplyText(csv([['123456789012', item, 'hanjin', '=SUM(A1:A2)']], [...headers, '메모']), carriers)!;
    expect(other_cell.rows).toEqual([]); expect(other_cell.issues[0].reason).toContain('수식');
    // 내려받은 CSV의 수식 방어 값(앞에 ')은 그대로 통과한다.
    expect(parseSmartStoreReplyText(csv([['123456789012', item, 'hanjin', "'=합성 상품"]], [...headers, '상품명']), carriers)!.rows).toHaveLength(1);
  });
  it('엑셀이 숫자로 바꾼 번호는 어느 칸인지 말하며 거절한다', () => {
    const parsed = parseSmartStoreReplyText(csv([['1.23457E+11', item, 'hanjin'], ['123456789012', '2.02610E+15', 'hanjin']]), carriers)!;
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues[0].reason).toContain('운송장번호가 숫자로 바뀌어');
    expect(parsed.issues[1].reason).toContain('상품주문번호가 숫자로 바뀌어');
  });
  it('열이 밀렸거나 따옴표가 닫히지 않은 줄의 값을 운송장으로 읽지 않는다', () => {
    const shifted = parseSmartStoreReplyText(`상품주문번호,주소,택배사,운송장번호\n${item},서울시,강남구,hanjin,123456789012`, carriers)!;
    expect(shifted.rows).toEqual([]); expect(shifted.issues[0].reason).toContain('머리글보다 칸이 많은');
    const unclosed = parseSmartStoreReplyText(`상품주문번호,주소,택배사,운송장번호\n${item},"서울시,hanjin,123456789012`, carriers)!;
    expect(unclosed.rows).toEqual([]); expect(unclosed.issues[0].reason).toContain('따옴표');
  });
  it('끝 칸이 잘린 줄은 빈칸으로 읽고 머리글 규칙은 XLSX와 같다', () => {
    const parsed = parseSmartStoreReplyText(csv([[item, 'hanjin', '123456789012']], ['상품주문번호', '택배사', '운송장번호', '메모']), carriers)!;
    expect(parsed.issues).toEqual([]); expect(parsed.rows).toHaveLength(1);
    expect(() => parseSmartStoreReplyText(csv([], ['상품주문번호', '택배사', '운송장번호', '송장번호']), carriers)).toThrow('각각 하나');
    expect(() => parseSmartStoreReplyText(csv([], ['상품주문번호', '운송장번호']), carriers)).toThrow('각각 하나');
  });
  it('옛 머리글(송장번호·배송방법) CSV와 탭으로 붙여넣은 표도 같은 규칙으로 읽는다', () => {
    const legacy = parseSmartStoreReplyText(csv([['123456789012', item, '택배,등기,소포', '한진택배'], ['123456789013', other, '방문수령', '한진택배']].map(([tracking, reference, method, carrier]) => [tracking, reference, `"${method}"`, carrier]), ['송장번호', '상품주문번호', '배송방법', '택배사']), carriers)!;
    expect(legacy.rows.map(row => row.line)).toEqual([2]);
    expect(legacy.issues).toMatchObject([{ line: 3, reason: expect.stringContaining('주문 상세') }]);
    const pasted = parseSmartStoreReplyText(`운송장번호\t상품주문번호\t택배사\n123456789012\t${item}\t한진택배`, carriers)!;
    expect(pasted.issues).toEqual([]); expect(pasted.rows).toHaveLength(1);
  });
  it('일반 세 칸 회신은 표준 양식으로 잡지 않는다', () => {
    expect(parseSmartStoreReplyText('배송건번호,택배사코드,운송장번호\n2026102130000001,hanjin,123456789012', carriers)).toBeNull();
    expect(parseSmartStoreReplyText('00000001,hanjin,12345678', carriers)).toBeNull();
  });
});

/* 2026-11-10 이전에 내려받은 파일이 창고·담당자 손에 남아 있다. 이 파일들은 고치지 않아도 올릴 수 있어야 한다. */
describe('이미 내려받은 옛 파일 회신 호환', () => {
  const legacy = ['송장번호', '상품주문번호', '배송방법', '택배사'];
  const fixture = new URL('./fixtures/smartstore-dispatch-20261020.xlsx', import.meta.url);
  async function legacyInstruction(fill: (sheet: ExcelJS.Worksheet, column: (header: string) => number) => void) {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await readFile(fixture) as never);
    const sheet = book.worksheets[0];
    const names = sheet.getRow(2).values as unknown as string[];
    fill(sheet, header => names.indexOf(header));
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  const fillRow = (rowNumber: number, reference: string) => (sheet: ExcelJS.Worksheet, column: (header: string) => number) => {
    sheet.getCell(rowNumber, column('상품주문번호')).value = reference;
    sheet.getCell(rowNumber, column('배송방법')).value = '택배,등기,소포';
    sheet.getCell(rowNumber, column('택배사')).value = '한진택배';
    sheet.getCell(rowNumber, column('송장번호')).value = '001234567890';
    // 옛 파일의 날짜 칸은 Excel 날짜 값이다.
    sheet.getCell(rowNumber, column('주문일시')).value = new Date('2026-10-20T01:30:00Z');
  };

  it('74열 출고지시를 안내 1행·시트명·배송방법·송장번호 그대로 받는다', async () => {
    const parsed = expectStandard(await parseTrackingWorkbook(await legacyInstruction(fillRow(3, item)), carriers));
    expect(parsed.issues).toEqual([]);
    expect(trackingImportCommand(parsed, '')).toEqual({ name: 'admin_import_item_tracking_batch', args: { target_rows: [
      { line: 3, reference: item, carrier: 'hanjin', trackingNumber: '001234567890' },
    ] } });
  });
  it('안내 1행을 지운 74열과 예전 안내대로 발송처리 시트로 바꾼 파일도 받는다', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await legacyInstruction(fillRow(3, item)) as never);
    const sheet = book.worksheets[0];
    sheet.unMergeCells('A1:C1'); sheet.unMergeCells('D1:F1'); sheet.spliceRows(1, 1); sheet.name = '발송처리';
    const parsed = await parseTrackingWorkbook(Buffer.from(await book.xlsx.writeBuffer()), carriers);
    expect(parsed.issues).toEqual([]); expect(parsed.rows[0]).toMatchObject({ line: 2, reference: item, carrier: 'hanjin' });
  });
  it('안내 행이 있는 74열은 데이터 1,000행을 받고 1,001행은 거절한다', async () => {
    const rows = (count: number) => async () => legacyInstruction((sheet, column) => { for (let row = 3; row < 3 + count; row++) sheet.getCell(row, column('상품주문번호')).value = item; });
    expect(((await parseTrackingWorkbook(await rows(1000)(), carriers)) as { skipped: unknown[] }).skipped).toHaveLength(1000);
    await expect(parseTrackingWorkbook(await rows(1001)(), carriers)).rejects.toThrow('1,000줄');
  });
  it('안내 행의 수식은 받지 않는다', async () => {
    const file = await legacyInstruction((sheet, column) => { fillRow(3, item)(sheet, column); sheet.getCell('G1').value = { formula: '1+1' }; });
    await expect(parseTrackingWorkbook(file, carriers)).rejects.toThrow('안내 행의 수식');
  });
  it('53열 목록을 시트 이름 그대로 받고 다른 칸의 날짜 값을 거절하지 않는다', async () => {
    const delivery = ['상품주문번호', '주문번호', '발송처리일', '주문상태', '배송속성', '풀필먼트사(주문 기준)', '배송방법', '택배사', '송장번호', '구매확정연장 상태', '판매채널', '구매자명'];
    const parsed = expectStandard(await parseTrackingWorkbook(await bytes([[item, '2026102110000001', new Date('2026-10-21T00:01:00Z'), '배송중', '', '', '택배,등기,소포', '한진택배', '001234567890', '', 'ICONS', '합성 구매자']], '배송현황관리', delivery), carriers));
    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([{ line: 2, reference: item, referenceId: item, carrier: 'hanjin', trackingNumber: '001234567890' }]);
  });
  it('배송방법은 택배 값만 받고 공백 차이와 빈칸은 택배로 본다', async () => {
    const parsed = await parseTrackingWorkbook(await bytes([
      ['001234567890', item, '택배, 등기, 소포', '한진택배'],
      ['001234567891', other, '택배', '한진택배'],
      ['001234567892', '60000000-0000-4000-8000-000000000003', '', '한진택배'],
      ['001234567893', '60000000-0000-4000-8000-000000000004', '방문수령', '한진택배'],
    ], '목록', legacy), carriers);
    expect(parsed.rows.map(row => row.line)).toEqual([2, 3, 4]);
    expect(parsed.issues).toMatchObject([{ line: 5, reason: expect.stringContaining('주문 상세') }]);
  });
});

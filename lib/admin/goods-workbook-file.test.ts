import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildGoodsWorkbook, parseGoodsWorkbook, parseGoodsWorkbookWithKc, readSabangnetGoodsSheet } from './goods-workbook-file';
import { emptyGoodsKcWorkbookRow, GOODS_KC_WORKBOOK_SHEET } from './goods-kc-workbook';
import { emptyGoodsCustomInputWorkbookRow, GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS, GOODS_CUSTOM_INPUT_WORKBOOK_SHEET } from './goods-custom-input-workbook';
import {
  emptyGoodsWorkbookRow,
  GOODS_WORKBOOK_HEADERS,
  GOODS_WORKBOOK_V3_VERSION,
  GOODS_WORKBOOK_V5_VERSION,
  GOODS_WORKBOOK_VERSION,
  planGoodsWorkbookImport,
} from './goods-workbook';
import { convertSabangnetRows, suggestSabangnetTargets } from './sabangnet-goods-format';
import { GOODS_AFTER_SALES_WORKBOOK_SHEET, GOODS_SIZE_WORKBOOK_SHEET } from './goods-guidance-workbook';
const values = {
  ...emptyGoodsWorkbookRow(),
  code: '00001',
  name: '상품',
  ipId: 'ip',
  price: '0',
  variantPrice: '12000',
  stockQty: '0',
  noticeMadeOn: '2026-09',
  description: '두 줄\n설명',
};
describe('real xlsx boundary', () => {
  it('상세 HTML 형식과 30,000자 문서 원문을 실제 XLSX 파일에서 손실 없이 왕복한다', async () => {
    const description = `<h2>상세</h2><p>${'가'.repeat(29980)}</p>`;
    const html = { ...values, descriptionFormat: 'html', description };
    expect(await parseGoodsWorkbook(await buildGoodsWorkbook([html]))).toEqual([{ row: 5, values: html, errors: [] }]);
  });
  it('keeps KC model rows and textual option identifiers in a separate re-uploadable sheet', async () => {
    const kc = { ...emptyGoodsKcWorkbookRow(), goodCode: values.code, modelIndex: '1', variantCodes: '00001-01\n00001-02',
      family: '그 외', scheme: '해당 없음', modelName: 'TEST 전용 모델', publicNote: '첫 줄\n둘째 줄', basis: 'TEST 적용근거' };
    const bytes = await buildGoodsWorkbook([values], undefined, [kc]);
    expect(await parseGoodsWorkbookWithKc(bytes)).toMatchObject({ rows: [{ values }], kcRows: [{ row: 5, values: kc }] });
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)?.getCell('C5').value).toBe('00001-01\n00001-02');
    book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)!.getCell('A5').value = { formula: '1+1', result: 2 };
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('수식');
  });
  it('round trips typed money, textual codes, blanks and multiline descriptions losslessly', async () => {
    const bytes = await buildGoodsWorkbook([values]);
    expect(bytes.subarray(0, 2).toString()).toBe('PK');
    expect(await parseGoodsWorkbook(bytes)).toEqual([
      { row: 5, values, errors: [] },
    ]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('상품')?.getCell('A5').value).toBe('00001');
    expect(book.getWorksheet('상품')?.getCell('G5').value).toBe(0);
    expect(book.getWorksheet('상품')?.views[0]).toMatchObject({
      state: 'frozen',
      xSplit: 2,
      ySplit: 4,
    });
  });
  it('reports formulas by original row without evaluating them', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    book.getWorksheet('상품')!.getCell('G5').value = {
      formula: '1+1',
      result: 2,
    };
    const rows = await parseGoodsWorkbook(
      Buffer.from(await book.xlsx.writeBuffer()),
    );
    expect(rows[0].row).toBe(5);
    expect((rows[0].errors ?? []).join()).toContain('수식');
  });
  it('rejects mismatched headers and over 500 populated option rows', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    book.getWorksheet('상품')!.getCell('A4').value = '잘못된 열';
    await expect(
      parseGoodsWorkbook(Buffer.from(await book.xlsx.writeBuffer())),
    ).rejects.toThrow('양식');
    await expect(
      buildGoodsWorkbook(Array.from({ length: 501 }, () => values)),
    ).rejects.toThrow('500');
  });
  it('exports only failed rows and retains the same re-uploadable headers', async () => {
    const bytes = await buildGoodsWorkbook([values], ['재고가 바뀌었습니다.']);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    expect(book.getWorksheet('상품')!.getRow(4).values).toContain(
      Object.values(GOODS_WORKBOOK_HEADERS)[0],
    );
    expect((await parseGoodsWorkbook(bytes))[0].values).toEqual(values);
  });
  it('v7 양식은 세 번째 옵션 축과 갤러리 1~9 열을 유지하고, 버전과 열 구성이 어긋나면 받지 않는다', async () => {
    const bytes = await buildGoodsWorkbook([values]);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(bytes as never);
    const sheet = book.getWorksheet('상품')!;
    expect(sheet.getCell('A1').text).toBe(GOODS_WORKBOOK_VERSION);
    expect(GOODS_WORKBOOK_VERSION).toBe('ICONS 상품 일괄 등록 v7');
    const headers = (sheet.getRow(4).values as unknown[]).slice(1).map(String);
    expect(headers.slice(headers.indexOf('옵션 축 1'), headers.indexOf('옵션 축 1') + 6)).toEqual(['옵션 축 1', '옵션 값 1', '옵션 축 2', '옵션 값 2', '옵션 축 3', '옵션 값 3']);
    const start = headers.indexOf('갤러리 1 URL');
    expect(headers.slice(start, start + 19)).toEqual([
      ...Array.from({ length: 9 }, (_, index) => [`갤러리 ${index + 1} URL`, `갤러리 ${index + 1} 파일명`]).flat(),
      '상세 이미지 URL',
    ]);
    // v3 표기에 v5 열을 붙인 파일은 열 순서가 v3와 다르므로 받지 않는다.
    sheet.getCell('A1').value = GOODS_WORKBOOK_V3_VERSION;
    book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)!.getCell('A1').value = GOODS_WORKBOOK_V3_VERSION;
    await expect(parseGoodsWorkbook(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('양식');
    // 상품 시트와 KC 검토 시트의 양식 버전은 같아야 한다.
    sheet.getCell('A1').value = GOODS_WORKBOOK_VERSION;
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('KC 검토 시트');
  });
  it('직접입력형 시트의 선행 0 코드·ID·버전·중지 상태를 실제 파일로 왕복한다', async () => {
    const custom = { ...emptyGoodsCustomInputWorkbookRow(), goodCode: values.code, mode: '편집', enabled: '아니오',
      fieldId: '00000000-0000-4000-8000-000000010001', name: 'TEST 문구', action: '중지', revision: '7' };
    const bytes = await buildGoodsWorkbook([values], undefined, [], [custom]);
    expect(await parseGoodsWorkbookWithKc(bytes)).toMatchObject({ customInputRows: [{ row: 5, values: custom, errors: [] }] });
    const book = new ExcelJS.Workbook(); await book.xlsx.load(bytes as never);
    const sheet = book.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET)!;
    expect(sheet.getRow(4).values).toEqual([undefined, ...Object.values(GOODS_CUSTOM_INPUT_WORKBOOK_HEADERS)]);
    expect(sheet.getCell('A5').value).toBe('00001');
    expect(sheet.getCell('G5').value).toBe('7');
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 4 });
    sheet.getCell('E5').value = { formula: '1+1', result: 2 };
    const parsed = await parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()));
    expect(parsed.customInputRows?.[0].errors?.join()).toContain('수식');
    sheet.getCell('A5').value = 1;
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('같은 상품코드');
  });
  it('시트 누락과 기존 v5 파일은 보존하고, 구버전에 새 시트를 붙이거나 열·버전을 바꾸면 거절한다', async () => {
    const book = new ExcelJS.Workbook(); await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    book.getWorksheet('상품')!.getCell('A1').value = GOODS_WORKBOOK_V5_VERSION;
    book.getWorksheet(GOODS_KC_WORKBOOK_SHEET)!.getCell('A1').value = GOODS_WORKBOOK_V5_VERSION;
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('v6');
    book.removeWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET);
    book.removeWorksheet(GOODS_AFTER_SALES_WORKBOOK_SHEET);
    book.removeWorksheet(GOODS_SIZE_WORKBOOK_SHEET);
    expect(await parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).toMatchObject({ rows: [{ values }], customInputRows: null });
    const current = new ExcelJS.Workbook(); await current.xlsx.load((await buildGoodsWorkbook([values])) as never);
    current.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET)!.getCell('D4').value = '잘못된 ID 열';
    await expect(parseGoodsWorkbookWithKc(Buffer.from(await current.xlsx.writeBuffer()))).rejects.toThrow('열 이름');
    current.removeWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET);
    expect((await parseGoodsWorkbookWithKc(Buffer.from(await current.xlsx.writeBuffer()))).customInputRows).toBeNull();
  });
  it('숫자 상품코드와 숫자 항목 ID는 같은 값처럼 보여도 오류로 남기며 5,000행을 제한한다', async () => {
    const product = { ...values, code: '123' };
    const custom = { ...emptyGoodsCustomInputWorkbookRow(), goodCode: '123', mode: '편집', enabled: '예', name: 'TEST 문구', action: '사용', revision: '0' };
    const book = new ExcelJS.Workbook(); await book.xlsx.load((await buildGoodsWorkbook([product], undefined, [], [custom])) as never);
    book.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET)!.getCell('A5').value = 123;
    book.getWorksheet(GOODS_CUSTOM_INPUT_WORKBOOK_SHEET)!.getCell('D5').value = 42;
    expect((await parseGoodsWorkbookWithKc(Buffer.from(await book.xlsx.writeBuffer()))).customInputRows?.[0].errors).toEqual([
      '상품코드: 코드는 숫자 대신 텍스트 형식으로 입력해주세요.', '항목 ID: 코드는 숫자 대신 텍스트 형식으로 입력해주세요.',
    ]);
    await expect(buildGoodsWorkbook([product], undefined, [], Array.from({ length: 5001 }, () => custom))).rejects.toThrow('5,000');
  });
  it('작성 안내 시트는 갤러리 9칸과 v3 양식의 갤러리 5~9 유지를 안내한다', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    const rows = book.getWorksheet('작성 안내')!.getSheetValues().filter(Boolean) as unknown[][];
    const image = rows.find((row) => row[1] === '이미지');
    expect(image?.[2]).toContain('대표·갤러리 9칸(추가 이미지 1~9)·상세 이미지마다');
    expect(image?.[2]).toContain('갤러리 4칸짜리 v3 양식도 그대로 올릴 수 있으며, 이때 기존 상품의 갤러리 5~9는 저장된 이미지를 유지합니다.');
  });
  it('작성 안내 시트는 상세 HTML의 https 호스팅 이미지가 그대로 표시된다고 안내한다', async () => {
    const book = new ExcelJS.Workbook();
    await book.xlsx.load((await buildGoodsWorkbook([values])) as never);
    const guide = book.getWorksheet('작성 안내')!;
    const rows = guide.getSheetValues().filter(Boolean) as unknown[][];
    const detail = rows.find((row) => row[1] === '상세 설명');
    expect(detail?.[2]).toContain('https 호스팅 이미지 주소는 그대로 표시되고, CSS·스크립트와 확인할 수 없는 이미지는 제거됩니다.');
    expect(detail?.[2]).not.toContain('외부 이미지는 제거됩니다');
  });
  it('round trips the full 500-row limit within the server processing budget', async () => {
    const rows = Array.from({ length: 500 }, (_, index) => ({
      ...values,
      code: `CODE-${String(index).padStart(4, '0')}`,
      name: `상품 ${index}`,
      stockQty: String(index),
    }));
    const started = performance.now();
    const bytes = await buildGoodsWorkbook(rows);
    expect((await parseGoodsWorkbook(bytes)).map((row) => row.values)).toEqual(
      rows,
    );
    expect(bytes.length).toBeLessThan(2 * 1024 * 1024);
    expect(performance.now() - started).toBeLessThan(10000);
  });
});

describe('사방넷 상품 파일 읽기', () => {
  async function sabangnetXlsx() {
    const book = new ExcelJS.Workbook();
    book.addWorksheet('작성 안내').getCell('A1').value = '사방넷 상품 다운로드 안내';
    const sheet = book.addWorksheet('상품');
    sheet.getCell('A1').value = '상품 일괄 다운로드 (2026-10-07)';
    sheet.getRow(3).values = ['상품명', '자체상품코드', '판매가', '제조일', '대표이미지', '원가'];
    sheet.getRow(4).values = ['머그', 12345, 15000, new Date(Date.UTC(2026, 6, 1)), { text: 'http://img.example.com/mug.jpg', hyperlink: 'http://img.example.com/mug.jpg' }, { formula: 'C4*0.5', result: 7500 }];
    sheet.getRow(6).values = ['키링', 'KR-1', '9,000'];
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  it('안내 시트와 상단 안내 행을 건너뛰고 숫자 코드·날짜·링크를 텍스트로 읽는다', async () => {
    const sheet = await readSabangnetGoodsSheet(await sabangnetXlsx());
    expect(sheet.headerRow).toBe(3);
    expect(sheet.headers).toEqual(['상품명', '자체상품코드', '판매가', '제조일', '대표이미지', '원가']);
    expect(sheet.rows.map((row) => row.row)).toEqual([4, 6]);
    expect(sheet.rows[0].cells.slice(0, 5)).toEqual(['머그', '12345', '15000', '2026-07-01', 'http://img.example.com/mug.jpg']);
    expect(sheet.rows[0].errors).toEqual({ 5: '수식은 사용할 수 없습니다.' });
  });
  it('CSV는 EUC-KR도 읽고 XLS·웹 페이지·열 이름 없는 파일은 이유를 알려 준다', async () => {
    const eucKr = Buffer.from([0xbb, 0xf3, 0xc7, 0xb0, 0xb8, 0xed, 0x2c, 0xc6, 0xc7, 0xb8, 0xc5, 0xb0, 0xa1, 0x0a, 0x41, 0x2c, 0x31]);
    expect(await readSabangnetGoodsSheet(eucKr)).toEqual({ headerRow: 1, headers: ['상품명', '판매가'], rows: [{ row: 2, cells: ['A', '1'] }] });
    await expect(readSabangnetGoodsSheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0]))).rejects.toThrow('.xlsx');
    await expect(readSabangnetGoodsSheet(Buffer.from('<html><table><tr><td>상품명</td></tr></table>'))).rejects.toThrow('웹 페이지');
    await expect(readSabangnetGoodsSheet(Buffer.from('이름,가격\nA,1'))).rejects.toThrow('열 이름');
    await expect(readSabangnetGoodsSheet(Buffer.alloc(0))).rejects.toThrow('2MB');
  });
  it('실제 XLSX에서 읽은 사방넷 행이 변환을 거쳐 기존 검증의 신규 초안 계획이 된다', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.getRow(1).values = ['상품명', '자체상품코드', '판매가', 'TAG가', '옵션제목(1)', '옵션상세명칭(1)', '대표이미지', '상품상세설명', '모델명'];
    sheet.getRow(2).values = ['핑크빈 쿠션', 'pb-cushion', 32000, 39000, '크기', 'S,M(+5,000원)', 'http://img.example.com/pb.jpg', '<p>쿠션</p>', 'PB-01'];
    const read = await readSabangnetGoodsSheet(Buffer.from(await book.xlsx.writeBuffer()));
    const converted = convertSabangnetRows({ ...read, targets: suggestSabangnetTargets(read.headers).targets, ipId: 'maple' });
    const plan = planGoodsWorkbookImport(converted.rows, {
      existing: [], ips: [{ id: 'maple', archived_at: null }], origins: [], presets: [], mediaUrl: () => null,
    });
    expect(converted.ignoredColumns).toEqual(['모델명']);
    expect(plan).toMatchObject([{ kind: 'new', code: 'PB-CUSHION', errors: [], target: {
      price: 32000, compare_at_price: 39000, publish: false, ip_id: 'maple',
      variants: [{ name: 'S', extraPrice: 0, stockQty: 0 }, { name: 'M', extraPrice: 5000, stockQty: 0 }],
    } }]);
  });
  it('CP949 확장 한글이 든 사방넷 CSV는 오류 없는 초안 대신 다시 저장 안내로 막는다', async () => {
    // '상품명,판매가\n똠양꿍 인형,9000'(CP949)
    const bytes = Buffer.from([
      0xbb, 0xf3, 0xc7, 0xb0, 0xb8, 0xed, 0x2c, 0xc6, 0xc7, 0xb8, 0xc5, 0xb0, 0xa1, 0x0a,
      0x8c, 0x63, 0xbe, 0xe7, 0xb2, 0xe1, 0x20, 0xc0, 0xce, 0xc7, 0xfc, 0x2c, 0x39, 0x30, 0x30, 0x30,
    ]);
    await expect(readSabangnetGoodsSheet(bytes)).rejects.toThrow("'CSV UTF-8(쉼표로 분리)'로 저장하거나 XLSX로 올려 주세요.");
  });
  async function wideSabangnetXlsx(rows: number, extra?: (sheet: ExcelJS.Worksheet) => void) {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.getRow(1).values = ['상품명', '자체상품코드', '판매가'];
    for (let row = 2; row <= rows + 1; row++) sheet.getRow(row).values = [`상품${row}`, `C${row}`, 1000];
    // 엑셀에서 오른쪽 끝 열(XFD) 셀 하나에 채우기 서식만 넣은 파일. 시트 열 수가 16,384가 된다.
    sheet.getCell(`XFD${Math.ceil(rows / 2) + 1}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
    extra?.(sheet);
    return Buffer.from(await book.xlsx.writeBuffer());
  }
  it('서식만 있는 먼 열(XFD) 셀이 있어도 머리글의 마지막 열까지만 읽어 500행을 빠르게 처리한다', async () => {
    const small = await readSabangnetGoodsSheet(await wideSabangnetXlsx(20, (sheet) => {
      sheet.getCell('H5').value = '머리글 밖 메모';
    }));
    expect(small.headers).toEqual(['상품명', '자체상품코드', '판매가']);
    expect(small.rows).toHaveLength(20);
    expect(small.rows.every((row) => row.cells.length === 3)).toBe(true);
    expect(small.rows[3].cells).toEqual(['상품5', 'C5', '1000']);

    const bytes = await wideSabangnetXlsx(500);
    const started = performance.now();
    const full = await readSabangnetGoodsSheet(bytes);
    expect(performance.now() - started).toBeLessThan(5000);
    expect(full.rows).toHaveLength(500);
    expect(Math.max(...full.rows.map((row) => row.cells.length))).toBe(3);
  }, 20_000);
  it('열 이름 행이 200열을 넘으면 쓰지 않는 열을 지우도록 안내한다', async () => {
    const headers = ['상품명', '판매가', ...Array.from({ length: 199 }, (_, index) => `메모${index + 1}`)];
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Sheet1');
    sheet.getRow(1).values = headers;
    sheet.getRow(2).values = ['키링', 1000];
    await expect(readSabangnetGoodsSheet(Buffer.from(await book.xlsx.writeBuffer()))).rejects.toThrow('열이 200개를 넘습니다');
    await expect(readSabangnetGoodsSheet(Buffer.from(`${headers.join(',')}\n키링,1000\n`))).rejects.toThrow('열이 200개를 넘습니다');
    const gap = new ExcelJS.Workbook();
    const gapSheet = gap.addWorksheet('Sheet1');
    gapSheet.getRow(1).values = ['상품명', '판매가'];
    gapSheet.getCell(1, 250).value = '부가이미지22';
    gapSheet.getRow(2).values = ['키링', 1000];
    await expect(readSabangnetGoodsSheet(Buffer.from(await gap.xlsx.writeBuffer()))).rejects.toThrow('열이 200개를 넘습니다');
    const fits = await readSabangnetGoodsSheet(Buffer.from(`${headers.slice(0, 200).join(',')}\n키링,1000\n`));
    expect(fits.headers).toHaveLength(200);
  });
  it('사방넷 상품은 파일당 500개까지 읽는다', async () => {
    const csv = ['상품명,판매가', ...Array.from({ length: 501 }, (_, index) => `상품${index},1000`)].join('\n');
    await expect(readSabangnetGoodsSheet(Buffer.from(csv))).rejects.toThrow('500개');
  });
});

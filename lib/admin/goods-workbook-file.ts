import 'server-only';
import ExcelJS from 'exceljs';
import { loadSafeWorkbook, readSafeWorkbookCell } from './workbook-safety';
import { GOODS_KC_WORKBOOK_HEADERS, GOODS_KC_WORKBOOK_SHEET, emptyGoodsKcWorkbookRow,
  goodsKcWorkbookOrphanErrors, type GoodsKcWorkbookInputRow, type GoodsKcWorkbookKey, type GoodsKcWorkbookRow } from './goods-kc-workbook';
import {
  emptyGoodsWorkbookRow,
  GOODS_WORKBOOK_BYTES_LIMIT,
  GOODS_WORKBOOK_HEADERS,
  GOODS_WORKBOOK_KEYS,
  GOODS_WORKBOOK_ROW_LIMIT,
  GOODS_WORKBOOK_VERSION,
  type GoodsWorkbookInputRow,
  type GoodsWorkbookKey,
  type GoodsWorkbookRow,
} from './goods-workbook';
const NUMERIC_KEYS = new Set<GoodsWorkbookKey>([
  'price',
  'compareAtPrice', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee',
  'individualFee',
  'variantPrice',
  'stockQty',
  'lowStockThreshold',
  'displayOrder',
  'minOrderQty', 'maxOrderQty', 'memberLifetimeQtyLimit', 'shippingNoticeTemplateVersion', 'purchaseCostKrw',
]);
const IDENTIFIER_KEYS = new Set<GoodsWorkbookKey>([
  'code',
  'variantCode',
  'ipId',
  'id',
  'originCode',
  'erpCode', 'barcode', 'categoryCode', 'shippingNoticeTemplateCode',
]);
const LISTS: Partial<Record<GoodsWorkbookKey, string>> = {
  descriptionFormat: 'plain,html',
  kcReset: '예',
  claimReturnAllowed: '예,아니오',
  claimExchangeAllowed: '예,아니오',
  purchaseTaxBasis: 'included,excluded,exempt',
  variantActive: '사용,중지',
  publish: '초안,공개',
  stock: 'ok,low,soldout',
  allowBankTransfer: '예,아니오',
  allowCardPayment: '예,아니오',
  orderQuantityLimitEnabled: '예,아니오',
  memberPurchaseLimitEnabled: '예,아니오',
  saleRestriction: 'none,adult',
  shippingFeeType: 'policy,free,individual',
};

export async function buildGoodsWorkbook(
  rows: GoodsWorkbookRow[],
  errors?: string[],
  kcRows: GoodsKcWorkbookRow[] = [],
): Promise<Buffer> {
  if (rows.length > GOODS_WORKBOOK_ROW_LIMIT)
    throw new Error('파일당 최대 500행입니다. 페이지를 나누어 내려받아주세요.');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'ICONS';
  workbook.created = new Date('2026-09-08T00:00:00Z');
  const sheet = workbook.addWorksheet('상품', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 4, showGridLines: false }],
  });
  sheet.getCell('A1').value = GOODS_WORKBOOK_VERSION;
  sheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  sheet.getCell('A2').value =
    '옵션 1개당 한 행 · 같은 상품의 상품 열은 동일하게 반복 · 5행부터 입력';
  sheet.getCell('A2').font = {
    name: 'Arial',
    size: 10,
    color: { argb: 'FF52525B' },
  };
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 8;
  sheet.getRow(4).height = 30;
  const headers = [
    ...Object.values(GOODS_WORKBOOK_HEADERS),
    ...(errors ? ['오류'] : []),
  ];
  sheet.getRow(4).values = headers;
  const last = sheet.getColumn(headers.length).letter;
  sheet.autoFilter = `A4:${last}${Math.max(5, rows.length + 4)}`;
  for (const [index, key] of GOODS_WORKBOOK_KEYS.entries()) {
    const column = sheet.getColumn(index + 1);
    column.width =
      key === 'name'
        ? 28
        : key === 'description'
          ? 48
          : key.includes('Url')
            ? 42
            : key.includes('File')
              ? 28
              : 18;
    column.numFmt = NUMERIC_KEYS.has(key) ? '#,##0' : '@';
    const header = sheet.getCell(4, index + 1);
    header.font = {
      name: 'Arial',
      size: 10,
      bold: true,
      color: { argb: 'FFFFFFFF' },
    };
    header.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: OPTION_HEADER(key) ? 'FF44546A' : 'FF27272A' },
    };
    header.alignment = {
      vertical: 'middle',
      horizontal: 'center',
      wrapText: true,
    };
  }
  for (const [index, values] of rows.entries()) {
    const row = sheet.getRow(index + 5);
    row.values = GOODS_WORKBOOK_KEYS.map((key) =>
      values[key] === ''
        ? null
        : NUMERIC_KEYS.has(key)
          ? Number(values[key])
          : values[key],
    );
    row.height = values.description.includes('\n') ? 32 : 22;
    row.eachCell((cell) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF18181B' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
    });
    if (errors) {
      const cell = row.getCell(headers.length);
      cell.value = errors[index] ?? '';
      cell.font = { name: 'Arial', size: 10, color: { argb: 'FF991B1B' } };
    }
  }
  // Dropdowns cover the input range but blank cells do not become data rows.
  for (const [index, key] of GOODS_WORKBOOK_KEYS.entries())
    if (LISTS[key])
      for (let row = 5; row <= 504; row++)
        sheet.getCell(row, index + 1).dataValidation = {
          type: 'list',
          allowBlank: true,
          formulae: [`"${LISTS[key]}"`],
          showErrorMessage: true,
          errorTitle: '값 확인',
          error: '목록의 값을 선택해주세요.',
        };
  if (errors) sheet.getColumn(headers.length).width = 55;
  addGoodsKcWorksheet(workbook, kcRows);
  const guide = workbook.addWorksheet('작성 안내', {
    views: [{ showGridLines: false }],
  });
  guide.columns = [{ width: 24 }, { width: 115 }];
  const notes = [
    ['ICONS 상품 일괄 등록', ''],
    ['KC 검토', '별도 KC 검토 시트에 모델마다 한 행을 입력합니다. 적용 옵션코드는 줄바꿈으로 구분합니다. 검토 상태·버전은 바꾸지 마세요. 시트 또는 상품 행을 없애도 기존 KC 정보는 유지합니다.'],
    ['KC 변경과 초기화', 'KC 내용을 수정하거나 상품 시트의 KC 초기화를 예로 선택하면 상품 게시 상태를 초안으로 바꿔야 합니다. 미검토로 저장한 뒤 상품 편집의 KC 검토에서 실제 근거를 확인합니다. 새 자동코드는 초안 저장 후 다시 내보내세요.'],
    ['영문 상품명', '선택 항목입니다. 공개 상세와 미리보기에 표시하며 공란으로 저장하면 기존 영문명을 지웁니다.'],
    ['안전재고 기준', '옵션 할당 재고가 기준 이하이면 경고합니다. 판매 수량을 차감하지 않습니다. 공란은 경보 미설정, 0은 수량 0일 때 경고합니다.'],
    ['옵션 사용', '사용 또는 중지를 입력합니다. 사용 중지해도 재고와 주문 기록은 보존됩니다. 사용 중인 옵션과 기본 옵션을 내보내며, 그 밖의 중지 옵션은 상품 편집의 옵션 목록에서 복원합니다.'],
    [
      '입력 단위',
      '옵션마다 한 행입니다. 같은 상품의 상품코드·이름·IP·배송·고시정보·이미지는 똑같이 반복해주세요.',
    ],
    [
      '새 상품',
      '상품명과 IP ID만으로 초안을 시작할 수 있습니다. 코드가 비면 같은 IP·이름의 행을 한 상품으로 묶고 상품코드를 자동 만듭니다.',
    ],
    [
      '기존 상품 수정',
      '상품코드로 수정 대상을 찾습니다. 수정할 상품의 옵션을 모두 포함해주세요. 빠진 옵션은 삭제 또는 보관됩니다.',
    ],
    [
      '게시 상태',
      '초안 또는 공개를 입력합니다. 새 공개·재공개에는 대표 이미지·상품 유형·고시정보·출고지와 KC 검토가 필요합니다. 새 상품의 KC 검토는 초안 저장 후 진행합니다. 빈 게시 상태는 초안입니다.',
    ],
    [
      '빈칸과 숫자 0',
      '기준 판매가·옵션 재고·개별 배송비의 빈칸은 0입니다. 매입단가·구매 한도·교환 반품비·안전재고 기준의 빈칸은 미설정입니다. 기존값을 유지하려면 내려받은 값을 그대로 두세요.',
    ],
    [
      '이미지',
      '대표·갤러리 4칸·상세 이미지마다 URL 또는 파일명 중 하나를 입력합니다. 파일명은 이미지 ZIP의 파일명과 정확히 같아야 합니다. JPEG/PNG/WebP만 가능합니다.',
    ],
    [
      '이미지 크기',
      '이미지는 개별 5MB, 가로·세로 8192px 이하입니다. ZIP은 50MB, 압축을 푼 전체 이미지는 100MB 이하입니다.',
    ],
    [
      '옵션 가격',
      '옵션 판매가는 기준 판매가에 추가금액을 더한 최종 가격입니다. 기준 판매가보다 낮게 입력할 수 없습니다. 첫 옵션이 기본 옵션입니다.',
    ],
    [
      '옵션 구성',
      '옵션 축은 최대 2개이며 조합은 서로 달라야 합니다. 옵션이 없는 상품은 기본 옵션 한 행만 입력하세요.',
    ],
    [
      'ERP와 바코드',
      '옵션별 ERP 코드·ERP 품명·바코드는 자체 상품/옵션 코드와 별개입니다. 선행 0을 유지하도록 텍스트 형식을 사용하며 빈칸은 외부 값을 지웁니다.',
    ],
    [
      '구매 조건',
      '카드·무통장 허용과 한도 적용 여부는 예/아니오입니다. 수량은 상품의 옵션을 합산하며 한도 적용에는 실제 수치가 필요합니다. 빈 한도는 미설정이며 0은 허용하지 않습니다.',
    ],
    [
      '기간 할인',
      '이 파일의 옵션 판매가는 일반 판매가입니다. 기간 할인은 여러 버전과 활성화 이력이 있으므로 상품 편집의 기간 할인 목록에서 별도로 관리합니다. 이 파일을 다시 올려도 기간 할인 이력을 지우지 않습니다.',
    ],
    ['예약판매·추가구성', '예약은 실제 승인 물량·기간·입고 할당을, 추가구성은 독립 상품의 연결을 별도 화면에서 관리합니다. 이 파일은 일반 옵션 재고를 편집하며 예약 승인 물량이나 추가구성 연결을 복제·초기화하지 않습니다.'],
    [
      '배송비',
      '출고지 코드는 설정 화면의 코드입니다. policy는 출고지 정책, free는 무료배송, individual은 상품당 한 번 더하는 개별 배송비입니다.',
    ],
    [
      '고시 프리셋',
      '정확한 프리셋 이름을 입력하면 비어 있는 고시정보 칸을 채웁니다. 직접 입력한 값이 우선합니다.',
    ],
    [
      '상세 설명',
      '상세 설명 형식은 plain(일반 텍스트) 또는 html입니다. HTML은 정리된 코드까지 30,000자이며 CSS·스크립트·외부 이미지는 제거됩니다. HTML 이미지는 상품 편집에서 검증 업로드하고 내보낸 경로를 유지해주세요.',
    ],
    [
      '오류 처리',
      '검증 미리보기에서 신규·수정·오류를 확인한 뒤 적용합니다. 같은 상품의 옵션은 함께 성공하거나 실패하며 실패 상품 행만 내려받아 다시 올릴 수 있습니다.',
    ],
    [
      '상한',
      'XLSX 파일은 2MB, 옵션은 최대 500행입니다. 내보내기 페이지를 나누어 처리하며 한 상품의 옵션을 두 파일로 나누지 않습니다.',
    ],
    [
      '수식',
      '수식·매크로·삽입 개체는 사용하지 않습니다. 상품코드와 옵션코드는 텍스트 형식을 유지해주세요.',
    ],
  ];
  notes.forEach((values, index) => {
    const row = guide.getRow(index + 2);
    row.values = values.map((value) => value || null);
    row.height = index === 0 ? 26 : 38;
    row.eachCell((cell, column) => {
      cell.font = {
        name: 'Arial',
        size: index === 0 ? 14 : 10,
        bold: index === 0 || column === 1,
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
      if (index === 0) cell.alignment = { vertical: 'middle', wrapText: false };
    });
  });
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  if (bytes.length > GOODS_WORKBOOK_BYTES_LIMIT) throw new Error('상품 설명·KC 근거를 포함한 파일이 2MB를 초과합니다. 상품 필터를 좁혀 나누어 내려받아주세요.');
  return bytes;
}
function addGoodsKcWorksheet(workbook: ExcelJS.Workbook, rows: GoodsKcWorkbookRow[]) {
  if (rows.length > GOODS_WORKBOOK_ROW_LIMIT * 50) throw new Error('KC 모델은 상품당 50행까지입니다.');
  const sheet = workbook.addWorksheet(GOODS_KC_WORKBOOK_SHEET, { views: [{ state: 'frozen', xSplit: 3, ySplit: 4, showGridLines: false }] });
  sheet.getCell('A1').value = GOODS_WORKBOOK_VERSION;
  sheet.getCell('A1').font = { name: 'Arial', size: 14, bold: true };
  sheet.getCell('A2').value = '모델 1개당 한 행. 내부 검토 근거가 포함된 파일입니다. 검토 상태·버전은 읽기 전용이며 편집한 내용은 미검토로 저장됩니다.';
  sheet.mergeCells('A2:R2');
  sheet.getCell('A2').alignment = { wrapText: true, vertical: 'middle' };
  sheet.getRow(1).height = 25; sheet.getRow(2).height = 32; sheet.getRow(3).height = 8; sheet.getRow(4).height = 40;
  const keys = Object.keys(GOODS_KC_WORKBOOK_HEADERS) as GoodsKcWorkbookKey[];
  sheet.getRow(4).values = keys.map(key => GOODS_KC_WORKBOOK_HEADERS[key]);
  sheet.autoFilter = `A4:R${Math.max(5, rows.length + 4)}`;
  keys.forEach((key, index) => {
    sheet.getColumn(index + 1).width = ['publicNote', 'basis'].includes(key) || key.endsWith('Reference') ? 42 : key === 'variantCodes' ? 24 : 22;
    sheet.getColumn(index + 1).numFmt = '@';
    const header = sheet.getCell(4, index + 1);
    header.font = { name: 'Arial', size: 10, bold: true };
    header.alignment = { vertical: 'middle', wrapText: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
  });
  rows.forEach((values, index) => {
    const row = sheet.getRow(index + 5);
    row.values = keys.map(key => values[key] || null);
    row.height = Math.max(42, Math.min(150, Math.max(...keys.map(key => values[key].split('\n').length)) * 15));
    row.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { name: 'Arial', size: 10, color: { argb: column > 16 ? 'FF71717A' : 'FF18181B' } };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (column > 16) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F5' } };
    });
  });
}
function OPTION_HEADER(key: GoodsWorkbookKey) {
  return [
    'variantCode',
    'variantName',
    'axis1',
    'value1',
    'axis2',
    'value2',
    'variantPrice',
    'stockQty',
  ].includes(key);
}
export async function parseGoodsWorkbook(
  bytes: Buffer,
): Promise<GoodsWorkbookInputRow[]> {
  return (await parseGoodsWorkbookWithKc(bytes)).rows;
}
export async function parseGoodsWorkbookWithKc(
  bytes: Buffer,
): Promise<{ rows: GoodsWorkbookInputRow[]; kcRows: GoodsKcWorkbookInputRow[] | null }> {
  if (!bytes.length || bytes.length > GOODS_WORKBOOK_BYTES_LIMIT)
    throw new Error('XLSX 양식은 2MB 이하로 올려주세요.');
  const workbook = await loadSafeWorkbook(bytes, {
    fileBytes: GOODS_WORKBOOK_BYTES_LIMIT,
  });
  const sheet = workbook.getWorksheet('상품');
  if (
    !sheet ||
    sheet.getCell('A1').text !== GOODS_WORKBOOK_VERSION ||
    GOODS_WORKBOOK_KEYS.some(
      (key, index) =>
        sheet.getCell(4, index + 1).text !== GOODS_WORKBOOK_HEADERS[key],
    )
  )
    throw new Error('현재 상품 양식을 내려받아 열 이름과 순서를 유지해주세요.');
  const result: GoodsWorkbookInputRow[] = [];
  sheet.eachRow((row, number) => {
    if (number < 5) return;
    const values = emptyGoodsWorkbookRow();
    const errors: string[] = [];
    GOODS_WORKBOOK_KEYS.forEach((key, index) => {
      const cell = readSafeWorkbookCell(
        row.getCell(index + 1),
        IDENTIFIER_KEYS.has(key),
      );
      values[key] = cell.value;
      if (cell.error)
        errors.push(`${GOODS_WORKBOOK_HEADERS[key]}: ${cell.error}`);
    });
    if (GOODS_WORKBOOK_KEYS.some((key) => values[key] !== '') || errors.length)
      result.push({ row: number, values, errors });
  });
  if (result.length > 500)
    throw new Error(
      '옵션 행은 파일당 최대 500행입니다. 파일을 나누어 올려주세요.',
    );
  if (!result.length) throw new Error('5행부터 상품 정보를 입력해주세요.');
  const kcSheet = workbook.getWorksheet(GOODS_KC_WORKBOOK_SHEET);
  let kcRows: GoodsKcWorkbookInputRow[] | null = null;
  if (kcSheet) {
    const keys = Object.keys(GOODS_KC_WORKBOOK_HEADERS) as GoodsKcWorkbookKey[];
    if (kcSheet.getCell('A1').text !== GOODS_WORKBOOK_VERSION || keys.some((key, index) => kcSheet.getCell(4, index + 1).text !== GOODS_KC_WORKBOOK_HEADERS[key]))
      throw new Error('KC 검토 시트의 열 이름과 순서를 유지해주세요.');
    kcRows = [];
    kcSheet.eachRow((row, number) => {
      if (number < 5) return;
      const values = emptyGoodsKcWorkbookRow();
      keys.forEach((key, index) => {
        const cell = readSafeWorkbookCell(row.getCell(index + 1), ['goodCode', 'variantCodes', 'identifier'].includes(key));
        if (cell.error) throw new Error(`KC 검토 ${number}행 ${GOODS_KC_WORKBOOK_HEADERS[key]}: ${cell.error}`);
        values[key] = cell.value;
      });
      values.goodCode = values.goodCode.trim().toUpperCase();
      values.variantCodes = values.variantCodes.split(/\r?\n/).map(code => code.trim().toUpperCase()).join('\n');
      if (keys.some(key => values[key] !== '')) kcRows!.push({ row: number, values });
    });
    if (kcRows.length > GOODS_WORKBOOK_ROW_LIMIT * 50) throw new Error('KC 모델은 상품당 50행까지입니다.');
    const orphans = goodsKcWorkbookOrphanErrors(kcRows, result.map(row => row.values.code.trim().toUpperCase()));
    if (orphans.length) throw new Error(orphans.join('\n'));
  }
  return { rows: result, kcRows };
}

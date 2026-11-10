import { EMPTY_GOODS_AFTER_SALES, parseGoodsAfterSalesValues, type GoodsAfterSalesSnapshot, type GoodsAfterSalesValues } from '@/lib/goods-after-sales';
import { emptyGoodsSizeChartValues, parseGoodsSizeChartValues, type GoodsSizeChartSnapshot, type GoodsSizeChartValues } from '@/lib/goods-size-chart';

export const GOODS_AFTER_SALES_WORKBOOK_SHEET = 'AS 안내';
export const GOODS_SIZE_WORKBOOK_SHEET = '사이즈 안내';
export const GOODS_AFTER_SALES_WORKBOOK_HEADERS = {
  goodCode: '상품코드', mode: '변경 방식', phone: 'A/S 전화번호', guide: 'A/S 안내', sellerSpecialNotes: '판매자 특이사항', revision: '안내 버전',
} as const;
export const GOODS_SIZE_WORKBOOK_HEADERS = {
  goodCode: '상품코드', mode: '변경 방식', enabled: '표시', unit: '단위', note: '표 안내', revision: '표 버전', measurement: '측정 항목',
  size1: '사이즈 1', size2: '사이즈 2', size3: '사이즈 3', size4: '사이즈 4', size5: '사이즈 5',
  size6: '사이즈 6', size7: '사이즈 7', size8: '사이즈 8', size9: '사이즈 9', size10: '사이즈 10',
  value1: '치수 1', value2: '치수 2', value3: '치수 3', value4: '치수 4', value5: '치수 5',
  value6: '치수 6', value7: '치수 7', value8: '치수 8', value9: '치수 9', value10: '치수 10',
} as const;
export type GoodsAfterSalesWorkbookRow = Record<keyof typeof GOODS_AFTER_SALES_WORKBOOK_HEADERS, string>;
export type GoodsSizeWorkbookRow = Record<keyof typeof GOODS_SIZE_WORKBOOK_HEADERS, string>;
export type GuidanceInputRow<T> = { row: number; values: T; errors?: string[] };
export type GoodsAfterSalesWorkbookInputRow = GuidanceInputRow<GoodsAfterSalesWorkbookRow>;
export type GoodsSizeWorkbookInputRow = GuidanceInputRow<GoodsSizeWorkbookRow>;
export type GoodsGuidanceChange<T> = { expectedRevision: number; values: T };
export type GoodsImportGuidance = { afterSales?: GoodsGuidanceChange<GoodsAfterSalesValues>; sizeChart?: GoodsGuidanceChange<GoodsSizeChartValues> };
type Plan<T> = { kind: 'keep'; warnings: string[] } | { kind: 'save'; change: GoodsGuidanceChange<T>; warnings: string[] } | { kind: 'error'; errors: string[]; warnings: string[] };
const code = (value: string) => value.trim().toUpperCase();
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const keep = (): Plan<never> => ({ kind: 'keep', warnings: [] });
const fail = (errors: string[]): Plan<never> => ({ kind: 'error', errors: [...new Set(errors)], warnings: [] });
const SIZE_KEYS = Array.from({ length: 10 }, (_, i) => ('size' + (i + 1)) as keyof GoodsSizeWorkbookRow);
const VALUE_KEYS = Array.from({ length: 10 }, (_, i) => ('value' + (i + 1)) as keyof GoodsSizeWorkbookRow);
export const emptyGoodsAfterSalesWorkbookRow = () => Object.fromEntries(Object.keys(GOODS_AFTER_SALES_WORKBOOK_HEADERS).map(key => [key, ''])) as GoodsAfterSalesWorkbookRow;
export const emptyGoodsSizeWorkbookRow = () => Object.fromEntries(Object.keys(GOODS_SIZE_WORKBOOK_HEADERS).map(key => [key, ''])) as GoodsSizeWorkbookRow;
function revisionError(value: string, expected: number, label: string): string[] {
  return /^(0|[1-9][0-9]*)$/.test(value.trim()) && Number(value) === expected && Number(value) <= 2147483647 ? []
    : [label + ' 버전이 다릅니다. 최신 파일을 내려받아주세요. 새 상품은 0을 입력합니다.'];
}

export function planGoodsAfterSalesWorkbook(rows: readonly GoodsAfterSalesWorkbookInputRow[] | null | undefined, goodCode: string, existing: GoodsAfterSalesSnapshot | null): Plan<GoodsAfterSalesValues> {
  const source = (rows ?? []).filter(row => code(row.values.goodCode) === code(goodCode));
  if (!source.length) return keep();
  const errors = source.flatMap(row => (row.errors ?? []).map(error => 'A/S 안내 ' + row.row + '행: ' + error));
  if (!goodCode || source.length !== 1) return fail([...errors, 'A/S 안내는 같은 상품코드에 한 행만 입력해주세요.']);
  const row = source[0].values, expectedRevision = existing?.revision ?? 0;
  errors.push(...revisionError(row.revision, expectedRevision, 'A/S 안내'));
  const mode = row.mode.trim();
  if (!['편집', '전체 해제'].includes(mode)) errors.push('A/S 안내의 변경 방식은 편집 또는 전체 해제입니다.');
  const values = parseGoodsAfterSalesValues(row, mode === '전체 해제');
  if (!values || mode === '전체 해제' && (values.phone || values.guide || values.sellerSpecialNotes))
    errors.push(mode === '전체 해제' ? 'A/S 안내 전체 해제는 전화번호·안내·특이사항을 모두 비워주세요.' : 'A/S 전화번호 20자·안내 1,300자·특이사항 1,300자를 확인해주세요. 전화번호와 안내는 필수입니다.');
  if (errors.length || !values) return fail(errors);
  const before = existing ? { phone: existing.phone, guide: existing.guide, sellerSpecialNotes: existing.sellerSpecialNotes } : EMPTY_GOODS_AFTER_SALES;
  if (same(before, values)) return keep();
  return { kind: 'save', change: { expectedRevision, values }, warnings: [mode === '전체 해제' ? '상품의 별도 A/S 안내와 판매자 특이사항을 모두 해제합니다. 고시정보는 유지됩니다.' : '상품의 별도 A/S 안내를 변경합니다. 고시정보와 원본 템플릿은 유지됩니다.'] };
}

export function planGoodsSizeWorkbook(rows: readonly GoodsSizeWorkbookInputRow[] | null | undefined, goodCode: string, existing: GoodsSizeChartSnapshot | null): Plan<GoodsSizeChartValues> {
  const source = (rows ?? []).filter(row => code(row.values.goodCode) === code(goodCode));
  if (!source.length) return keep();
  const errors = source.flatMap(row => (row.errors ?? []).map(error => '사이즈 안내 ' + row.row + '행: ' + error));
  if (!goodCode || source.length > 10) return fail([...errors, '사이즈 안내는 상품당 측정 항목 10행까지 입력할 수 있습니다.']);
  const first = source[0].values, expectedRevision = existing?.revision ?? 0;
  const before = existing?.values ?? emptyGoodsSizeChartValues();
  errors.push(...revisionError(first.revision, expectedRevision, '사이즈 안내'));
  const mode = first.mode.trim();
  if (!['편집', '표시 중지'].includes(mode)) errors.push('사이즈 안내의 변경 방식은 편집 또는 표시 중지입니다.');
  if (mode === '표시 중지') {
    const emptyKeys = Object.keys(GOODS_SIZE_WORKBOOK_HEADERS).filter(key => !['goodCode', 'mode', 'revision'].includes(key)) as (keyof GoodsSizeWorkbookRow)[];
    if (source.length !== 1 || emptyKeys.some(key => first[key].trim())) errors.push('표시 중지는 한 행에 상품코드·변경 방식·표 버전만 입력해주세요. 저장된 표는 유지됩니다.');
    if (errors.length) return fail(errors);
    if (!before.enabled) return keep();
    return { kind: 'save', change: { expectedRevision, values: { ...before, enabled: false } }, warnings: ['저장된 사이즈표를 보존하고 공개 표시를 중지합니다.'] };
  }
  const meta = ['mode', 'enabled', 'unit', 'note', 'revision', ...SIZE_KEYS] as (keyof GoodsSizeWorkbookRow)[];
  if (source.some(row => meta.some(key => row.values[key].trim() !== first[key].trim()))) errors.push('같은 상품의 변경 방식·표시·단위·안내·버전·사이즈 이름은 모든 행에 동일하게 입력해주세요.');
  if (!['예', '아니오'].includes(first.enabled.trim())) errors.push('사이즈 안내의 표시는 예 또는 아니오입니다.');
  const allSizes = SIZE_KEYS.map(key => first[key].trim()), sizes = allSizes.filter(Boolean);
  if (allSizes.some((size, i) => i < sizes.length ? !size : Boolean(size))) errors.push('사이즈는 1번부터 빈 칸 없이 순서대로 입력해주세요.');
  if (source.some(row => VALUE_KEYS.slice(sizes.length).some(key => row.values[key].trim()))) errors.push('사이즈 이름이 없는 열에는 치수를 입력할 수 없습니다.');
  const values = parseGoodsSizeChartValues({ enabled: first.enabled.trim() === '예', chart: {
    unit: first.unit.trim(), sizes, note: first.note,
    measurements: source.map(row => ({ name: row.values.measurement, values: VALUE_KEYS.slice(0, sizes.length).map(key => row.values[key]) })),
  } });
  if (!values) errors.push('사이즈·측정 항목은 중복 없이 각각 1~10개, 단위는 cm/mm, 모든 치수는 0.1~99,999의 소수 한 자리까지 입력해주세요.');
  if (errors.length || !values) return fail(errors);
  if (same(before, values)) return keep();
  return { kind: 'save', change: { expectedRevision, values }, warnings: ['사이즈 안내표의 내용·순서·표시를 입력한 표로 변경합니다. 기존 템플릿은 유지됩니다.'] };
}

export function exportGoodsAfterSalesWorkbookRows(records: readonly { goodCode: string; snapshot: GoodsAfterSalesSnapshot }[]): GoodsAfterSalesWorkbookRow[] {
  return records.filter(({ snapshot }) => snapshot.revision > 0 || snapshot.phone || snapshot.guide || snapshot.sellerSpecialNotes)
    .map(({ goodCode, snapshot }) => ({ goodCode, mode: snapshot.phone || snapshot.guide || snapshot.sellerSpecialNotes ? '편집' : '전체 해제', phone: snapshot.phone, guide: snapshot.guide, sellerSpecialNotes: snapshot.sellerSpecialNotes, revision: String(snapshot.revision) }));
}
export function exportGoodsSizeWorkbookRows(records: readonly { goodCode: string; snapshot: GoodsSizeChartSnapshot }[]): GoodsSizeWorkbookRow[] {
  return records.flatMap(({ goodCode, snapshot }) => {
    const base: GoodsSizeWorkbookRow = { ...emptyGoodsSizeWorkbookRow(), goodCode, mode: '편집', enabled: snapshot.values.enabled ? '예' : '아니오', unit: snapshot.values.chart.unit, note: snapshot.values.chart.note, revision: String(snapshot.revision) };
    if (!snapshot.values.chart.measurements.length) return snapshot.revision > 0 ? [{ ...emptyGoodsSizeWorkbookRow(), goodCode, mode: '표시 중지', revision: String(snapshot.revision) }] : [];
    snapshot.values.chart.sizes.forEach((name, index) => { base[SIZE_KEYS[index]] = name; });
    return snapshot.values.chart.measurements.map(measurement => {
      const row = { ...base, measurement: measurement.name };
      measurement.values.forEach((value, index) => { row[VALUE_KEYS[index]] = value; });
      return row;
    });
  });
}

export function goodsGuidanceOrphanErrors(rows: readonly { row: number; values: { goodCode: string } }[], goodCodes: readonly string[], sheet: string): string[] {
  const codes = new Set(goodCodes.map(code));
  return rows.flatMap(row => !code(row.values.goodCode) || !codes.has(code(row.values.goodCode))
    ? [sheet + ' ' + row.row + '행: 상품 시트에 같은 상품코드가 필요합니다. 자동코드는 초안 저장 후 다시 내려받아 연결해주세요.'] : []);
}

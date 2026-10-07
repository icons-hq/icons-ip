import type { AdminGoodsVariant } from './goods-variants';
import type { ErpItemMatch } from './erp-items';
import { GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS } from './variant-external-identity';
export type GoodsOptionRow = {
  id?: string;
  name: string;
  code: string;
  attributes: Record<string, string>;
  extraPrice: number;
  stockQty: number;
  expectedStockQty?: number;
  lowStockThreshold?: number | null;
  isActive?: boolean;
  erpCode?: string | null;
  erpName?: string | null;
  barcode?: string | null;
  externalUpdatedAt?: string | null;
};
export type GoodsOptionAxis = { name: string; values: string };
type Result = { ok: true; rows: GoodsOptionRow[] } | { ok: false; error: string };
const INVALID = '옵션명·관리코드·ERP 식별자·옵션가·재고수량·안전재고·사용여부를 확인해주세요. 옵션은 1~100개까지 저장할 수 있습니다.';
const signature = (attributes: Record<string, string>) => JSON.stringify(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));
export function generateGoodsOptionRows(axes: GoodsOptionAxis[], previous: GoodsOptionRow[]): Result {
  if (axes.length < 1 || axes.length > 2) return { ok: false, error: '옵션명은 1~2개 입력해주세요.' };
  const normalized = axes.map((axis) => ({ name: axis.name.trim(), values: [...new Set(axis.values.split(/[,\n]/).map((value) => value.trim()).filter(Boolean))] }));
  if (normalized.some((axis) => !axis.name || axis.name.length > 40 || !axis.values.length || axis.values.some((v) => v.length > 80))
    || new Set(normalized.map((axis) => axis.name)).size !== normalized.length) return { ok: false, error: '옵션명은 서로 다르게, 옵션값은 쉼표로 구분해 입력해주세요.' };
  if (normalized.reduce((count, axis) => count * axis.values.length, 1) > 100) return { ok: false, error: '옵션은 최대 100개까지 만들 수 있습니다. 옵션값을 줄여주세요.' };
  let combinations: Record<string, string>[] = [{}];
  for (const axis of normalized) combinations = combinations.flatMap((values) => axis.values.map((value) => ({ ...values, [axis.name]: value })));
  return { ok: true, rows: combinations.map((attributes) => previous.find((row) => signature(row.attributes) === signature(attributes))
    ?? { name: Object.values(attributes).join(' / '), code: '', attributes, extraPrice: 0, stockQty: 0 }) };
}
export function initialGoodsOptionRows(variants: AdminGoodsVariant[], basePrice: number): GoodsOptionRow[] {
  const rows = variants.filter((variant) => !variant.archivedAt || variant.isDefault)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)).map((variant) => ({
    id: variant.id, name: variant.name, code: variant.code, attributes: variant.attributes ?? {},
    extraPrice: Math.max(0, variant.price - basePrice), stockQty: variant.stockQty, expectedStockQty: variant.stockQty,
    lowStockThreshold: variant.lowStockThreshold ?? null, isActive: !variant.archivedAt,
    erpCode: variant.erpCode ?? null, erpName: variant.erpName ?? null, barcode: variant.barcode ?? null,
    externalUpdatedAt: variant.externalUpdatedAt ?? null,
  }));
  return rows.length ? rows : [{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: 0,
    erpCode: null, erpName: null, barcode: null, externalUpdatedAt: null }];
}
export function parseGoodsOptionRows(raw: string, basePrice: number): Result {
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 100) throw new Error();
    const ids = new Set<string>(); const combinations = new Set<string>(); const codes = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200
        || typeof row.code !== 'string' || row.code.trim().length > 120
        || !Number.isSafeInteger(row.extraPrice) || row.extraPrice < 0 || row.extraPrice + basePrice > 2147483647
        || !Number.isSafeInteger(row.stockQty) || row.stockQty < 0 || row.stockQty > 2147483647
        || (row.lowStockThreshold !== undefined && row.lowStockThreshold !== null
          && (!Number.isSafeInteger(row.lowStockThreshold) || row.lowStockThreshold < 0 || row.lowStockThreshold > 2147483647))
        || (row.isActive !== undefined && typeof row.isActive !== 'boolean')
        || !validExternalText(row.erpCode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpCode)
        || !validExternalText(row.erpName, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpName)
        || !validExternalText(row.barcode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.barcode)
        || !validExternalUpdatedAt(row.externalUpdatedAt)
        || !row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes)) throw new Error();
      const attributes = Object.entries(row.attributes);
      if (attributes.length > 2 || attributes.some(([key, value]) => !key.trim() || key.length > 40 || typeof value !== 'string' || !value.trim() || value.length > 80)) throw new Error();
      if (row.id && (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.expectedStockQty) || row.expectedStockQty < 0)) throw new Error();
      if (row.id) ids.add(row.id);
      const combo = signature(row.attributes);
      if (combinations.has(combo) || (row.code && codes.has(row.code.toUpperCase()))) throw new Error();
      combinations.add(combo); if (row.code) codes.add(row.code.toUpperCase());
    }
    return { ok: true, rows };
  } catch { return { ok: false, error: INVALID }; }
}

/** Rendering a failed submission must preserve editable invalid values too. SQL/action validation remains strict. */
export function restoreGoodsOptionRows(raw?: string): GoodsOptionRow[] | null {
  if (!raw) return null;
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) && rows.length > 0 && rows.length <= 100 && rows.every((row) => row && typeof row === 'object'
      && typeof row.name === 'string' && typeof row.code === 'string' && typeof row.extraPrice === 'number'
      && typeof row.stockQty === 'number' && row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
      && validExternalText(row.erpCode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpCode)
      && validExternalText(row.erpName, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpName)
      && validExternalText(row.barcode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.barcode)
      && validExternalUpdatedAt(row.externalUpdatedAt)) ? rows : null;
  } catch { return null; }
}

function validExternalText(value: unknown, maxLength: number): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && value.trim().length <= maxLength);
}

function validExternalUpdatedAt(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

/** 표 선택·ERP 제안이 행을 가리키는 키. 저장된 옵션은 id, 새 조합은 옵션값 조합으로 구분한다. */
export function goodsOptionRowKey(row: Pick<GoodsOptionRow, 'id' | 'attributes'>): string {
  return row.id ?? `new:${signature(row.attributes)}`;
}

/** 옵션 미사용(기본 옵션 한 개만으로 판매) 상태인지. */
export function isSingleGoodsOption(rows: readonly GoodsOptionRow[]): boolean {
  return rows.length === 1 && Object.keys(rows[0]?.attributes ?? {}).length === 0;
}

/** 옵션 재고수량 합계. 사용 중지한 옵션의 보유 수량은 따로 센다. */
export function goodsOptionStockTotals(rows: readonly GoodsOptionRow[]): { total: number; active: number } {
  return rows.reduce((sum, row) => {
    const quantity = Number.isFinite(row.stockQty) ? Math.max(0, Math.trunc(row.stockQty)) : 0;
    return { total: sum.total + quantity, active: sum.active + (row.isActive === false ? 0 : quantity) };
  }, { total: 0, active: 0 });
}

export type GoodsOptionBulkEdit = { extraPrice?: number; stockQty?: number; isActive?: boolean };
export type GoodsOptionBulkInput = { extraPrice: string; stockQty: string; isActive: '' | 'active' | 'stopped' };

function bulkInteger(raw: string): number | undefined | null {
  const text = raw.trim().replaceAll(',', '');
  if (!text) return undefined;
  if (!/^\d+$/.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
}

/** 선택목록 일괄수정 입력. 빈 칸은 바꾸지 않는다. */
export function parseGoodsOptionBulkEdit(input: GoodsOptionBulkInput): { ok: true; edit: GoodsOptionBulkEdit } | { ok: false; error: string } {
  const extraPrice = bulkInteger(input.extraPrice);
  const stockQty = bulkInteger(input.stockQty);
  if (extraPrice === null || stockQty === null) return { ok: false, error: '옵션가와 재고수량은 0 이상의 정수로 입력해주세요. 바꾸지 않을 칸은 비워 둡니다.' };
  const edit: GoodsOptionBulkEdit = {
    ...(extraPrice !== undefined ? { extraPrice } : {}),
    ...(stockQty !== undefined ? { stockQty } : {}),
    ...(input.isActive ? { isActive: input.isActive === 'active' } : {}),
  };
  if (!Object.keys(edit).length) return { ok: false, error: '일괄수정할 옵션가·재고수량·사용여부 중 하나 이상을 입력해주세요.' };
  return { ok: true, edit };
}

export function applyGoodsOptionBulkEdit(rows: readonly GoodsOptionRow[], keys: ReadonlySet<string>, edit: GoodsOptionBulkEdit): GoodsOptionRow[] {
  return rows.map((row) => keys.has(goodsOptionRowKey(row)) ? { ...row, ...edit } : row);
}

/** 선택삭제. 옵션은 한 개 이상 남아야 하며, 주문에 쓰인 옵션은 저장할 때 삭제 대신 보관된다. */
export function removeGoodsOptionRows(rows: readonly GoodsOptionRow[], keys: ReadonlySet<string>): Result {
  const next = rows.filter((row) => !keys.has(goodsOptionRowKey(row)));
  if (next.length === rows.length) return { ok: false, error: '삭제할 옵션을 선택해주세요.' };
  if (!next.length) return { ok: false, error: '옵션은 1개 이상 남아야 합니다. 옵션을 쓰지 않으려면 옵션 사용을 설정안함으로 바꿔주세요.' };
  return { ok: true, rows: next };
}

/**
 * 옵션 사용 → 설정안함. 첫 행(기본 옵션 id·관리코드·재고·ERP 정보)을 남기고 옵션값을 지운다.
 * 옵션 없이 파는 상품 화면에는 옵션별 사용여부 칸이 없으므로, 중지된 첫 옵션은 사용으로 되돌린다.
 */
export function collapseGoodsOptionRows(rows: readonly GoodsOptionRow[]): GoodsOptionRow[] {
  const [first] = rows;
  if (!first) return [];
  return [first.isActive === false ? { ...first, attributes: {}, isActive: true } : { ...first, attributes: {} }];
}

/** 옵션 사용을 설정안함으로 바꾸기 전 확인 문구. 무엇이 남고 무엇이 빠지는지 알린다. */
export function goodsOptionCollapseNotice(rows: readonly GoodsOptionRow[]): string {
  const [first] = rows;
  const removed = Math.max(0, rows.length - 1);
  return `옵션 사용을 설정안함으로 바꾸면 첫 옵션(${first?.name ?? ''})만 옵션값 없이 기본 옵션으로 남습니다. 관리코드·재고수량·ERP 정보는 유지됩니다.`
    + (first?.isActive === false ? ' 첫 옵션은 사용 중지 상태라 사용으로 바꿉니다. 판매를 멈추려면 기본 정보의 운영 상태를 판매 중지로 바꿔주세요.' : '')
    + (removed ? ` 나머지 옵션 ${removed}개는 옵션목록에서 빠지고, 주문·장바구니에 쓰인 옵션은 저장할 때 삭제 대신 보관됩니다.` : '')
    + ' 계속할까요?';
}

/** ERP 품목을 명시적으로 고르면 품명·품번을 덮어쓰고, 비어 있는 바코드만 채운다. */
export function applyErpItemToGoodsOption(row: GoodsOptionRow, item: Pick<ErpItemMatch, 'code' | 'name' | 'barcode'>): GoodsOptionRow {
  return {
    ...row, erpName: item.name, erpCode: item.code,
    barcode: row.barcode?.trim() ? row.barcode : item.barcode ?? row.barcode ?? null,
  };
}

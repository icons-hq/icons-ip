import type { AdminGoodsVariant } from './goods-variants';
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
const INVALID = '옵션 이름·코드·ERP 식별자·추가금액·재고·안전재고·사용 상태를 확인해주세요. 옵션은 1~100개까지 저장할 수 있습니다.';
const signature = (attributes: Record<string, string>) => JSON.stringify(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));
export function generateGoodsOptionRows(axes: GoodsOptionAxis[], previous: GoodsOptionRow[]): Result {
  if (axes.length < 1 || axes.length > 2) return { ok: false, error: '옵션 축은 1~2개를 입력해주세요.' };
  const normalized = axes.map((axis) => ({ name: axis.name.trim(), values: [...new Set(axis.values.split(/[,\n]/).map((value) => value.trim()).filter(Boolean))] }));
  if (normalized.some((axis) => !axis.name || axis.name.length > 40 || !axis.values.length || axis.values.some((v) => v.length > 80))
    || new Set(normalized.map((axis) => axis.name)).size !== normalized.length) return { ok: false, error: '서로 다른 축 이름과 쉼표로 구분한 값을 입력해주세요.' };
  if (normalized.reduce((count, axis) => count * axis.values.length, 1) > 100) return { ok: false, error: '조합은 최대 100개입니다. 옵션 값을 줄여주세요.' };
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

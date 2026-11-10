import type { AdminGoodsVariant } from './goods-variants';
import { parseGoodsOptionRows, GOODS_OPTION_AXIS_LIMIT, GOODS_OPTION_ROW_LIMIT, type GoodsOptionAxis, type GoodsOptionRow } from './goods-option-editor';

export const GOODS_OPTION_IMPORT_PATH = '/admin/catalog/goods';
export const GOODS_OPTION_IMPORT_PAGE_SIZE = 20;
export type GoodsOptionImportFilters = { query: string; field: 'name' | 'code' | 'id'; categoryId: string; page: number };
export type GoodsOptionImportCandidate = { id: string; code: string; name: string; categoryName: string | null; imageUrl: string | null; published: boolean };
export type GoodsOptionImportPage = { rows: GoodsOptionImportCandidate[]; total: number; page: number; pageSize: 20 };
export type GoodsOptionDefinition = { name: string; attributes: Record<string, string>; price: number };
/** Stored base/variant prices only. No stock, source option IDs, ERP identifiers or live price projections. */
export type GoodsOptionImportSource = { id: string; code: string; name: string; basePrice: number; rows: GoodsOptionDefinition[]; version: string };
export type GoodsOptionImportTarget = {
  id: string; publishedAt: string | null; archivedAt: string | null; price: number; compareAtPrice: number | null; showDiscountRate?: boolean;
  variants: Pick<AdminGoodsVariant, 'id' | 'name' | 'code' | 'attributes' | 'price' | 'stockQty' | 'lowStockThreshold' | 'isDefault' | 'archivedAt' | 'erpCode' | 'erpName' | 'barcode' | 'externalUpdatedAt'>[];
};
export type GoodsOptionImportContext = { accountId: string; target: GoodsOptionImportTarget | null; databaseVersion: string; blockedReason: string | null; pending: boolean };
export type GoodsOptionImportPlan = {
  rows: GoodsOptionRow[]; axes: GoodsOptionAxis[]; retained: number; added: number; stopped: number; priceChanged: number;
  changes: { name: string; kind: 'kept' | 'added' | 'stopped'; oldExtraPrice: number | null; extraPrice: number; stockQty: number; active: boolean }[];
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const money = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2147483647;
export const validOptionImportGoodId = (value: unknown): value is string => typeof value === 'string' && value.length <= 100 && /^[a-z0-9][a-z0-9-]*$/.test(value);
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
/** Identity is exact text, independent of object key order. Never trim or Unicode-normalize an existing option identity. */
export const exactGoodsOptionIdentity = (attributes: Record<string, string>) => JSON.stringify(Object.entries(attributes).sort(([a], [b]) => compare(a, b)));

export function parseGoodsOptionImportFilters(value: unknown): GoodsOptionImportFilters | null {
  if (!record(value) || typeof value.query !== 'string' || value.query.trim().length > 100 || !['name', 'code', 'id'].includes(String(value.field))
    || typeof value.categoryId !== 'string' || value.categoryId !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.categoryId)
    || !Number.isSafeInteger(value.page) || Number(value.page) < 1 || Number(value.page) > 100000) return null;
  return { query: value.query.trim(), field: value.field as GoodsOptionImportFilters['field'], categoryId: value.categoryId.toLowerCase(), page: Number(value.page) };
}

export function goodsOptionImportTargetVersion(target: GoodsOptionImportTarget | null): string {
  if (!target) return 'new';
  return JSON.stringify([target.id, target.publishedAt, target.archivedAt, target.price, target.compareAtPrice, target.showDiscountRate !== false,
    [...target.variants].sort((a, b) => compare(a.id, b.id)).map(row => [row.id, row.name, row.code, exactGoodsOptionIdentity(row.attributes ?? {}),
      row.price, row.stockQty, row.lowStockThreshold ?? null, row.isDefault, row.archivedAt, row.erpCode ?? null, row.erpName ?? null, row.barcode ?? null, row.externalUpdatedAt ?? null])]);
}

export function parseGoodsOptionImportSource(value: unknown): GoodsOptionImportSource | null {
  if (!record(value) || !validOptionImportGoodId(value.id) || typeof value.code !== 'string' || typeof value.name !== 'string'
    || !value.name.trim() || value.name.length > 100 || !money(value.basePrice) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
    || !Array.isArray(value.rows) || value.rows.length < 1 || value.rows.length > GOODS_OPTION_ROW_LIMIT) return null;
  const seen = new Set<string>();
  let axes: string | null = null;
  const rows: GoodsOptionDefinition[] = [];
  for (const row of value.rows) {
    if (!record(row) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || !money(row.price) || !record(row.attributes)) return null;
    const entries = Object.entries(row.attributes);
    if (entries.length < 1 || entries.length > GOODS_OPTION_AXIS_LIMIT || entries.some(([key, val]) => !key.trim() || key.length > 40 || typeof val !== 'string' || !val.trim() || val.length > 80)) return null;
    const attributes = Object.fromEntries(entries) as Record<string, string>;
    const keys = JSON.stringify(Object.keys(attributes).sort(compare)), identity = exactGoodsOptionIdentity(attributes);
    if (axes !== null && axes !== keys || seen.has(identity)) return null;
    axes = keys; seen.add(identity); rows.push({ name: row.name, attributes, price: row.price });
  }
  return { id: value.id, name: value.name, code: value.code, basePrice: value.basePrice, version: value.version, rows };
}

function emptyNewDefault(row: GoodsOptionRow): boolean {
  return !row.id && row.name === '기본 옵션' && row.code === '' && !Object.keys(row.attributes).length && row.extraPrice === 0 && row.stockQty === 0
    && row.expectedStockQty === undefined && row.isActive !== false && row.lowStockThreshold == null
    && !row.erpCode && !row.erpName && !row.barcode && !row.externalUpdatedAt;
}

/** Preview and application cross this same pure interface; it never changes the original rows or stock baselines. */
export function planGoodsOptionImport(input: { current: GoodsOptionRow[]; source: GoodsOptionImportSource; basePrice: number; includePrices: boolean }):
  { ok: true; plan: GoodsOptionImportPlan } | { ok: false; error: string } {
  const source = parseGoodsOptionImportSource(input.source);
  if (!source) return { ok: false, error: '불러올 선택형 옵션을 확인할 수 없습니다. 옵션이 없거나 구성·금액이 유효하지 않습니다.' };
  if (!money(input.basePrice) || !parseGoodsOptionRows(JSON.stringify(input.current), input.basePrice).ok) return { ok: false, error: '현재 옵션의 이름·금액·재고 입력을 확인한 뒤 다시 비교해주세요. 입력은 유지됩니다.' };
  const current = input.current.length === 1 && emptyNewDefault(input.current[0]) ? [] : input.current;
  const byIdentity = new Map(current.map(row => [exactGoodsOptionIdentity(row.attributes), row]));
  if (byIdentity.size !== current.length) return { ok: false, error: '현재 옵션에 같은 조합이 중복되어 있습니다. 옵션을 확인해주세요.' };
  const rows: GoodsOptionRow[] = [], changes: GoodsOptionImportPlan['changes'] = [];
  let retained = 0, added = 0, stopped = 0, priceChanged = 0;
  for (const definition of source.rows) {
    const identity = exactGoodsOptionIdentity(definition.attributes), previous = byIdentity.get(identity);
    const extraPrice = input.includePrices ? definition.price - source.basePrice : previous?.extraPrice ?? 0;
    if (!money(extraPrice) || !money(input.basePrice + extraPrice)) return { ok: false, error: '원본 옵션가 또는 적용 후 판매금액이 허용 범위를 벗어납니다. 원본 저장 금액을 확인해주세요.' };
    const row: GoodsOptionRow = previous ? { ...previous, attributes: { ...previous.attributes }, extraPrice }
      : { name: definition.name, attributes: { ...definition.attributes }, code: '', extraPrice, stockQty: 0, isActive: true };
    rows.push(row); changes.push({ name: row.name, kind: previous ? 'kept' : 'added', oldExtraPrice: previous?.extraPrice ?? null, extraPrice, stockQty: row.stockQty, active: row.isActive !== false });
    if (previous) { retained++; if (previous.extraPrice !== extraPrice) priceChanged++; } else added++;
    byIdentity.delete(identity);
  }
  for (const previous of current) {
    if (!byIdentity.has(exactGoodsOptionIdentity(previous.attributes))) continue;
    rows.push({ ...previous, attributes: { ...previous.attributes }, isActive: false });
    changes.push({ name: previous.name, kind: 'stopped', oldExtraPrice: previous.extraPrice, extraPrice: previous.extraPrice, stockQty: previous.stockQty, active: false });
    if (previous.isActive !== false) stopped++;
  }
  if (rows.length > GOODS_OPTION_ROW_LIMIT) return { ok: false, error: `보존할 기존 옵션을 합치면 ${rows.length}개입니다. 옵션은 중지 항목을 포함해 최대 ${GOODS_OPTION_ROW_LIMIT}개까지 편집할 수 있습니다.` };
  if (!parseGoodsOptionRows(JSON.stringify(rows), input.basePrice).ok) return { ok: false, error: '적용할 옵션 구성을 확인하지 못했습니다. 현재 입력은 유지됩니다.' };
  const axes = Object.keys(source.rows[0].attributes).map(name => ({ name, values: [...new Set(source.rows.map(row => row.attributes[name]))].join(', ') }));
  return { ok: true, plan: { rows, axes, retained, added, stopped, priceChanged, changes } };
}

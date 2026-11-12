import type { AdminGoodsVariant } from './goods-variants';
import type { ErpItemMatch } from './erp-items';
import { GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS } from './variant-external-identity';
export type GoodsOptionRow = {
  id?: string;
  name: string;
  code: string;
  attributes: Record<string, string>;
  extraPrice: number;
  /**
   * 재고수량. 아직 입력하지 않은 새 재고 칸은 NaN이다(0901-015 — 새 상품·새 옵션은 빈 칸으로 시작하고, 0은 직접 입력해야 한다).
   * 제출 JSON에서는 null이 되고, 서버 정규화(parseGoodsOptionRows)가 저장을 막는다.
   */
  stockQty: number;
  expectedStockQty?: number;
  lowStockThreshold?: number | null;
  isActive?: boolean;
  erpCode?: string | null;
  erpName?: string | null;
  barcode?: string | null;
  externalUpdatedAt?: string | null;
  /**
   * 옵션별 구매 제한(D7②). 주문 1건의 최대 수량·회원 1명의 누적 최대 수량, null은 제한 없음.
   * 키가 없으면 DB가 기존 값을 유지한다(private.save_goods_options). 읽어 온 값·입력한 값만 키로 싣는다.
   */
  orderMaxQty?: number | null;
  memberMaxQty?: number | null;
};
/** 어드민 옵션 조회가 옵션별 구매 제한을 읽어 오면 채워지는 값. 읽지 않았으면 undefined라 저장 키에서 빠진다. */
export type GoodsVariantPurchaseLimits = { orderMaxQty?: number | null; memberMaxQty?: number | null };
export const GOODS_OPTION_LIMIT_KEYS = ['orderMaxQty', 'memberMaxQty'] as const;
export type GoodsOptionAxis = { name: string; values: string };
export const GOODS_OPTION_AXIS_LIMIT = 3;
export const GOODS_OPTION_ROW_LIMIT = 100;
type Result = { ok: true; rows: GoodsOptionRow[] } | { ok: false; error: string };
const INVALID = '옵션명·관리코드·ERP 식별자·옵션가·재고수량·안전재고·사용여부·옵션별 구매 제한(1 이상의 정수)을 확인해주세요. 옵션은 1~100개까지 저장할 수 있습니다.';
/** 0901-015: 재고수량 칸을 비운 채로는 저장하지 않는다. 재고가 없으면 0을 직접 입력한다. 화면 검증과 서버 정규화가 같은 문구를 쓴다. */
export const GOODS_OPTION_STOCK_REQUIRED = '재고수량을 입력해주세요. 재고가 없으면 0을 입력합니다.';
const signature = (attributes: Record<string, string>) => JSON.stringify(Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)));

/**
 * 다른 상품 옵션 불러오기(goods-option-import)는 저장할 수 있는 옵션 행끼리 비교한다. 비운 재고 칸은 비교하는 동안만 0으로 본다.
 * 적용 결과(`emptyNewGoodsOptionStock`)에서는 새로 더한 옵션과 원래 비어 있던 옵션의 재고 칸을 다시 비운다 — 0은 직접 입력해야 한다(0901-015).
 */
export function goodsOptionRowsForImport(rows: readonly GoodsOptionRow[]): GoodsOptionRow[] {
  return rows.map((row) => Number.isFinite(row.stockQty) ? row : { ...row, stockQty: 0 });
}
export function emptyNewGoodsOptionStock(next: readonly GoodsOptionRow[], previous: readonly GoodsOptionRow[]): GoodsOptionRow[] {
  const known = new Map(previous.map((row) => [goodsOptionRowKey(row), row]));
  return next.map((row) => {
    const before = known.get(goodsOptionRowKey(row));
    return row.stockQty === 0 && (!before || !Number.isFinite(before.stockQty)) ? { ...row, stockQty: Number.NaN } : row;
  });
}

/** 비어 있는(입력하지 않은) 재고 칸 수. 0은 입력한 값이다. */
export function goodsOptionStockMissing(rows: readonly Pick<GoodsOptionRow, 'stockQty'>[]): number {
  return rows.filter((row) => !Number.isFinite(row.stockQty)).length;
}

/** 서버에 온 옵션 행 JSON에서 재고를 비운 첫 행의 안내. 옵션이 여럿이면 어느 옵션인지 밝힌다. */
function stockRequiredError(rows: readonly unknown[]): string | null {
  const index = rows.findIndex((row) => Boolean(row) && typeof row === 'object' && ((row as { stockQty?: unknown }).stockQty === null || (row as { stockQty?: unknown }).stockQty === undefined));
  if (index < 0) return null;
  const row = rows[index] as { name?: unknown; attributes?: unknown };
  const single = rows.length === 1 && (!row.attributes || typeof row.attributes !== 'object' || !Object.keys(row.attributes).length);
  if (single) return GOODS_OPTION_STOCK_REQUIRED;
  const name = typeof row.name === 'string' ? row.name.trim() : '';
  return `옵션 ${index + 1}${name ? `(${name})` : ''}: ${GOODS_OPTION_STOCK_REQUIRED}`;
}
export function generateGoodsOptionRows(axes: GoodsOptionAxis[], previous: GoodsOptionRow[]): Result {
  if (axes.length < 1 || axes.length > GOODS_OPTION_AXIS_LIMIT) return { ok: false, error: `옵션명은 1~${GOODS_OPTION_AXIS_LIMIT}개 입력해주세요.` };
  const normalized = axes.map((axis) => ({ name: axis.name.trim(), values: [...new Set(axis.values.split(/[,\n]/).map((value) => value.trim()).filter(Boolean))] }));
  if (normalized.some((axis) => !axis.name || axis.name.length > 40 || !axis.values.length || axis.values.some((v) => v.length > 80))
    || new Set(normalized.map((axis) => axis.name)).size !== normalized.length) return { ok: false, error: '옵션명은 서로 다르게, 옵션값은 쉼표로 구분해 입력해주세요.' };
  if (normalized.reduce((count, axis) => count * axis.values.length, 1) > GOODS_OPTION_ROW_LIMIT) return { ok: false, error: `옵션은 최대 ${GOODS_OPTION_ROW_LIMIT}개까지 만들 수 있습니다. 옵션값을 줄여주세요.` };
  let combinations: Record<string, string>[] = [{}];
  for (const axis of normalized) combinations = combinations.flatMap((values) => axis.values.map((value) => ({ ...values, [axis.name]: value })));
  /* 새 조합의 재고 칸은 비워 둔다(0901-015). 이미 있던 조합은 입력값을 그대로 둔다. */
  return { ok: true, rows: combinations.map((attributes) => previous.find((row) => signature(row.attributes) === signature(attributes))
    ?? { name: Object.values(attributes).join(' / '), code: '', attributes, extraPrice: 0, stockQty: Number.NaN }) };
}
export function initialGoodsOptionRows(variants: (AdminGoodsVariant & GoodsVariantPurchaseLimits)[], basePrice: number): GoodsOptionRow[] {
  const rows = variants.filter((variant) => !variant.archivedAt || variant.isDefault)
    .sort((left, right) => Number(right.isDefault) - Number(left.isDefault)).map((variant) => ({
    id: variant.id, name: variant.name, code: variant.code, attributes: variant.attributes ?? {},
    extraPrice: Math.max(0, variant.price - basePrice), stockQty: variant.stockQty, expectedStockQty: variant.stockQty,
    lowStockThreshold: variant.lowStockThreshold ?? null, isActive: !variant.archivedAt,
    erpCode: variant.erpCode ?? null, erpName: variant.erpName ?? null, barcode: variant.barcode ?? null,
    externalUpdatedAt: variant.externalUpdatedAt ?? null,
    ...Object.fromEntries(GOODS_OPTION_LIMIT_KEYS.filter((key) => variant[key] !== undefined).map((key) => [key, variant[key]])),
  }));
  /* 새 상품의 기본 옵션 재고 칸은 빈 값으로 시작한다(0901-015). */
  return rows.length ? rows : [{ name: '기본 옵션', code: '', attributes: {}, extraPrice: 0, stockQty: Number.NaN,
    erpCode: null, erpName: null, barcode: null, externalUpdatedAt: null }];
}
export function parseGoodsOptionRows(raw: string, basePrice: number): Result {
  try {
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > GOODS_OPTION_ROW_LIMIT) throw new Error();
    /* 0901-015 서버 정규화: 비운 재고 칸은 0으로 바꾸지 않고 저장을 막는다. */
    const missingStock = stockRequiredError(rows);
    if (missingStock) return { ok: false, error: missingStock };
    const ids = new Set<string>(); const combinations = new Set<string>(); const codes = new Set<string>();
    for (const row of rows) {
      if (!row || typeof row !== 'object' || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200
        || typeof row.code !== 'string' || row.code.trim().length > 120
        || !Number.isSafeInteger(row.extraPrice) || row.extraPrice < 0 || row.extraPrice + basePrice > 2147483647
        || !Number.isSafeInteger(row.stockQty) || row.stockQty < 0 || row.stockQty > 2147483647
        || (row.lowStockThreshold !== undefined && row.lowStockThreshold !== null
          && (!Number.isSafeInteger(row.lowStockThreshold) || row.lowStockThreshold < 0 || row.lowStockThreshold > 2147483647))
        || (row.isActive !== undefined && typeof row.isActive !== 'boolean')
        || GOODS_OPTION_LIMIT_KEYS.some((key) => !validOptionLimit(row[key]))
        || !validExternalText(row.erpCode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpCode)
        || !validExternalText(row.erpName, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpName)
        || !validExternalText(row.barcode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.barcode)
        || !validExternalUpdatedAt(row.externalUpdatedAt)
        || !row.attributes || typeof row.attributes !== 'object' || Array.isArray(row.attributes)) throw new Error();
      const attributes = Object.entries(row.attributes);
      if (attributes.length > GOODS_OPTION_AXIS_LIMIT || attributes.some(([key, value]) => !key.trim() || key.length > 40 || typeof value !== 'string' || !value.trim() || value.length > 80)) throw new Error();
      if (row.id && (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(row.id) || ids.has(row.id) || !Number.isSafeInteger(row.expectedStockQty) || row.expectedStockQty < 0)) throw new Error();
      if (row.id) ids.add(row.id);
      const combo = signature(row.attributes);
      if (combinations.has(combo) || (row.code && codes.has(row.code.toUpperCase()))) throw new Error();
      combinations.add(combo); if (row.code) codes.add(row.code.toUpperCase());
    }
    return { ok: true, rows };
  } catch { return { ok: false, error: INVALID }; }
}

/**
 * Rendering a failed submission must preserve editable invalid values too. SQL/action validation remains strict.
 * 비운 재고 칸(JSON null)은 다시 빈 칸(NaN)으로 되살린다 — 실패·자동복구·임시저장 뒤에도 0으로 바뀌지 않는다(0901-015).
 */
export function restoreGoodsOptionRows(raw?: string): GoodsOptionRow[] | null {
  if (!raw) return null;
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) && rows.length > 0 && rows.length <= 100 && rows.every((row) => row && typeof row === 'object'
      && typeof row.name === 'string' && typeof row.code === 'string' && typeof row.extraPrice === 'number'
      && (typeof row.stockQty === 'number' || row.stockQty === null) && row.attributes && typeof row.attributes === 'object' && !Array.isArray(row.attributes)
      && GOODS_OPTION_LIMIT_KEYS.every((key) => row[key] === undefined || row[key] === null || typeof row[key] === 'number')
      && validExternalText(row.erpCode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpCode)
      && validExternalText(row.erpName, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.erpName)
      && validExternalText(row.barcode, GOODS_VARIANT_EXTERNAL_IDENTITY_LIMITS.barcode)
      && validExternalUpdatedAt(row.externalUpdatedAt))
      ? rows.map((row: GoodsOptionRow | (Omit<GoodsOptionRow, 'stockQty'> & { stockQty: null })) => row.stockQty === null ? { ...row, stockQty: Number.NaN } : row as GoodsOptionRow)
      : null;
  } catch { return null; }
}

/** 옵션별 구매 제한: 키 없음(기존 값 유지)·null(제한 없음)·1 이상의 정수. */
function validOptionLimit(value: unknown): boolean {
  return value === undefined || value === null || (Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 2147483647);
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

const limitPair = (row: GoodsVariantPurchaseLimits) => `${row.orderMaxQty ?? null}|${row.memberMaxQty ?? null}`;

/**
 * 랜덤 판매 상품의 옵션 행 변경. 판매 중인 옵션은 모두 같은 '같은 옵션 배정 상한'(주문당·1인)이어야 저장된다
 * (DB `random_option_limit_mismatch`). 이번 변경으로 판매 중이 된 행 — 옵션목록 적용·다른 상품 옵션 불러오기로 더한 옵션,
 * 사용 중지에서 사용으로 바꾼 옵션 — 에는 변경 전 판매 중 옵션의 공통 상한을 채워 바로 저장되게 한다. 변경 전 판매 중 옵션끼리
 * 값이 달라 공통 상한이 없으면(랜덤 전환 전에 저장한 값) 손대지 않는다 — 구매 제한 카드가 다시 입력하라고 경고한다.
 * 상한 키가 없는 행은 값을 읽지 않은 행(DB 값 보존)이라 공통 상한을 알 수 없으므로 그때도 손대지 않는다.
 */
export function inheritRandomOptionLimits(previous: readonly GoodsOptionRow[], next: GoodsOptionRow[]): GoodsOptionRow[] {
  const before = previous.filter((row) => row.isActive !== false);
  if (!before.length || before.some((row) => row.orderMaxQty === undefined || row.memberMaxQty === undefined)
    || new Set(before.map(limitPair)).size !== 1) return next;
  const common = { orderMaxQty: before[0].orderMaxQty ?? null, memberMaxQty: before[0].memberMaxQty ?? null };
  const known = new Set(before.map(goodsOptionRowKey));
  let changed = false;
  const rows = next.map((row) => {
    if (row.isActive === false || known.has(goodsOptionRowKey(row)) || limitPair(row) === limitPair(common)) return row;
    changed = true;
    return { ...row, ...common };
  });
  return changed ? rows : next;
}

/** 저장된 상품코드와 이 상품의 저장된 옵션 전체(보관된 옵션 포함). 새 상품이면 `{ goodCode: null, options: [] }`. */
export type GoodsOptionSavedCodes = {
  goodCode: string | null;
  options: readonly Pick<AdminGoodsVariant, 'id' | 'code'>[];
};

const optionCode = (value: string | null | undefined) => (value ?? '').trim().toUpperCase();

/**
 * 관리코드 칸이 보여 줄 저장 시 코드(예상). 행마다 코드 또는 예상할 수 없으면 null.
 * 서버(private.save_goods_options → private.set_goods_variant_code)는 옵션을 위에서부터 저장하며, 빈 관리코드에
 * `상품코드-01`부터 아직 쓰이지 않은 첫 번호를 붙인다(관리코드는 앞뒤 공백을 지우고 대문자로 저장한다).
 * 목록에서 뺀 옵션·보관된 옵션의 코드는 저장이 끝날 때까지 남아 있어 건너뛰고, 위 옵션이 받거나 입력한 코드도 피한다.
 * 저장된 옵션은 관리코드를 비우면 기존 코드를 유지한다. 새 상품의 첫 저장은 옵션을 다시 만들어 -01부터 붙인다.
 * 저장된 옵션 정보가 없거나 상품코드를 이번 저장에서 바꾸면(기본 옵션 코드가 함께 바뀐다) 예상하지 않는다.
 * 다른 상품이 이 상품코드로 시작하는 옵션코드를 직접 쓰는 경우는 화면에서 알 수 없다.
 */
export function predictGoodsOptionCodes(rows: readonly GoodsOptionRow[], goodCode: string | undefined, saved: GoodsOptionSavedCodes | undefined): (string | null)[] {
  const unknown = rows.map(() => null);
  const prefix = optionCode(goodCode);
  if (!prefix || !saved || (saved.goodCode !== null && optionCode(saved.goodCode) !== prefix)) return unknown;
  const savedById = new Map(saved.options.map((option) => [option.id, optionCode(option.code)]));
  if (rows.some((row) => row.id && !savedById.has(row.id))) return unknown;
  const taken = new Set(savedById.values());
  const nextFree = () => {
    let ordinal = 1;
    while (taken.has(`${prefix}-${String(ordinal).padStart(2, '0')}`)) ordinal += 1;
    return `${prefix}-${String(ordinal).padStart(2, '0')}`;
  };
  return rows.map((row) => {
    const before = row.id ? savedById.get(row.id)! : null;
    /* 저장된 옵션의 빈 칸은 기존 코드를 쓰지만, 공백만 넣으면 서버가 새 번호를 붙인다. */
    if (before && row.code === '') return before;
    const code = optionCode(row.code) || nextFree();
    if (before) taken.delete(before);
    taken.add(code);
    return code;
  });
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

/**
 * 1007-045(11/11 결정 "빈 칸 자동"): ERP 품목을 고를 때 판매가 칸이 비어 있으면 그 품목의 ERP 판매가를 판매가에 넣는다.
 * 0원을 직접 입력한 칸은 값으로 보고 건드리지 않는다 — 값이 있으면 지금처럼 [ERP 판매가 적용] 버튼만 둔다.
 * 옵션이 여럿이면 판매가는 옵션가의 기준이라 그 옵션에 옵션가가 없을 때만 채운다. ERP 판매가가 0원이면 0원 판매가 되지 않게 채우지 않는다.
 */
export function shouldAutoFillErpSalePrice({ salePrice, regularPrice, single, extraPrice }: {
  salePrice: number | null | undefined; regularPrice: string | undefined; single: boolean; extraPrice: number;
}): boolean {
  return typeof salePrice === 'number' && Number.isSafeInteger(salePrice) && salePrice > 0
    && (regularPrice ?? '').trim() === '' && (single || extraPrice === 0);
}

/** ERP 품목을 명시적으로 고르면 품명·품번을 덮어쓰고, 비어 있는 바코드만 채운다. */
export function applyErpItemToGoodsOption(row: GoodsOptionRow, item: Pick<ErpItemMatch, 'code' | 'name' | 'barcode'>): GoodsOptionRow {
  return {
    ...row, erpName: item.name, erpCode: item.code,
    barcode: row.barcode?.trim() ? row.barcode : item.barcode ?? row.barcode ?? null,
  };
}

const erpIdentityKey = (value: string | null | undefined) => value?.trim().toLowerCase() ?? '';

/**
 * 옵션의 ERP 품명에서 ERP 품목을 고를 때. ERP 코드·바코드는 저장할 때 옵션 전체에서 하나뿐이어야 하므로
 * (대소문자·앞뒤 공백 무시) 같은 상품의 다른 옵션이 이미 쓰는 값이면 채우지 않고 이유를 돌려준다.
 * 바코드는 비어 있어 ERP 품목 값으로 채울 때만 비교한다. 다른 상품·보관된 옵션과의 충돌은 저장 오류가 알린다.
 */
export function selectErpItemForGoodsOption(
  rows: readonly GoodsOptionRow[],
  key: string,
  item: Pick<ErpItemMatch, 'code' | 'name' | 'barcode'>,
): { ok: true; row: GoodsOptionRow } | { ok: false; error: string } {
  const index = rows.findIndex((row) => goodsOptionRowKey(row) === key);
  const current = rows[index];
  if (!current) return { ok: false, error: 'ERP 품목을 넣을 옵션을 찾지 못했습니다. 옵션목록을 확인한 뒤 다시 골라주세요.' };
  const row = applyErpItemToGoodsOption(current, item);
  const checks: { label: string; field: 'erpCode' | 'barcode' }[] = [
    { label: 'ERP 코드', field: 'erpCode' },
    ...(row.barcode !== current.barcode ? [{ label: '바코드', field: 'barcode' as const }] : []),
  ];
  for (const { label, field } of checks) {
    const wanted = erpIdentityKey(row[field]);
    if (!wanted) continue;
    const otherIndex = rows.findIndex((other, position) => position !== index && erpIdentityKey(other[field]) === wanted);
    if (otherIndex < 0) continue;
    const otherName = rows[otherIndex].name.trim();
    return { ok: false, error: `옵션 ${otherIndex + 1}${otherName ? `(${otherName})` : ''}에 이미 같은 ${label}(${row[field]?.trim()})가 있어 채우지 않았습니다. `
      + '한 ERP 품목은 옵션 하나에만 연결할 수 있습니다. 두 옵션의 ERP 품목을 맞바꾸려면 한쪽을 비우고 저장한 뒤 다시 지정해주세요.' };
  }
  return { ok: true, row };
}

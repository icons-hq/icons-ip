import { isUuid } from '@/lib/uuid';
import type { AdminGoodsVariant } from './goods-variants';
import { parseGoodsOptionRows, GOODS_OPTION_AXIS_LIMIT, GOODS_OPTION_ROW_LIMIT, GOODS_OPTION_STOP_PANEL_TITLE, type GoodsOptionAxis, type GoodsOptionRow } from './goods-option-editor';

export const GOODS_OPTION_IMPORT_PATH = '/admin/catalog/goods';
export const GOODS_OPTION_IMPORT_PAGE_SIZE = 20;
/**
 * 상품 검색 조건. `optionSourcesOnly`·`noticeSourcesOnly`·`excludeGoodId`는 가져올 것이 있는 상품만 보여야 하는 선택창이 쓰는 선택 조건이다
 * (docs/admin-screen-rules.md 규칙 2 — 고를 수 없는 상품은 조회에서 뺀다). 주지 않으면 지금까지처럼 보관하지 않은 상품 전체를 찾는다.
 * 두 조건은 선택창이 달라 함께 쓰지 않는다.
 */
export type GoodsOptionImportFilters = {
  query: string; field: 'name' | 'code' | 'id'; categoryId: string; page: number;
  /** '다른 상품 옵션 불러오기' 선택창. true면 사용 중인 선택형 옵션(옵션값이 있는 옵션)이 하나라도 있는 상품만 찾는다. */
  optionSourcesOnly?: boolean;
  /** 상품정보제공고시 '다른 상품에서 복사' 선택창. true면 고시 7칸 가운데 하나라도 적어 둔 상품만 찾는다. */
  noticeSourcesOnly?: boolean;
  /** `optionSourcesOnly`나 `noticeSourcesOnly`와 함께 쓴다. 이 상품(지금 편집 중인 상품)은 목록에서 뺀다. */
  excludeGoodId?: string;
};
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
    || typeof value.categoryId !== 'string' || value.categoryId !== '' && !isUuid(value.categoryId)
    || !Number.isSafeInteger(value.page) || Number(value.page) < 1 || Number(value.page) > 100000) return null;
  /* 선택 조건은 없거나(undefined·null) 정해진 모양일 때만 받는다. 없으면 결과에 키를 넣지 않아 기존 호출과 같은 값이 된다. */
  const sourcesOnly = value.optionSourcesOnly ?? undefined, noticeOnly = value.noticeSourcesOnly ?? undefined, excluded = value.excludeGoodId ?? undefined;
  if (sourcesOnly !== undefined && typeof sourcesOnly !== 'boolean' || noticeOnly !== undefined && typeof noticeOnly !== 'boolean'
    || sourcesOnly && noticeOnly || excluded !== undefined && !validOptionImportGoodId(excluded)) return null;
  return { query: value.query.trim(), field: value.field as GoodsOptionImportFilters['field'], categoryId: value.categoryId.toLowerCase(), page: Number(value.page),
    ...(sourcesOnly ? { optionSourcesOnly: true } : {}), ...(noticeOnly ? { noticeSourcesOnly: true } : {}),
    ...((sourcesOnly || noticeOnly) && excluded ? { excludeGoodId: excluded } : {}) };
}

/** 운영자에게 그대로 보여도 되는 불러오기 오류(원인과 고칠 방법). 그 밖의 예외는 서버 액션이 일반 문구로 바꾼다. */
export class GoodsOptionImportError extends Error {
  constructor(message: string) { super(message); this.name = 'GoodsOptionImportError'; }
}

/** 고른 상품의 옵션을 불러올 수 없는 원인. 원인마다 무엇이 문제이고 어떻게 고치는지를 말한다(admin-copy-guide 원칙 4). */
export type GoodsOptionImportProblem = 'no_active' | 'no_options' | 'mixed' | 'axis_limit' | 'axis_mismatch' | 'duplicate' | 'too_many' | 'unreadable';
export function goodsOptionImportProblemMessage(problem: GoodsOptionImportProblem, count = 0): string {
  switch (problem) {
    case 'no_active': return `이 상품은 옵션이 모두 사용 중지돼 있어 불러올 옵션이 없습니다. 그 상품의 '${GOODS_OPTION_STOP_PANEL_TITLE}'에서 [다시 사용]을 누른 뒤 불러와 주세요.`;
    case 'no_options': return '이 상품은 옵션 없이 파는 상품이라 불러올 옵션이 없습니다. 다른 상품을 골라 주세요.';
    case 'mixed': return '이 상품에는 옵션값이 없는 옵션이 섞여 있어 불러올 수 없습니다. 그 상품의 옵션목록에서 옵션값이 없는 옵션을 사용 중지하거나 삭제한 뒤 불러와 주세요.';
    case 'axis_limit': return `이 상품은 옵션명이 ${GOODS_OPTION_AXIS_LIMIT}개를 넘어 불러올 수 없습니다. 그 상품의 옵션명을 ${GOODS_OPTION_AXIS_LIMIT}개 이하로 줄인 뒤 불러와 주세요.`;
    case 'axis_mismatch': return '이 상품은 옵션마다 옵션명이 달라 불러올 수 없습니다(색상만 있는 옵션과 색상·사이즈가 있는 옵션이 섞인 경우). 그 상품의 옵션명을 하나로 맞춘 뒤 불러와 주세요.';
    case 'duplicate': return '이 상품에는 옵션값이 똑같은 옵션이 두 개 있어 불러올 수 없습니다. 그 상품에서 겹치는 옵션 하나를 사용 중지한 뒤 불러와 주세요.';
    case 'too_many': return `이 상품은 사용 중인 옵션이 ${count}개라 불러올 수 없습니다. 옵션은 ${GOODS_OPTION_ROW_LIMIT}개까지 불러올 수 있습니다.`;
    default: return '이 상품의 상품명·판매가나 옵션 이름·옵션값·옵션 판매가를 읽지 못해 불러올 수 없습니다. 그 상품을 열어 값을 확인한 뒤 다시 불러와 주세요.';
  }
}

export function goodsOptionImportTargetVersion(target: GoodsOptionImportTarget | null): string {
  if (!target) return 'new';
  return JSON.stringify([target.id, target.publishedAt, target.archivedAt, target.price, target.compareAtPrice, target.showDiscountRate !== false,
    [...target.variants].sort((a, b) => compare(a.id, b.id)).map(row => [row.id, row.name, row.code, exactGoodsOptionIdentity(row.attributes ?? {}),
      row.price, row.stockQty, row.lowStockThreshold ?? null, row.isDefault, row.archivedAt, row.erpCode ?? null, row.erpName ?? null, row.barcode ?? null, row.externalUpdatedAt ?? null])]);
}

/**
 * 불러올 상품의 옵션(사용 중인 옵션만 넘겨받는다)을 읽고, 불러올 수 없으면 원인을 가려 준다.
 * 원인을 고르는 순서: 읽을 수 없는 값 → 사용 중 옵션 없음 → 100개 초과 → 옵션값 없는 옵션(전부면 옵션 없는 상품, 일부면 섞임)
 * → 옵션명 3개 초과 → 옵션마다 옵션명이 다름 → 같은 옵션값 조합.
 */
export function diagnoseGoodsOptionImportSource(value: unknown):
  { ok: true; source: GoodsOptionImportSource } | { ok: false; problem: GoodsOptionImportProblem; error: string } {
  const fail = (problem: GoodsOptionImportProblem, count?: number) => ({ ok: false as const, problem, error: goodsOptionImportProblemMessage(problem, count) });
  if (!record(value) || !validOptionImportGoodId(value.id) || typeof value.code !== 'string' || typeof value.name !== 'string'
    || !value.name.trim() || value.name.length > 100 || !money(value.basePrice) || typeof value.version !== 'string' || !/^[a-f0-9]{64}$/.test(value.version)
    || !Array.isArray(value.rows)) return fail('unreadable');
  if (value.rows.length < 1) return fail('no_active');
  if (value.rows.length > GOODS_OPTION_ROW_LIMIT) return fail('too_many', value.rows.length);
  if (value.rows.some(row => !record(row) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 200 || !money(row.price) || !record(row.attributes))) return fail('unreadable');
  const plain = value.rows.filter(row => !Object.keys((row as { attributes: Record<string, unknown> }).attributes).length).length;
  if (plain) return fail(plain === value.rows.length ? 'no_options' : 'mixed');
  const seen = new Set<string>();
  let axes: string | null = null;
  const rows: GoodsOptionDefinition[] = [];
  for (const row of value.rows as { name: string; price: number; attributes: Record<string, unknown> }[]) {
    const entries = Object.entries(row.attributes);
    if (entries.length > GOODS_OPTION_AXIS_LIMIT) return fail('axis_limit');
    if (entries.some(([key, val]) => !key.trim() || key.length > 40 || typeof val !== 'string' || !val.trim() || val.length > 80)) return fail('unreadable');
    const attributes = Object.fromEntries(entries) as Record<string, string>;
    const keys = JSON.stringify(Object.keys(attributes).sort(compare)), identity = exactGoodsOptionIdentity(attributes);
    if (axes !== null && axes !== keys) return fail('axis_mismatch');
    if (seen.has(identity)) return fail('duplicate');
    axes = keys; seen.add(identity); rows.push({ name: row.name, attributes, price: row.price });
  }
  return { ok: true, source: { id: value.id, name: value.name, code: value.code, basePrice: value.basePrice, version: value.version, rows } };
}

export function parseGoodsOptionImportSource(value: unknown): GoodsOptionImportSource | null {
  const result = diagnoseGoodsOptionImportSource(value);
  return result.ok ? result.source : null;
}

function emptyNewDefault(row: GoodsOptionRow): boolean {
  return !row.id && row.name === '기본 옵션' && row.code === '' && !Object.keys(row.attributes).length && row.extraPrice === 0 && row.stockQty === 0
    && row.expectedStockQty === undefined && row.isActive !== false && row.lowStockThreshold == null
    && !row.erpCode && !row.erpName && !row.barcode && !row.externalUpdatedAt;
}

/** Preview and application cross this same pure interface; it never changes the original rows or stock baselines. */
export function planGoodsOptionImport(input: { current: GoodsOptionRow[]; source: GoodsOptionImportSource; basePrice: number; includePrices: boolean }):
  { ok: true; plan: GoodsOptionImportPlan } | { ok: false; error: string } {
  const read = diagnoseGoodsOptionImportSource(input.source);
  if (!read.ok) return { ok: false, error: read.error };
  const source = read.source;
  if (!money(input.basePrice) || !parseGoodsOptionRows(JSON.stringify(input.current), input.basePrice).ok) return { ok: false, error: '지금 상품의 판매가나 옵션 이름·옵션가·재고수량에 저장할 수 없는 값이 있습니다. 고친 뒤 다시 비교해 주세요. 입력한 내용은 그대로입니다.' };
  const current = input.current.length === 1 && emptyNewDefault(input.current[0]) ? [] : input.current;
  const byIdentity = new Map(current.map(row => [exactGoodsOptionIdentity(row.attributes), row]));
  if (byIdentity.size !== current.length) return { ok: false, error: '지금 상품에 옵션값이 똑같은 옵션이 두 개 있습니다. 옵션목록에서 하나를 뺀 뒤 다시 비교해 주세요.' };
  const rows: GoodsOptionRow[] = [], changes: GoodsOptionImportPlan['changes'] = [];
  let retained = 0, added = 0, stopped = 0, priceChanged = 0;
  for (const definition of source.rows) {
    const identity = exactGoodsOptionIdentity(definition.attributes), previous = byIdentity.get(identity);
    const extraPrice = input.includePrices ? definition.price - source.basePrice : previous?.extraPrice ?? 0;
    /* 옵션가는 0원 이상이다. 고른 상품의 옵션이 그 상품 판매가보다 싸면 옵션가로 옮길 수 없다. */
    if (extraPrice < 0) return { ok: false, error: `고른 상품의 옵션(${definition.name})이 그 상품 판매가보다 싸서 옵션가를 불러올 수 없습니다. [옵션가도 불러오기]를 끄고 다시 비교해 주세요.` };
    if (!money(extraPrice) || !money(input.basePrice + extraPrice)) return { ok: false, error: `옵션(${definition.name})의 불러온 뒤 판매 금액이 저장할 수 있는 금액을 넘습니다. 지금 상품의 판매가와 고른 상품의 옵션 판매가를 확인해 주세요.` };
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
  if (rows.length > GOODS_OPTION_ROW_LIMIT) return { ok: false, error: `지금 상품의 옵션에 불러올 옵션을 더하면 ${rows.length}개가 됩니다. 옵션은 사용 중지한 것까지 합쳐 ${GOODS_OPTION_ROW_LIMIT}개까지 둘 수 있습니다. 쓰지 않는 옵션을 옵션목록에서 뺀 뒤 다시 비교해 주세요.` };
  if (!parseGoodsOptionRows(JSON.stringify(rows), input.basePrice).ok) return { ok: false, error: '불러올 옵션을 확인하지 못했습니다. 입력한 내용은 그대로이니 다시 비교해 주세요.' };
  const axes = Object.keys(source.rows[0].attributes).map(name => ({ name, values: [...new Set(source.rows.map(row => row.attributes[name]))].join(', ') }));
  return { ok: true, plan: { rows, axes, retained, added, stopped, priceChanged, changes } };
}

import type { AdminFieldErrors, AdminFormResult } from './catalog';
import type { AdminCatalogSearchQuery } from './catalog-list';

/*
 * D-1 옵션 · 품목 · 출고지별 재고 — 순수 모듈(타입 · URL 계약 · 폼 정규화 · 조합 생성).
 *
 * 데이터 계약은 마이그레이션 `20260904110000`·`20260904110100` 이 정본이다. 여기서는 그 계약을
 * 화면이 다루기 쉬운 모양으로 옮기고, 서버 액션이 RPC 를 부르기 전에 입력을 믿을 수 있는 값으로 좁힌다.
 */

export const STOCK_MOVEMENT_REASONS = [
  { value: 'receive', label: '입고' },
  { value: 'count', label: '실사(수량 확정)' },
  { value: 'return_restock', label: '반품 재입고' },
  { value: 'damage', label: '파손·폐기' },
  { value: 'correction', label: '보정 (사유 필수)' },
] as const;

export type AdminStockReasonCode = (typeof STOCK_MOVEMENT_REASONS)[number]['value'];

export const STOCK_REASON_LABELS: Record<string, string> = {
  initial: '등록 시 초기 재고',
  count: '실사',
  receive: '입고',
  return_restock: '반품 재입고',
  damage: '파손·폐기',
  transfer_in: '이동 입고',
  transfer_out: '이동 출고',
  order_reserve: '주문 예약',
  order_release: '주문 예약 해제',
  order_ship: '출고',
  excel_set: '엑셀 절대값',
  wms_sync: '창고 실적',
  correction: '보정',
  legacy_write: '상품 단위 조정',
  migration_baseline: '이관 기준',
};

export const STOCK_SOURCE_LABELS: Record<string, string> = {
  admin: '어드민',
  excel: '엑셀',
  wms: '창고',
  order: '주문',
  claim: '클레임',
  count: '실사',
  system: '시스템',
  migration: '이관',
};

export const STOCK_OVERRIDE_OPTIONS = [
  { value: 'auto', label: '자동 (안전재고 이하 = 부족)' },
  { value: 'low', label: '부족 고정' },
  { value: 'soldout', label: '판매 중지 (품절 표시)' },
] as const;

export const OPTION_DISPLAY_STYLES = [
  { value: 'select', label: '드롭다운' },
  { value: 'button', label: '버튼' },
  { value: 'radio', label: '라디오' },
  { value: 'swatch', label: '색상 견본' },
] as const;

export interface AdminStockLocation {
  id: string;
  name: string;
  contact: string | null;
  erpWarehouseCode: string | null;
  defaultCarrierCode: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

export interface AdminOptionValue {
  id: string;
  value: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface AdminOptionMaster {
  id: string;
  code: string;
  name: string;
  displayStyle: string;
  sortOrder: number;
  archivedAt: string | null;
  values: AdminOptionValue[];
}

export interface AdminVariantStock {
  locationId: string;
  onHand: number;
  reserved: number;
  safety: number;
  lastSource: string;
  lastMovementAt: string | null;
  countedAt: string | null;
}

export interface AdminGoodVariant {
  id: string;
  code: string;
  customCode: string | null;
  signature: string;
  isDefault: boolean;
  additionalPrice: number;
  display: boolean;
  sellable: boolean;
  /** null = 상품 기본 출고지 상속. */
  locationId: string | null;
  imagePath: string | null;
  sortOrder: number;
  archivedAt: string | null;
  /** 옵션 id → 옵션값 id. */
  values: Record<string, string>;
  stocks: AdminVariantStock[];
}

export interface AdminGoodOption {
  optionId: string;
  position: number;
}

export interface AdminGoodVariantEditorData {
  goodId: string;
  defaultLocationId: string;
  stockOverride: string;
  options: AdminGoodOption[];
  masters: AdminOptionMaster[];
  variants: AdminGoodVariant[];
  locations: AdminStockLocation[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
const INT32_MAX = 2147483647;
export const VARIANT_OPTION_LIMIT = 3;
export const VARIANT_LIMIT = 200;

export function isUuid(value: string) {
  return UUID_PATTERN.test(value);
}

export function variantAvailable(stock: Pick<AdminVariantStock, 'onHand' | 'reserved'>) {
  return stock.onHand - stock.reserved;
}

export function variantTotalAvailable(variant: Pick<AdminGoodVariant, 'stocks'>) {
  return variant.stocks.reduce((sum, stock) => sum + variantAvailable(stock), 0);
}

export function effectiveVariantLocationId(variant: Pick<AdminGoodVariant, 'locationId'>, defaultLocationId: string) {
  return variant.locationId ?? defaultLocationId;
}

/** 「색상: 빨강 / 사이즈: S」. 옵션 순서는 상품의 position 을 따른다. 기본 품목은 빈 문자열. */
export function variantOptionSummary(
  values: Record<string, string>,
  masters: readonly AdminOptionMaster[],
  options: readonly AdminGoodOption[],
) {
  return [...options]
    .sort((a, b) => a.position - b.position)
    .map((option) => {
      const master = masters.find((entry) => entry.id === option.optionId);
      const valueId = values[option.optionId];
      const value = master?.values.find((entry) => entry.id === valueId);
      if (!master || !value) return null;
      return `${master.name}: ${value.value}`;
    })
    .filter((part): part is string => part !== null)
    .join(' / ');
}

/** 옵션값 id 를 position 순으로 '|' 연결 — RPC 의 option_signature 와 같은 규칙. */
export function variantSignature(values: Record<string, string>, options: readonly AdminGoodOption[]) {
  return [...options]
    .sort((a, b) => a.position - b.position)
    .map((option) => values[option.optionId] ?? '')
    .join('|');
}

/** 옵션별로 고른 값들의 조합(카테시안 곱). 옵션 순서 = 배열 순서. 값이 하나도 없는 옵션이 있으면 빈 배열. */
export function generateVariantCombinations(
  choices: readonly { optionId: string; valueIds: readonly string[] }[],
): Record<string, string>[] {
  if (choices.length === 0 || choices.some((choice) => choice.valueIds.length === 0)) return [];
  let combinations: Record<string, string>[] = [{}];
  for (const choice of choices) {
    combinations = combinations.flatMap((partial) => (
      choice.valueIds.map((valueId) => ({ ...partial, [choice.optionId]: valueId }))
    ));
  }
  return combinations;
}

/* ------------------------------------------------------------------------- */
/* 재고 관리 목록 URL 계약                                                     */
/* ------------------------------------------------------------------------- */

export const ADMIN_INVENTORY_PATH = '/admin/catalog/inventory';
export const ADMIN_INVENTORY_PAGE_SIZES = [50, 100, 200] as const;
export const ADMIN_INVENTORY_DEFAULT_PAGE_SIZE = 50;

export interface AdminInventoryFilters {
  query: string;
  location: string;
  ip: string;
  /** 안전재고 이하만. */
  low: boolean;
  /** 보관된 품목·상품 포함. */
  archived: boolean;
  page: number;
  size: number;
}

type SearchParamValue = string | string[] | undefined;

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value.trim() : '';
}

function flag(value: SearchParamValue) {
  const raw = singleParam(value);
  return raw === '1' || raw === 'true' || raw === 'on';
}

export function normalizeAdminInventoryFilters(query: AdminCatalogSearchQuery): AdminInventoryFilters {
  const page = Number.parseInt(singleParam(query.page), 10);
  const size = Number.parseInt(singleParam(query.size), 10);
  const location = singleParam(query.location);
  const ip = singleParam(query.ip);
  return {
    query: singleParam(query.query).slice(0, 100),
    location: LOCATION_ID_PATTERN.test(location) ? location : '',
    ip: /^[A-Za-z0-9_-]{1,64}$/.test(ip) ? ip : '',
    low: flag(query.low),
    archived: flag(query.archived),
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    size: (ADMIN_INVENTORY_PAGE_SIZES as readonly number[]).includes(size) ? size : ADMIN_INVENTORY_DEFAULT_PAGE_SIZE,
  };
}

export function adminInventoryHref(filters: AdminInventoryFilters, patch: Partial<AdminInventoryFilters> = {}) {
  const next = { ...filters, ...patch };
  const search = new URLSearchParams();
  if (next.query) search.set('query', next.query);
  if (next.location) search.set('location', next.location);
  if (next.ip) search.set('ip', next.ip);
  if (next.low) search.set('low', '1');
  if (next.archived) search.set('archived', '1');
  if (next.page > 1) search.set('page', String(next.page));
  if (next.size !== ADMIN_INVENTORY_DEFAULT_PAGE_SIZE) search.set('size', String(next.size));
  const query = search.toString();
  return query ? `${ADMIN_INVENTORY_PATH}?${query}` : ADMIN_INVENTORY_PATH;
}

/* ------------------------------------------------------------------------- */
/* 폼 정규화                                                                   */
/* ------------------------------------------------------------------------- */

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readInteger(raw: string) {
  if (!/^-?\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && Math.abs(value) <= INT32_MAX ? value : null;
}

export interface AdminVariantStockAdjustmentValue {
  goodId: string;
  movementId: string;
  variantId: string;
  locationId: string;
  expectedOnHand: number;
  delta: number;
  reasonCode: AdminStockReasonCode;
  note: string | null;
}

export function normalizeVariantStockAdjustmentForm(formData: FormData): AdminFormResult<AdminVariantStockAdjustmentValue> {
  const errors: AdminFieldErrors = {};
  const movementId = readString(formData, 'movementId').toLowerCase();
  const variantId = readString(formData, 'variantId').toLowerCase();
  const locationId = readString(formData, 'locationId');
  const goodId = readString(formData, 'goodId');
  const expectedOnHand = readInteger(readString(formData, 'expectedOnHand'));
  const delta = readInteger(readString(formData, 'delta'));
  const reasonCode = readString(formData, 'reasonCode');
  const note = readString(formData, 'note').slice(0, 200);

  if (!isUuid(movementId)) errors.form = '유효한 조정 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (!isUuid(variantId)) errors.form = '품목을 찾을 수 없습니다.';
  if (!LOCATION_ID_PATTERN.test(locationId)) errors.locationId = '출고지를 선택해주세요.';
  if (expectedOnHand === null || expectedOnHand < 0) errors.form = '현재 보유 수량을 확인해주세요.';
  if (delta === null || delta === 0) errors.delta = '조정 수량은 0이 아닌 정수여야 합니다.';
  if (!STOCK_MOVEMENT_REASONS.some((reason) => reason.value === reasonCode)) errors.reasonCode = '조정 사유를 선택해주세요.';
  if (reasonCode === 'correction' && !note) errors.note = '보정은 사유를 적어야 합니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId,
      movementId,
      variantId,
      locationId,
      expectedOnHand: expectedOnHand as number,
      delta: delta as number,
      reasonCode: reasonCode as AdminStockReasonCode,
      note: note || null,
    },
  };
}

export interface AdminVariantTransferValue {
  goodId: string;
  movementId: string;
  fromVariantId: string;
  fromLocationId: string;
  toVariantId: string;
  toLocationId: string;
  qty: number;
  note: string | null;
}

export function normalizeVariantTransferForm(formData: FormData): AdminFormResult<AdminVariantTransferValue> {
  const errors: AdminFieldErrors = {};
  const movementId = readString(formData, 'movementId').toLowerCase();
  const fromVariantId = readString(formData, 'fromVariantId').toLowerCase();
  const toVariantId = readString(formData, 'toVariantId').toLowerCase();
  const fromLocationId = readString(formData, 'fromLocationId');
  const toLocationId = readString(formData, 'toLocationId');
  const qty = readInteger(readString(formData, 'qty'));
  const note = readString(formData, 'note').slice(0, 200);

  if (!isUuid(movementId)) errors.form = '유효한 이동 요청이 아닙니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  if (!isUuid(fromVariantId) || !isUuid(toVariantId)) errors.toVariantId = '이동할 품목을 선택해주세요.';
  if (!LOCATION_ID_PATTERN.test(fromLocationId) || !LOCATION_ID_PATTERN.test(toLocationId)) errors.toLocationId = '출고지를 선택해주세요.';
  if (fromVariantId === toVariantId && fromLocationId === toLocationId) errors.toLocationId = '같은 자리로는 옮길 수 없습니다.';
  if (qty === null || qty <= 0) errors.qty = '이동 수량은 1 이상의 정수여야 합니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      goodId: readString(formData, 'goodId'),
      movementId,
      fromVariantId,
      fromLocationId,
      toVariantId,
      toLocationId,
      qty: qty as number,
      note: note || null,
    },
  };
}

export interface AdminVariantSafetyValue {
  goodId: string;
  variantId: string;
  locationId: string;
  safetyQty: number;
}

export function normalizeVariantSafetyForm(formData: FormData): AdminFormResult<AdminVariantSafetyValue> {
  const variantId = readString(formData, 'variantId').toLowerCase();
  const locationId = readString(formData, 'locationId');
  const safetyQty = readInteger(readString(formData, 'safetyQty'));
  if (!isUuid(variantId) || !LOCATION_ID_PATTERN.test(locationId)) {
    return { ok: false, errors: { form: '품목과 출고지를 확인해주세요.' } };
  }
  if (safetyQty === null || safetyQty < 0) {
    return { ok: false, errors: { safetyQty: '안전재고는 0 이상의 정수여야 합니다.' } };
  }
  return { ok: true, value: { goodId: readString(formData, 'goodId'), variantId, locationId, safetyQty } };
}

export interface AdminStockLocationFormValue {
  id: string;
  name: string;
  contact: string | null;
  erpWarehouseCode: string | null;
  defaultCarrierCode: string | null;
  isDefault: boolean;
  active: boolean;
  sortOrder: number;
}

export function normalizeStockLocationForm(formData: FormData): AdminFormResult<AdminStockLocationFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readString(formData, 'id').toLowerCase();
  const name = readString(formData, 'name');
  const sortOrder = readInteger(readString(formData, 'sortOrder') || '0');
  if (!LOCATION_ID_PATTERN.test(id)) errors.id = '코드는 영문 소문자·숫자·하이픈 40자 이내여야 합니다.';
  if (!name || name.length > 60) errors.name = '이름은 1~60자여야 합니다.';
  if (sortOrder === null) errors.sortOrder = '정렬 순서는 정수여야 합니다.';
  const isDefault = formData.get('isDefault') === 'on';
  const active = formData.get('active') === 'on';
  if (isDefault && !active) errors.active = '기본 출고지는 사용 중이어야 합니다.';
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      id,
      name,
      contact: readString(formData, 'contact').slice(0, 100) || null,
      erpWarehouseCode: readString(formData, 'erpWarehouseCode').slice(0, 40) || null,
      defaultCarrierCode: readString(formData, 'defaultCarrierCode') || null,
      isDefault,
      active,
      sortOrder: sortOrder as number,
    },
  };
}

export interface AdminOptionMasterFormValue {
  id: string | null;
  name: string;
  displayStyle: string;
  sortOrder: number;
  archived: boolean;
  values: { id?: string; value: string; sortOrder?: number; archived?: boolean }[];
}

/**
 * 옵션 마스터 폼. 기존 값은 `value:<id>`(텍스트)·`archive:<id>`(체크) 로, 새 값은 `newValues`(줄마다 하나) 로 온다.
 */
export function normalizeOptionMasterForm(formData: FormData): AdminFormResult<AdminOptionMasterFormValue> {
  const errors: AdminFieldErrors = {};
  const rawId = readString(formData, 'id').toLowerCase();
  const id = rawId ? (isUuid(rawId) ? rawId : null) : null;
  if (rawId && !id) errors.form = '옵션을 찾을 수 없습니다.';
  const name = readString(formData, 'name');
  if (!name || name.length > 40) errors.name = '옵션 이름은 1~40자여야 합니다.';
  const displayStyle = readString(formData, 'displayStyle') || 'select';
  if (!OPTION_DISPLAY_STYLES.some((style) => style.value === displayStyle)) errors.displayStyle = '표시 방식을 선택해주세요.';
  const sortOrder = readInteger(readString(formData, 'sortOrder') || '0');
  if (sortOrder === null) errors.sortOrder = '정렬 순서는 정수여야 합니다.';

  const values: AdminOptionMasterFormValue['values'] = [];
  const seen = new Set<string>();
  for (const [key, raw] of formData.entries()) {
    if (!key.startsWith('value:') || typeof raw !== 'string') continue;
    const valueId = key.slice('value:'.length).toLowerCase();
    if (!isUuid(valueId)) continue;
    const text = raw.trim();
    if (!text || text.length > 40) {
      errors.form = '옵션값은 1~40자여야 합니다.';
      continue;
    }
    seen.add(text);
    values.push({ id: valueId, value: text, archived: formData.get(`archive:${valueId}`) === 'on' });
  }
  const newValues = readString(formData, 'newValues')
    .split(/\r?\n|,/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  newValues.forEach((text, index) => {
    if (text.length > 40) {
      errors.newValues = '옵션값은 40자 이내여야 합니다.';
      return;
    }
    if (seen.has(text)) return;
    seen.add(text);
    values.push({ value: text, sortOrder: values.length + index + 1 });
  });
  if (values.length > 100) errors.newValues = '옵션값은 100개까지입니다.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: { id, name, displayStyle, sortOrder: sortOrder as number, archived: formData.get('archived') === 'on', values },
  };
}

/* ------------------------------------------------------------------------- */
/* 품목 일괄 저장 payload (클라이언트가 JSON 으로 만들어 hidden 으로 보낸다)      */
/* ------------------------------------------------------------------------- */

export interface AdminVariantInitialStockInput {
  locationId: string;
  onHandQty: number;
  safetyQty?: number;
}

export interface AdminVariantBatchEntry {
  id?: string;
  customCode?: string | null;
  values?: Record<string, string>;
  additionalPrice?: number;
  display?: boolean;
  sellable?: boolean;
  locationId?: string | null;
  archived?: boolean;
  initialStocks?: AdminVariantInitialStockInput[];
}

export interface AdminVariantBatchPayload {
  options: AdminGoodOption[];
  variants: AdminVariantBatchEntry[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalInteger(value: unknown, field: string, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${field} 값이 올바르지 않습니다.`);
  }
  return value;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') throw new Error('불리언 값이 올바르지 않습니다.');
  return value;
}

/** JSON 문자열 → payload. 모양·한도만 본다(존재 검사·중복은 RPC 가 한다). */
export function parseVariantBatchPayload(raw: string): { ok: true; value: AdminVariantBatchPayload } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: '품목 정보를 읽지 못했습니다. 화면을 새로고침한 뒤 다시 시도해주세요.' };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.options) || !Array.isArray(parsed.variants)) {
    return { ok: false, error: '품목 정보의 형식이 올바르지 않습니다.' };
  }
  try {
    if (parsed.options.length > VARIANT_OPTION_LIMIT) throw new Error(`옵션은 ${VARIANT_OPTION_LIMIT}개까지입니다.`);
    if (parsed.variants.length > VARIANT_LIMIT) throw new Error(`품목은 ${VARIANT_LIMIT}개까지입니다.`);
    const options: AdminGoodOption[] = parsed.options.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.optionId !== 'string' || !isUuid(entry.optionId)) throw new Error('옵션 정보가 올바르지 않습니다.');
      const position = optionalInteger(entry.position, '옵션 순서', 1, VARIANT_OPTION_LIMIT) ?? index + 1;
      return { optionId: entry.optionId.toLowerCase(), position };
    });
    const variants: AdminVariantBatchEntry[] = parsed.variants.map((entry) => {
      if (!isRecord(entry)) throw new Error('품목 정보가 올바르지 않습니다.');
      const id = typeof entry.id === 'string' && entry.id ? entry.id.toLowerCase() : undefined;
      if (id !== undefined && !isUuid(id)) throw new Error('품목 id 가 올바르지 않습니다.');
      let values: Record<string, string> | undefined;
      if (entry.values !== undefined) {
        if (!isRecord(entry.values)) throw new Error('옵션값 정보가 올바르지 않습니다.');
        values = {};
        for (const [optionId, valueId] of Object.entries(entry.values)) {
          if (!isUuid(optionId) || typeof valueId !== 'string' || !isUuid(valueId)) throw new Error('옵션값 정보가 올바르지 않습니다.');
          values[optionId.toLowerCase()] = valueId.toLowerCase();
        }
      }
      const customCode = typeof entry.customCode === 'string' ? entry.customCode.trim().slice(0, 60) : null;
      const locationId = typeof entry.locationId === 'string' && entry.locationId ? entry.locationId : null;
      if (locationId && !LOCATION_ID_PATTERN.test(locationId)) throw new Error('출고지 코드가 올바르지 않습니다.');
      let initialStocks: AdminVariantInitialStockInput[] | undefined;
      if (entry.initialStocks !== undefined) {
        if (!Array.isArray(entry.initialStocks)) throw new Error('초기 재고 정보가 올바르지 않습니다.');
        initialStocks = entry.initialStocks.map((stock) => {
          if (!isRecord(stock) || typeof stock.locationId !== 'string' || !LOCATION_ID_PATTERN.test(stock.locationId)) {
            throw new Error('초기 재고의 출고지가 올바르지 않습니다.');
          }
          return {
            locationId: stock.locationId,
            onHandQty: optionalInteger(stock.onHandQty, '초기 재고', 0, INT32_MAX) ?? 0,
            safetyQty: optionalInteger(stock.safetyQty, '안전재고', 0, INT32_MAX),
          };
        });
      }
      return {
        id,
        customCode: customCode || null,
        values,
        additionalPrice: optionalInteger(entry.additionalPrice, '추가 금액', -100000000, 100000000),
        display: optionalBoolean(entry.display),
        sellable: optionalBoolean(entry.sellable),
        locationId,
        archived: optionalBoolean(entry.archived),
        initialStocks,
      };
    });
    return { ok: true, value: { options, variants } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : '품목 정보가 올바르지 않습니다.' };
  }
}

/** payload → `admin_upsert_variants` 인자. */
export function toVariantBatchRpcArgs(goodId: string, batchId: string, payload: AdminVariantBatchPayload) {
  return {
    target_good_id: goodId,
    target_batch_id: batchId,
    target_options: payload.options.map((option) => ({ option_id: option.optionId, position: option.position })),
    target_variants: payload.variants.map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      custom_code: entry.customCode ?? null,
      ...(entry.values ? { values: entry.values } : {}),
      ...(entry.additionalPrice !== undefined ? { additional_price: entry.additionalPrice } : {}),
      ...(entry.display !== undefined ? { display: entry.display } : {}),
      ...(entry.sellable !== undefined ? { sellable: entry.sellable } : {}),
      location_id: entry.locationId ?? null,
      ...(entry.archived !== undefined ? { archived: entry.archived } : {}),
      ...(entry.initialStocks
        ? {
          initial_stocks: entry.initialStocks.map((stock) => ({
            location_id: stock.locationId,
            on_hand_qty: stock.onHandQty,
            ...(stock.safetyQty !== undefined ? { safety_qty: stock.safetyQty } : {}),
          })),
        }
        : {}),
    })),
  };
}

/* ------------------------------------------------------------------------- */
/* 절대값 일괄(붙여넣기) — "참조, 출고지, 보유수량[, 안전재고]" 한 줄에 하나        */
/* ------------------------------------------------------------------------- */

export interface AdminBulkStockRow {
  ref: string;
  locationId?: string;
  onHandQty: number;
  safetyQty?: number;
}

export function parseBulkStockRows(text: string): { rows: AdminBulkStockRow[]; errors: { line: number; message: string }[] } {
  const rows: AdminBulkStockRow[] = [];
  const errors: { line: number; message: string }[] = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const cells = line.split(/\t|,/).map((cell) => cell.trim());
    if (cells.length < 2) {
      errors.push({ line: index + 1, message: '참조와 보유 수량이 필요합니다.' });
      return;
    }
    const [ref, second, third, fourth] = cells;
    /* 출고지를 생략한 2열 형식(참조, 수량)도 받는다. */
    const hasLocation = cells.length >= 3 && LOCATION_ID_PATTERN.test(second) && readInteger(second) === null;
    const onHandRaw = hasLocation ? third : second;
    const safetyRaw = hasLocation ? fourth : third;
    const onHandQty = readInteger(onHandRaw ?? '');
    if (!ref) {
      errors.push({ line: index + 1, message: '참조(품목코드·자체코드·상품 ID)가 비었습니다.' });
      return;
    }
    if (onHandQty === null || onHandQty < 0) {
      errors.push({ line: index + 1, message: '보유 수량은 0 이상의 정수여야 합니다.' });
      return;
    }
    const safetyQty = safetyRaw ? readInteger(safetyRaw) : undefined;
    if (safetyRaw && (safetyQty === null || (safetyQty as number) < 0)) {
      errors.push({ line: index + 1, message: '안전재고는 0 이상의 정수여야 합니다.' });
      return;
    }
    rows.push({
      ref,
      ...(hasLocation ? { locationId: second } : {}),
      onHandQty,
      ...(safetyQty !== undefined && safetyQty !== null ? { safetyQty } : {}),
    });
  });
  if (rows.length > 2000) errors.push({ line: 0, message: '한 번에 2,000행까지 올릴 수 있습니다.' });
  return { rows, errors };
}

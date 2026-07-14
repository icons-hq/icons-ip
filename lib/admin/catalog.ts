import type { Stock } from '@/lib/data';
import type { RarityKey } from '@/lib/rarity';

export type AdminFieldErrors = Record<string, string>;

export interface AdminCatalogContext {
  eventIds: ReadonlySet<string>;
  ipIds: ReadonlySet<string>;
  verticalKeys: ReadonlySet<string>;
}

export interface AdminIpFormValue {
  id: string;
  title: string;
  sub: string | null;
  verticalKey: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  imagePath: string | null;
  featured: boolean;
}

export interface AdminGoodFormValue {
  id: string;
  ipId: string;
  name: string;
  type: string;
  price: number;
  badge: string | null;
  stock: Stock;
  bg: string | null;
  imagePath: string | null;
}

export interface AdminStockAdjustmentFormValue {
  adjustmentId: string;
  goodId: string;
  expectedStockQty: number;
  delta: number;
  reason: string;
}

export interface AdminCardFormValue {
  id: string;
  ipId: string;
  name: string;
  no: string | null;
  rarity: RarityKey;
  bg: string | null;
  imagePath: string | null;
}

export interface AdminEventFormValue {
  id: string;
  ipId: string | null;
  title: string;
  mode: string;
  status: string;
  startsAt: string | null;
  endsAt: string | null;
  location: string | null;
  accent: string | null;
  bg: string | null;
  imagePath: string | null;
}

export interface AdminTicketTypeFormValue {
  operationId: string;
  id: string;
  eventId: string;
  name: string;
  price: number;
  capacity: number;
}

export type AdminFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: AdminFieldErrors };

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INTEGER_PATTERN = /^-?\d+$/;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const STOCK_VALUES = new Set<Stock>(['low', 'ok', 'soldout']);
const RARITY_VALUES = new Set<RarityKey>(['N', 'R', 'SR', 'SSR', 'HOLO']);
const EVENT_MODES = new Set(['온라인', '오프라인']);
const EVENT_STATUSES = new Set(['예매중', '예정', '진행중', '종료']);
const ADMIN_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ADMIN_DATE_TIME_ERROR = '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(formData: FormData, key: string) {
  return readString(formData, key) || null;
}

function readSlug(formData: FormData, key: string, errors: AdminFieldErrors, requiredMessage: string) {
  const value = readString(formData, key);
  if (!value) {
    errors[key] = requiredMessage;
    return value;
  }
  if (!SLUG_PATTERN.test(value)) {
    errors[key] = 'ID는 소문자 영어, 숫자, 하이픈만 사용할 수 있습니다.';
  }
  return value;
}

function readUuid(formData: FormData, key: string, errors: AdminFieldErrors, message: string) {
  const value = readString(formData, key).toLowerCase();
  if (!UUID_PATTERN.test(value)) errors[key] = message;
  return value;
}

function nonNegativeInteger(
  formData: FormData,
  key: string,
  errors: AdminFieldErrors,
  message: string,
  defaultValue?: number,
) {
  const raw = readString(formData, key);
  if (!raw && defaultValue !== undefined) return defaultValue;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > INT32_MAX) {
    errors[key] = message;
    return 0;
  }
  return value;
}

function localKstDateTimeToIso(formData: FormData, key: string, errors: AdminFieldErrors) {
  const raw = readString(formData, key);
  if (!raw) return null;

  const match = ADMIN_DATE_TIME_PATTERN.exec(raw);
  if (!match) {
    errors[key] = ADMIN_DATE_TIME_ERROR;
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  if (
    month < 1
    || month > 12
    || day < 1
    || day > lastDayOfMonth
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59
  ) {
    errors[key] = ADMIN_DATE_TIME_ERROR;
    return null;
  }

  return new Date(Date.UTC(year, month - 1, day, hour - 9, minute)).toISOString();
}

function validIpId(value: string, context: AdminCatalogContext, errors: AdminFieldErrors) {
  if (!value || !context.ipIds.has(value)) {
    errors.ipId = '등록된 IP를 선택해주세요.';
  }
  return value;
}

export function catalogContextFromSnapshot(snapshot: {
  events: { id: string }[];
  ips: { id: string }[];
  verticals: { key: string }[];
}): AdminCatalogContext {
  return {
    eventIds: new Set(snapshot.events.map((event) => event.id)),
    ipIds: new Set(snapshot.ips.map((ip) => ip.id)),
    verticalKeys: new Set(snapshot.verticals.map((vertical) => vertical.key)),
  };
}

export function normalizeAdminIpForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminIpFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
  const title = readString(formData, 'title');
  const verticalKey = readString(formData, 'verticalKey');

  if (!title) errors.title = 'IP 이름을 입력해주세요.';
  if (!verticalKey || !context.verticalKeys.has(verticalKey)) {
    errors.verticalKey = '등록된 버티컬을 선택해주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      title,
      sub: nullableString(formData, 'sub'),
      verticalKey,
      tagline: nullableString(formData, 'tagline'),
      synopsis: nullableString(formData, 'synopsis'),
      glyph: nullableString(formData, 'glyph'),
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
      featured: formData.get('featured') === 'on',
    },
  };
}

export function normalizeAdminGoodForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminGoodFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
  const ipId = validIpId(readString(formData, 'ipId'), context, errors);
  const name = readString(formData, 'name');
  const type = readString(formData, 'type');
  const stock = readString(formData, 'stock') as Stock;
  const price = nonNegativeInteger(formData, 'price', errors, '가격은 0 이상의 정수여야 합니다.');

  if (!name) errors.name = '굿즈 이름을 입력해주세요.';
  if (!type) errors.type = '굿즈 유형을 입력해주세요.';
  if (!STOCK_VALUES.has(stock)) errors.stock = '재고 상태를 선택해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      ipId,
      name,
      type,
      price,
      badge: nullableString(formData, 'badge'),
      stock,
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
    },
  };
}

export function normalizeAdminStockAdjustmentForm(
  formData: FormData,
): AdminFormResult<AdminStockAdjustmentFormValue> {
  const errors: AdminFieldErrors = {};
  const adjustmentId = readString(formData, 'adjustmentId').toLowerCase();
  const goodId = readSlug(formData, 'goodId', errors, '굿즈를 선택해주세요.');
  const expectedStockQtyRaw = readString(formData, 'expectedStockQty');
  const deltaRaw = readString(formData, 'delta');
  const reason = readString(formData, 'reason');

  if (!UUID_PATTERN.test(adjustmentId)) {
    errors.adjustmentId = '유효한 재고 조정 요청이 아닙니다.';
  }

  const expectedStockQty = Number(expectedStockQtyRaw);
  if (
    !/^\d+$/.test(expectedStockQtyRaw)
    || !Number.isInteger(expectedStockQty)
    || expectedStockQty > INT32_MAX
  ) {
    errors.expectedStockQty = '현재 실재고를 확인해주세요.';
  }

  const delta = Number(deltaRaw);
  if (!INTEGER_PATTERN.test(deltaRaw) || !Number.isInteger(delta) || delta === 0) {
    errors.delta = '조정 수량은 0이 아닌 정수여야 합니다.';
  } else if (delta < INT32_MIN || delta > INT32_MAX) {
    errors.delta = '조정 수량은 32비트 정수 범위여야 합니다.';
  }

  if (!reason) {
    errors.reason = '조정 사유를 입력해주세요.';
  } else if (reason.length > 200) {
    errors.reason = '조정 사유는 200자 이하로 입력해주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      adjustmentId,
      goodId,
      expectedStockQty,
      delta,
      reason,
    },
  };
}

export function normalizeAdminCardForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminCardFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
  const ipId = validIpId(readString(formData, 'ipId'), context, errors);
  const name = readString(formData, 'name');
  const rarity = readString(formData, 'rarity') as RarityKey;

  if (!name) errors.name = '카드 이름을 입력해주세요.';
  if (!RARITY_VALUES.has(rarity)) errors.rarity = '등급을 선택해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      ipId,
      name,
      no: nullableString(formData, 'no'),
      rarity,
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
    },
  };
}

export function normalizeAdminEventForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminEventFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
  const rawIpId = readString(formData, 'ipId');
  const title = readString(formData, 'title');
  const mode = readString(formData, 'mode');
  const status = readString(formData, 'status');
  const startsAt = localKstDateTimeToIso(formData, 'startsAt', errors);
  const endsAt = localKstDateTimeToIso(formData, 'endsAt', errors);

  if (rawIpId && !context.ipIds.has(rawIpId)) errors.ipId = '등록된 IP를 선택해주세요.';
  if (!title) errors.title = '이벤트 이름을 입력해주세요.';
  if (!EVENT_MODES.has(mode)) errors.mode = '이벤트 모드를 선택해주세요.';
  if (!EVENT_STATUSES.has(status)) errors.status = '이벤트 상태를 선택해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      ipId: rawIpId || null,
      title,
      mode,
      status,
      startsAt,
      endsAt,
      location: nullableString(formData, 'location'),
      accent: nullableString(formData, 'accent'),
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
    },
  };
}

export function normalizeAdminTicketTypeForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminTicketTypeFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const id = readUuid(formData, 'id', errors, '유효한 티켓 회차가 아닙니다.');
  const eventId = readString(formData, 'eventId');
  const name = readString(formData, 'name');
  const price = nonNegativeInteger(formData, 'price', errors, '가격은 0 이상의 정수여야 합니다.');
  const capacity = nonNegativeInteger(formData, 'capacity', errors, '정원은 0 이상의 정수여야 합니다.');

  if (!eventId || !context.eventIds.has(eventId)) {
    errors.eventId = '등록된 이벤트를 선택해주세요.';
  }
  if (!name) errors.name = '회차명을 입력해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operationId,
      id,
      eventId,
      name,
      price,
      capacity,
    },
  };
}

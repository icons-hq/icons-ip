import type { Stock } from '@/lib/data';
import type { RarityKey } from '@/lib/rarity';

export type AdminFieldErrors = Record<string, string>;

export interface AdminCatalogContext {
  eventIds: ReadonlySet<string>;
  goodIpById: ReadonlyMap<string, string>;
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
  poolId: string | null;
  bg: string | null;
  imagePath: string | null;
}

export interface AdminCardPoolFormValue {
  operationId: string;
  id: string;
  ipId: string;
  name: string;
  activeFrom: string;
  activeTo: string | null;
}

export interface AdminPoolOddsFormValue {
  operationId: string;
  poolId: string;
  odds: Record<RarityKey, number>;
}

export interface AdminRewardPolicyFormValue {
  operationId: string;
  id: string;
  poolId: string;
  trigger: 'order_paid';
  targetIpId: string;
  targetGoodId: string | null;
  minAmount: number;
  ticketsPerGrant: number;
  active: boolean;
  activeFrom: string;
  activeTo: string | null;
}

export interface AdminGameFormValue {
  operationId: string;
  previousGameId: string | null;
  id: string;
  title: string;
  rewardPoolId: string;
  eventId: string | null;
  perUserDailyLimit: number;
  activeFrom: string;
  activeTo: string | null;
}

export interface AdminGameEndFormValue {
  operationId: string;
  gameId: string;
}

export interface AdminGameContext {
  pools: ReadonlyMap<string, {
    ipId: string;
    activeFrom: string;
    activeTo: string | null;
    rewardReady: boolean;
    status: 'scheduled' | 'active' | 'ended';
  }>;
  events: ReadonlyMap<string, { ipId: string | null; mode: string }>;
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

function readNullableUuid(formData: FormData, key: string, errors: AdminFieldErrors, message: string) {
  const value = readString(formData, key).toLowerCase();
  if (!value) return null;
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
  goods: { id: string; ip: string }[];
  ips: { id: string }[];
  verticals: { key: string }[];
}): AdminCatalogContext {
  return {
    eventIds: new Set(snapshot.events.map((event) => event.id)),
    goodIpById: new Map(snapshot.goods.map((good) => [good.id, good.ip])),
    ipIds: new Set(snapshot.ips.map((ip) => ip.id)),
    verticalKeys: new Set(snapshot.verticals.map((vertical) => vertical.key)),
  };
}

export function gameContextFromRecords(records: {
  cardPools: Array<{
    id: string;
    ipId: string;
    activeFrom: string;
    activeTo: string | null;
    rewardReady: boolean;
    status: 'scheduled' | 'active' | 'ended';
  }>;
  events: Array<{ id: string; ipId: string | null; mode: string }>;
}): AdminGameContext {
  return {
    pools: new Map(records.cardPools.map((pool) => [pool.id, {
      ipId: pool.ipId,
      activeFrom: pool.activeFrom,
      activeTo: pool.activeTo,
      rewardReady: pool.rewardReady,
      status: pool.status,
    }])),
    events: new Map(records.events.map((event) => [event.id, {
      ipId: event.ipId,
      mode: event.mode,
    }])),
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
  const poolId = readNullableUuid(formData, 'poolId', errors, '유효한 카드풀을 선택해주세요.');

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
      poolId,
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
    },
  };
}

export function normalizeAdminCardPoolForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminCardPoolFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const id = readUuid(formData, 'id', errors, '유효한 카드풀이 아닙니다.');
  const ipId = validIpId(readString(formData, 'ipId'), context, errors);
  const name = readString(formData, 'name');
  const activeFromRaw = readString(formData, 'activeFrom');
  const activeFrom = localKstDateTimeToIso(formData, 'activeFrom', errors);
  const activeTo = localKstDateTimeToIso(formData, 'activeTo', errors);

  if (!name) errors.name = '카드풀 이름을 입력해주세요.';
  if (!activeFromRaw) errors.activeFrom = '운영 시작 일시를 입력해주세요.';
  if (activeFrom && activeTo && activeTo <= activeFrom) {
    errors.activeTo = '운영 종료는 시작보다 뒤여야 합니다.';
  }

  if (Object.keys(errors).length || !activeFrom) return { ok: false, errors };

  return {
    ok: true,
    value: { operationId, id, ipId, name, activeFrom, activeTo },
  };
}

const ODDS_FIELDS: Array<[RarityKey, string]> = [
  ['N', 'oddsN'],
  ['R', 'oddsR'],
  ['SR', 'oddsSr'],
  ['SSR', 'oddsSsr'],
  ['HOLO', 'oddsHolo'],
];
const PERCENT_PATTERN = /^(?:100(?:\.0{1,3})?|(?:\d|[1-9]\d)(?:\.\d{1,3})?)$/;

function probabilityFromPercent(
  formData: FormData,
  key: string,
  errors: AdminFieldErrors,
) {
  const raw = readString(formData, key);
  if (!PERCENT_PATTERN.test(raw)) {
    errors[key] = '확률은 0~100 사이, 소수 셋째 자리까지 입력해주세요.';
    return 0;
  }

  const [whole, fraction = ''] = raw.split('.');
  return Number(whole) * 1_000 + Number(fraction.padEnd(3, '0'));
}

export function normalizeAdminPoolOddsForm(
  formData: FormData,
): AdminFormResult<AdminPoolOddsFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const poolId = readUuid(formData, 'poolId', errors, '유효한 카드풀이 아닙니다.');
  const milliPercents = Object.fromEntries(
    ODDS_FIELDS.map(([rarity, key]) => [rarity, probabilityFromPercent(formData, key, errors)]),
  ) as Record<RarityKey, number>;

  if (!Object.keys(errors).some((key) => key.startsWith('odds'))) {
    const total = Object.values(milliPercents).reduce((sum, value) => sum + value, 0);
    if (total !== 100_000) errors.oddsTotal = '확률 합계는 100%여야 합니다.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operationId,
      poolId,
      odds: Object.fromEntries(
        ODDS_FIELDS.map(([rarity]) => [rarity, milliPercents[rarity] / 100_000]),
      ) as Record<RarityKey, number>,
    },
  };
}

export function normalizeAdminRewardPolicyForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminRewardPolicyFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const id = readUuid(formData, 'id', errors, '유효한 발급 정책이 아닙니다.');
  const poolId = readUuid(formData, 'poolId', errors, '유효한 카드풀이 아닙니다.');
  const trigger = readString(formData, 'trigger');
  const targetIpId = readString(formData, 'targetIpId');
  const targetGoodId = nullableString(formData, 'targetGoodId');
  const minAmountRaw = readString(formData, 'minAmount');
  const ticketsPerGrantRaw = readString(formData, 'ticketsPerGrant');
  const activeFromRaw = readString(formData, 'activeFrom');
  const activeFrom = localKstDateTimeToIso(formData, 'activeFrom', errors);
  const activeTo = localKstDateTimeToIso(formData, 'activeTo', errors);

  if (trigger !== 'order_paid') {
    errors.trigger = '지원하지 않는 발급 조건입니다.';
  }
  if (!targetIpId || !context.ipIds.has(targetIpId)) {
    errors.targetIpId = '등록된 IP를 선택해주세요.';
  }
  if (targetGoodId) {
    const goodIpId = context.goodIpById.get(targetGoodId);
    if (!goodIpId) {
      errors.targetGoodId = '등록된 굿즈를 선택해주세요.';
    } else if (goodIpId !== targetIpId) {
      errors.targetGoodId = '선택한 IP의 굿즈만 지정할 수 있습니다.';
    }
  }

  const minAmount = Number(minAmountRaw);
  if (!/^\d+$/.test(minAmountRaw) || !Number.isSafeInteger(minAmount)) {
    errors.minAmount = '최소 결제 금액은 0 이상의 정수여야 합니다.';
  }

  const ticketsPerGrant = Number(ticketsPerGrantRaw);
  if (
    !/^\d+$/.test(ticketsPerGrantRaw)
    || !Number.isInteger(ticketsPerGrant)
    || ticketsPerGrant < 1
    || ticketsPerGrant > 100
  ) {
    errors.ticketsPerGrant = '발급 수량은 1~100 사이의 정수여야 합니다.';
  }

  if (!activeFromRaw) errors.activeFrom = '운영 시작 일시를 입력해주세요.';
  if (activeFrom && activeTo && activeTo <= activeFrom) {
    errors.activeTo = '운영 종료는 시작보다 뒤여야 합니다.';
  }

  if (Object.keys(errors).length || !activeFrom) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operationId,
      id,
      poolId,
      trigger: 'order_paid',
      targetIpId,
      targetGoodId,
      minAmount,
      ticketsPerGrant,
      active: formData.get('active') === 'on',
      activeFrom,
      activeTo,
    },
  };
}

export function normalizeAdminGameForm(
  formData: FormData,
  context: AdminGameContext,
): AdminFormResult<AdminGameFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const previousGameId = nullableString(formData, 'previousGameId');
  const id = readSlug(formData, 'id', errors, '게임 ID를 입력해주세요.');
  const title = readString(formData, 'title');
  const rewardPoolId = readUuid(formData, 'rewardPoolId', errors, '유효한 카드풀을 선택해주세요.');
  const eventId = nullableString(formData, 'eventId');
  const perUserDailyLimitRaw = readString(formData, 'perUserDailyLimit');
  const activeFromRaw = readString(formData, 'activeFrom');
  const activeFrom = localKstDateTimeToIso(formData, 'activeFrom', errors);
  const activeTo = localKstDateTimeToIso(formData, 'activeTo', errors);
  const pool = context.pools.get(rewardPoolId);

  if (previousGameId && !SLUG_PATTERN.test(previousGameId)) {
    errors.previousGameId = '이전 게임 ID를 확인해주세요.';
  }
  if (!title) errors.title = '게임 제목을 입력해주세요.';

  if (!pool || !pool.rewardReady || pool.status === 'ended') {
    errors.rewardPoolId = '확률과 카드 구성이 완료된 운영 가능한 카드풀을 선택해주세요.';
  }

  if (eventId) {
    const event = context.events.get(eventId);
    if (!event || !pool || event.ipId !== pool.ipId || event.mode !== '온라인') {
      errors.eventId = '같은 IP의 온라인 이벤트만 선택할 수 있습니다.';
    }
  }

  const perUserDailyLimit = Number(perUserDailyLimitRaw);
  if (
    !/^\d+$/.test(perUserDailyLimitRaw)
    || !Number.isInteger(perUserDailyLimit)
    || perUserDailyLimit < 1
    || perUserDailyLimit > 100
  ) {
    errors.perUserDailyLimit = '일일 플레이 한도는 1~100 사이의 정수여야 합니다.';
  }

  if (!activeFromRaw) {
    errors.activeFrom = '운영 시작 일시를 명시적으로 선택해주세요.';
  }
  if (activeFrom && activeTo && activeTo <= activeFrom) {
    errors.activeTo = '운영 종료는 시작보다 뒤여야 합니다.';
  }

  if (pool && activeFrom && !errors.activeTo) {
    const coverageMessage = '게임 운영 기간은 카드풀 운영 기간 안에 있어야 합니다.';
    if (Date.parse(activeFrom) < Date.parse(pool.activeFrom)) {
      errors.activeFrom = coverageMessage;
    } else if (pool.activeTo && (!activeTo || Date.parse(activeTo) > Date.parse(pool.activeTo))) {
      errors.activeTo = coverageMessage;
    }
  }

  if (Object.keys(errors).length || !activeFrom) return { ok: false, errors };

  return {
    ok: true,
    value: {
      operationId,
      previousGameId,
      id,
      title,
      rewardPoolId,
      eventId,
      perUserDailyLimit,
      activeFrom,
      activeTo,
    },
  };
}

export function normalizeAdminGameEndForm(
  formData: FormData,
): AdminFormResult<AdminGameEndFormValue> {
  const errors: AdminFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 종료 요청이 아닙니다.');
  const gameId = readSlug(formData, 'gameId', errors, '게임을 선택해주세요.');

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { operationId, gameId } };
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

export type AdminCurationKind =
  | 'hero'
  | 'featured_ip'
  | 'announcement'
  | 'notice_strip'
  | 'editor_pick'
  | 'band_banner'
  | 'best_tab'
  | 'benefit';

export interface AdminCurationFormValue {
  operationId: string;
  id: string;
  kind: AdminCurationKind;
  ipId: string | null;
  title: string;
  imagePath: string | null;
  linkPath: string;
  displayOrder: number;
  activeFrom: string;
  activeTo: string | null;
  enabled: boolean;
  slot: string | null;
  payload: Record<string, unknown> | null;
}

export type AdminCurationFieldErrors = Partial<Record<
  | 'operationId'
  | 'id'
  | 'kind'
  | 'ipId'
  | 'title'
  | 'imagePath'
  | 'linkPath'
  | 'displayOrder'
  | 'activeFrom'
  | 'activeTo'
  | 'slot'
  | 'badge'
  | 'description'
  | 'subcopy'
  | 'subtitle'
  | 'goodIds'
  | 'mobileImagePath'
  | 'form',
  string
>>;

export type AdminCurationFormResult =
  | { ok: true; value: AdminCurationFormValue }
  | { ok: false; errors: AdminCurationFieldErrors };

export interface AdminCurationActionState {
  errors?: AdminCurationFieldErrors;
  message?: string;
}

const CURATION_KINDS = new Set<AdminCurationKind>([
  'hero',
  'featured_ip',
  'announcement',
  'notice_strip',
  'editor_pick',
  'band_banner',
  'best_tab',
  'benefit',
]);
/* 이미지 없이는 렌더할 수 없는 편성 — DB의 home_curations_image_required_check와 같은 목록이다. */
const IMAGE_REQUIRED_KINDS = new Set<AdminCurationKind>([
  'hero',
  'notice_strip',
  'editor_pick',
  'band_banner',
]);
/* slot은 오늘 두 BEST 탭 밴드만 구분한다 (home_curations_slot_check와 같은 규칙). */
const BEST_TAB_SLOTS = new Set(['category', 'popular']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURATION_IMAGE_PATTERN =
  /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const CURATION_IMAGE_ERROR = '검증된 큐레이션 이미지를 사용해주세요.';
const GOOD_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_TIME_ERROR = '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.';
const INT32_MAX = 2147483647;
const AMBIGUOUS_LINK_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

type PayloadTextField = 'badge' | 'description' | 'subcopy' | 'subtitle';

/*
 * payload 텍스트 칸은 전부 선택이다 — 비우면 키를 싣지 않고, 채우면 RPC가 받는
 * 길이(1~200자, 배지만 20자)를 폼 단계에서 먼저 잡는다.
 */
const PAYLOAD_TEXT_RULES: Record<
  PayloadTextField,
  { key: string; max: number; message: string }
> = {
  badge: { key: 'badge', max: 20, message: '배지 문구는 1자 이상 20자 이하로 입력해주세요.' },
  description: { key: 'description', max: 200, message: '설명은 1자 이상 200자 이하로 입력해주세요.' },
  subcopy: { key: 'subcopy', max: 200, message: '서브카피는 1자 이상 200자 이하로 입력해주세요.' },
  subtitle: { key: 'subtitle', max: 200, message: '히어로 부제는 1자 이상 200자 이하로 입력해주세요.' },
};

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function characterLength(value: string) {
  return Array.from(value).length;
}

function readUuid(
  formData: FormData,
  key: 'operationId' | 'id',
  errors: AdminCurationFieldErrors,
  message: string,
) {
  const value = readString(formData, key).toLowerCase();
  if (!UUID_PATTERN.test(value)) errors[key] = message;
  return value;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function kstDateTimeToIso(
  raw: string,
  key: 'activeFrom' | 'activeTo',
  errors: AdminCurationFieldErrors,
) {
  const match = DATE_TIME_PATTERN.exec(raw);
  if (!match) {
    errors[key] = DATE_TIME_ERROR;
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);

  if (
    year < 1
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)
    || hour > 23
    || minute > 59
  ) {
    errors[key] = DATE_TIME_ERROR;
    return null;
  }

  const instant = new Date(0);
  instant.setUTCFullYear(year, month - 1, day);
  instant.setUTCHours(hour - 9, minute, 0, 0);
  if (instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999) {
    errors[key] = DATE_TIME_ERROR;
    return null;
  }
  return instant.toISOString();
}

function isUnsafeInternalLink(value: string) {
  return (
    !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
    || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(value)
  );
}

function decodeInternalLink(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function readPayloadText(
  formData: FormData,
  field: PayloadTextField,
  errors: AdminCurationFieldErrors,
  payload: Record<string, unknown>,
) {
  const rule = PAYLOAD_TEXT_RULES[field];
  const value = readString(formData, field);
  if (!value) return;
  if (characterLength(value) > rule.max) {
    errors[field] = rule.message;
    return;
  }
  payload[rule.key] = value;
}

/*
 * 연결 상품은 쉼표 구분 한 칸으로 받는다. 상품 선택기를 붙이는 대신 최소 입력을
 * 유지하되, RPC가 거절할 형식·개수는 여기서 먼저 막아 저장 실패를 폼 에러로 바꾼다.
 */
function readGoodIds(
  formData: FormData,
  kind: 'band_banner' | 'best_tab',
  errors: AdminCurationFieldErrors,
  payload: Record<string, unknown>,
) {
  const limit = kind === 'best_tab' ? 12 : 4;
  const goodIds = readString(formData, 'goodIds')
    .split(',')
    .map((goodId) => goodId.trim())
    .filter(Boolean);

  if (goodIds.length === 0) {
    if (kind === 'best_tab') errors.goodIds = '상품 ID 를 1개 이상 등록해주세요.';
    return;
  }
  if (goodIds.some((goodId) => !GOOD_ID_PATTERN.test(goodId))) {
    errors.goodIds = '상품 ID 형식이 올바르지 않습니다.';
    return;
  }
  if (goodIds.length > limit) {
    errors.goodIds = `상품 ID 는 최대 ${limit}개까지 등록할 수 있습니다.`;
    return;
  }
  payload.good_ids = goodIds;
}

function readMobileImagePath(
  formData: FormData,
  errors: AdminCurationFieldErrors,
  payload: Record<string, unknown>,
) {
  const mobileImagePath = readString(formData, 'mobileImagePath');
  if (!mobileImagePath) return;
  if (!CURATION_IMAGE_PATTERN.test(mobileImagePath)) {
    errors.mobileImagePath = CURATION_IMAGE_ERROR;
    return;
  }
  payload.mobile_image_path = mobileImagePath;
}

function readCurationPayload(
  formData: FormData,
  kind: AdminCurationKind | null,
  errors: AdminCurationFieldErrors,
) {
  const payload: Record<string, unknown> = {};

  if (kind === 'hero') {
    readPayloadText(formData, 'subtitle', errors, payload);
    readMobileImagePath(formData, errors, payload);
  } else if (kind === 'editor_pick') {
    readPayloadText(formData, 'badge', errors, payload);
    readPayloadText(formData, 'description', errors, payload);
  } else if (kind === 'band_banner') {
    readPayloadText(formData, 'subcopy', errors, payload);
    readGoodIds(formData, 'band_banner', errors, payload);
  } else if (kind === 'best_tab') {
    readGoodIds(formData, 'best_tab', errors, payload);
  } else if (kind === 'benefit') {
    readPayloadText(formData, 'description', errors, payload);
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function readDateTime(
  formData: FormData,
  key: 'activeFrom' | 'activeTo',
  errors: AdminCurationFieldErrors,
  required: boolean,
) {
  const raw = readString(formData, key);
  if (!raw) {
    if (required) errors[key] = '노출 시작 일시를 선택해주세요.';
    return null;
  }
  return kstDateTimeToIso(raw, key, errors);
}

export function normalizeAdminCurationForm(formData: FormData): AdminCurationFormResult {
  const errors: AdminCurationFieldErrors = {};
  const operationId = readUuid(formData, 'operationId', errors, '유효한 저장 요청이 아닙니다.');
  const id = readUuid(formData, 'id', errors, '유효한 큐레이션 ID가 필요합니다.');
  const rawKind = readString(formData, 'kind');
  const kind = CURATION_KINDS.has(rawKind as AdminCurationKind)
    ? rawKind as AdminCurationKind
    : null;
  if (!kind) errors.kind = '큐레이션 유형을 선택해주세요.';

  const rawIpId = readString(formData, 'ipId');
  let ipId: string | null = rawIpId || null;
  if (kind === 'featured_ip') {
    if (!ipId) errors.ipId = '특집 IP를 선택해주세요.';
  } else if (kind && ipId) {
    errors.ipId = '특집 IP 유형에서만 IP를 선택할 수 있습니다.';
    ipId = null;
  }

  const title = readString(formData, 'title');
  if (characterLength(title) < 1 || characterLength(title) > 120) {
    errors.title = '제목은 1자 이상 120자 이하로 입력해주세요.';
  }

  const rawImagePath = readString(formData, 'imagePath');
  const imagePath = rawImagePath || null;
  if (kind && IMAGE_REQUIRED_KINDS.has(kind) && !imagePath) {
    errors.imagePath = kind === 'hero'
      ? '히어로 이미지를 업로드해주세요.'
      : '이미지를 등록해주세요.';
  } else if (imagePath && !CURATION_IMAGE_PATTERN.test(imagePath)) {
    errors.imagePath = CURATION_IMAGE_ERROR;
  }

  const rawSlot = readString(formData, 'slot');
  let slot: string | null = null;
  if (kind === 'best_tab') {
    if (BEST_TAB_SLOTS.has(rawSlot)) slot = rawSlot;
    else errors.slot = '탭 슬롯을 선택해주세요.';
  }

  const payload = readCurationPayload(formData, kind, errors);

  const rawLinkValue = formData.get('linkPath');
  const rawLinkPath = typeof rawLinkValue === 'string' ? rawLinkValue : '';
  const linkPath = rawLinkPath.trim();
  const decodedLinkPath = decodeInternalLink(linkPath);
  if (
    characterLength(linkPath) < 1
    || characterLength(linkPath) > 2048
    || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(rawLinkPath)
    || isUnsafeInternalLink(linkPath)
    || decodedLinkPath === null
    || isUnsafeInternalLink(decodedLinkPath)
  ) {
    errors.linkPath = '1~2048자의 안전한 내부 경로를 입력해주세요.';
  }

  const rawDisplayOrder = readString(formData, 'displayOrder');
  const displayOrder = Number(rawDisplayOrder);
  if (
    !/^\d+$/.test(rawDisplayOrder)
    || !Number.isInteger(displayOrder)
    || displayOrder < 0
    || displayOrder > INT32_MAX
  ) {
    errors.displayOrder = '노출 순서는 0 이상의 정수여야 합니다.';
  }

  const activeFrom = readDateTime(formData, 'activeFrom', errors, true);
  const activeTo = readDateTime(formData, 'activeTo', errors, false);
  if (activeFrom && activeTo && Date.parse(activeTo) <= Date.parse(activeFrom)) {
    errors.activeTo = '노출 종료는 시작보다 늦어야 합니다.';
  }

  if (Object.keys(errors).length > 0 || !kind || !activeFrom) return { ok: false, errors };
  return {
    ok: true,
    value: {
      operationId,
      id,
      kind,
      ipId,
      title,
      imagePath,
      linkPath,
      displayOrder,
      activeFrom,
      activeTo,
      enabled: formData.get('enabled') === 'on',
      slot,
      payload,
    },
  };
}

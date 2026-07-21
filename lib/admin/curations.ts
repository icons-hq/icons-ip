export type AdminCurationKind = 'hero' | 'featured_ip' | 'announcement';

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

const CURATION_KINDS = new Set<AdminCurationKind>(['hero', 'featured_ip', 'announcement']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURATION_IMAGE_PATTERN =
  /^public-media\/catalog\/curation\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png|webp)$/;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_TIME_ERROR = '일시는 YYYY-MM-DDTHH:mm 형식이어야 합니다.';
const INT32_MAX = 2147483647;
const AMBIGUOUS_LINK_CHARACTER_PATTERN =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/;

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
  if (kind === 'hero' && !imagePath) {
    errors.imagePath = '히어로 이미지를 업로드해주세요.';
  } else if (imagePath && !CURATION_IMAGE_PATTERN.test(imagePath)) {
    errors.imagePath = '검증된 큐레이션 이미지를 사용해주세요.';
  }

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
    },
  };
}

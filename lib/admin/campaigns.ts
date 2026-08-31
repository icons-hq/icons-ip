import type { AdminFieldErrors } from '@/lib/admin/catalog';

/*
 * 어드민 캠페인 콘솔의 폼 계약 (S8 #330).
 *
 * 검증의 진실원은 `admin_upsert_campaign`·`private.validate_campaign_sections`와
 * campaigns 테이블 체크다. 여기 있는 것은 운영자에게 필드 단위 피드백을 주기 위한
 * 1차 정규화뿐이고, 통과했다고 저장이 보장되지는 않는다.
 *
 * 공개 표면이 쓰는 캠페인 타입을 끌어오지 않고 어드민 전용으로 다시 정의한다 —
 * 운영 폼이 필요로 하는 모양(이미지 경로 문자열·JSON 원문)과 공개 렌더가 필요로
 * 하는 모양(해석된 블록)은 같지 않고, 한쪽을 다른 쪽에 맞추면 둘 다 무너진다.
 */

export const ADMIN_CAMPAIGN_KINDS = ['event', 'drop'] as const;
export type AdminCampaignKind = (typeof ADMIN_CAMPAIGN_KINDS)[number];

export const ADMIN_CAMPAIGN_STATUSES = ['draft', 'published', 'ended'] as const;
export type AdminCampaignStatus = (typeof ADMIN_CAMPAIGN_STATUSES)[number];

export const ADMIN_CAMPAIGN_KIND_LABELS: Record<AdminCampaignKind, string> = {
  event: '이벤트',
  drop: '드롭',
};

export const ADMIN_CAMPAIGN_STATUS_LABELS: Record<AdminCampaignStatus, string> = {
  draft: '작성 중 (비공개)',
  published: '진행 중 (공개)',
  ended: '종료',
};

export const ADMIN_COIN_OFFER_STATUSES = ['active', 'disabled'] as const;
export type AdminCoinOfferStatus = (typeof ADMIN_COIN_OFFER_STATUSES)[number];

export const ADMIN_COIN_OFFER_STATUS_LABELS: Record<AdminCoinOfferStatus, string> = {
  active: '노출',
  disabled: '내림',
};

export interface AdminCampaignRecord {
  /** RecordList 규약상 id — 캠페인 슬러그가 곧 운영 식별자이자 URL이다. */
  id: string;
  kind: AdminCampaignKind;
  title: string;
  subtitle: string | null;
  status: AdminCampaignStatus;
  startsAt: string;
  endsAt: string;
  heroImagePath: string | null;
  cardImagePath: string | null;
  bannerImagePath: string | null;
  featuredOrder: number | null;
  /** 상세 본문 블록. 원문 JSON을 그대로 들고 있다가 폼에 다시 그린다. */
  sections: unknown[];
  updatedAt: string;
}

export interface AdminCoinExchangeOfferRecord {
  id: string;
  poolId: string;
  label: string;
  coinCost: number;
  ticketCount: number;
  status: AdminCoinOfferStatus;
  updatedAt: string;
}

export interface AdminCampaignFormValue {
  previousId: string | null;
  id: string;
  kind: AdminCampaignKind;
  title: string;
  subtitle: string | null;
  status: AdminCampaignStatus;
  startsAt: string;
  endsAt: string;
  heroImagePath: string | null;
  cardImagePath: string | null;
  bannerImagePath: string | null;
  featuredOrder: number | null;
  sections: unknown[];
}

export interface AdminCoinExchangeOfferFormValue {
  id: string | null;
  poolId: string;
  label: string;
  coinCost: number;
  ticketCount: number;
  status: AdminCoinOfferStatus;
}

export type AdminCampaignFormResult =
  | { ok: true; value: AdminCampaignFormValue }
  | { ok: false; errors: AdminFieldErrors };

export type AdminCoinExchangeOfferFormResult =
  | { ok: true; value: AdminCoinExchangeOfferFormValue }
  | { ok: false; errors: AdminFieldErrors };

/* ── 본문 블록 스키마 ─────────────────────────────────────────────────────── */

export const ADMIN_CAMPAIGN_SECTION_TYPES = [
  'intro', 'image', 'text', 'attendance', 'exchange', 'coupon', 'goods', 'notice',
] as const;
export type AdminCampaignSectionType = (typeof ADMIN_CAMPAIGN_SECTION_TYPES)[number];

export const ADMIN_CAMPAIGN_MAX_SECTIONS = 20;

type SectionFieldKind = 'text' | 'uuid' | 'stringArray';

export interface AdminCampaignSectionField {
  key: string;
  kind: SectionFieldKind;
  required: boolean;
  /** 문자열 최대 길이. `stringArray`에서는 원소 하나의 최대 길이. */
  maxLength: number;
  minItems?: number;
  maxItems?: number;
}

export interface AdminCampaignSectionSpec {
  type: AdminCampaignSectionType;
  label: string;
  fields: AdminCampaignSectionField[];
}

/*
 * DB의 validate_campaign_sections와 같은 표를 TS 쪽에도 둔다. 사본이 하나 더
 * 생기는 비용을 감수하는 이유는, 운영자가 20블록짜리 JSON을 저장 버튼 왕복 없이
 * 고칠 수 있어야 하기 때문이다 — DB는 어느 블록의 어느 키인지 DETAIL로만 말한다.
 * 판정의 진실원은 여전히 DB다. 여기서 통과해도 DB가 거절할 수 있다.
 */
export const ADMIN_CAMPAIGN_SECTION_SPECS: AdminCampaignSectionSpec[] = [
  {
    type: 'intro',
    label: '인트로 문구',
    fields: [{ key: 'copy', kind: 'text', required: true, maxLength: 500 }],
  },
  {
    type: 'image',
    label: '이미지',
    fields: [
      { key: 'image_path', kind: 'text', required: true, maxLength: 300 },
      { key: 'alt', kind: 'text', required: true, maxLength: 200 },
    ],
  },
  {
    type: 'text',
    label: '본문',
    fields: [
      { key: 'heading', kind: 'text', required: false, maxLength: 120 },
      { key: 'body', kind: 'text', required: true, maxLength: 2000 },
    ],
  },
  { type: 'attendance', label: '출석 적립', fields: [] },
  {
    type: 'exchange',
    label: '카드팩 교환처',
    fields: [{ key: 'offer_id', kind: 'uuid', required: true, maxLength: 36 }],
  },
  {
    type: 'coupon',
    label: '쿠폰 받기',
    fields: [
      { key: 'coupon_code', kind: 'text', required: true, maxLength: 24 },
      { key: 'description', kind: 'text', required: false, maxLength: 200 },
    ],
  },
  {
    type: 'goods',
    label: '굿즈 묶음',
    fields: [{
      key: 'good_ids',
      kind: 'stringArray',
      required: true,
      maxLength: 120,
      minItems: 1,
      maxItems: 8,
    }],
  },
  {
    type: 'notice',
    label: '유의사항',
    fields: [{
      key: 'items',
      kind: 'stringArray',
      required: true,
      maxLength: 300,
      minItems: 1,
      maxItems: 20,
    }],
  },
];

const SECTION_SPEC_BY_TYPE = new Map<string, AdminCampaignSectionSpec>(
  ADMIN_CAMPAIGN_SECTION_SPECS.map((spec) => [spec.type, spec]),
);

/** 모든 블록이 함께 받는 선택 키. 상세 페이지 목차 링크로 쓰인다. */
const ANCHOR_MAX_LENGTH = 20;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KIND_SET = new Set<string>(ADMIN_CAMPAIGN_KINDS);
const STATUS_SET = new Set<string>(ADMIN_CAMPAIGN_STATUSES);
const OFFER_STATUS_SET = new Set<string>(ADMIN_COIN_OFFER_STATUSES);

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function optionalText(
  formData: FormData,
  key: string,
  maxLength: number,
  errors: AdminFieldErrors,
  message: string,
) {
  const raw = readString(formData, key);
  if (!raw) return null;
  if (raw.length > maxLength) {
    errors[key] = message;
    return null;
  }
  return raw;
}

/* datetime-local 입력을 KST로 해석해 ISO로 옮긴다(쿠폰·카탈로그 콘솔과 같은 해석).
   브라우저 로컬 타임존으로 읽으면 해외에서 접속한 운영자가 9시간 어긋난 기간을 만든다. */
function kstDateTimeToIso(formData: FormData, key: string, errors: AdminFieldErrors) {
  const raw = readString(formData, key);
  if (!raw) return null;

  const match = DATE_TIME_PATTERN.exec(raw);
  if (!match) {
    errors[key] = '날짜와 시각을 선택해주세요.';
    return null;
  }

  const [, year, month, day, hour, minute] = match;
  const parsed = new Date(`${year}-${month}-${day}T${hour}:${minute}:00+09:00`);
  if (Number.isNaN(parsed.getTime())) {
    errors[key] = '날짜와 시각을 선택해주세요.';
    return null;
  }
  return parsed.toISOString();
}

export type AdminCampaignSectionsResult =
  | { ok: true; value: unknown[] }
  | { ok: false; message: string };

function sectionValueError(index: number, key: string, detail: string) {
  return `${index + 1}번째 블록의 ${key}: ${detail}`;
}

function validateSectionField(
  index: number,
  section: Record<string, unknown>,
  field: AdminCampaignSectionField,
): string | null {
  const present = Object.prototype.hasOwnProperty.call(section, field.key);
  if (!present) {
    return field.required ? sectionValueError(index, field.key, '필수 키입니다.') : null;
  }

  const value = section[field.key];

  if (field.kind === 'stringArray') {
    const min = field.minItems ?? 1;
    const max = field.maxItems ?? ADMIN_CAMPAIGN_MAX_SECTIONS;
    if (!Array.isArray(value) || value.length < min || value.length > max) {
      return sectionValueError(index, field.key, `문자열 ${min}~${max}개의 배열이어야 합니다.`);
    }
    const bad = value.some(
      (entry) => typeof entry !== 'string' || entry.length < 1 || entry.length > field.maxLength,
    );
    return bad
      ? sectionValueError(index, field.key, `각 항목은 1~${field.maxLength}자 문자열이어야 합니다.`)
      : null;
  }

  if (typeof value !== 'string' || value.length < 1 || value.length > field.maxLength) {
    return sectionValueError(index, field.key, `1~${field.maxLength}자 문자열이어야 합니다.`);
  }

  if (field.kind === 'uuid' && !UUID_PATTERN.test(value)) {
    return sectionValueError(index, field.key, '교환처 ID(UUID)여야 합니다.');
  }

  return null;
}

/**
 * 본문 JSON 원문을 블록 배열로 읽는다.
 *
 * 모르는 키를 통과시키지 않는 것이 이 검사의 핵심이다 — 오타 하나가 조용히
 * 저장되면 상세 페이지에서는 그냥 빈 블록으로 보이고, 원인을 데이터에서 찾아야 한다.
 */
export function parseAdminCampaignSections(raw: string): AdminCampaignSectionsResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'JSON 형식이 아닙니다. 대괄호와 쉼표를 확인해주세요.' };
  }

  if (!Array.isArray(parsed)) {
    return { ok: false, message: '최상위는 블록 배열([...])이어야 합니다.' };
  }
  if (parsed.length > ADMIN_CAMPAIGN_MAX_SECTIONS) {
    return {
      ok: false,
      message: `블록은 최대 ${ADMIN_CAMPAIGN_MAX_SECTIONS}개까지입니다 (현재 ${parsed.length}개).`,
    };
  }

  for (const [index, entry] of parsed.entries()) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      return { ok: false, message: `${index + 1}번째 블록이 객체가 아닙니다.` };
    }

    const section = entry as Record<string, unknown>;
    const type = section.type;
    if (typeof type !== 'string' || !SECTION_SPEC_BY_TYPE.has(type)) {
      return {
        ok: false,
        message: `${index + 1}번째 블록의 type이 없거나 모르는 값입니다 (${ADMIN_CAMPAIGN_SECTION_TYPES.join(', ')}).`,
      };
    }

    const spec = SECTION_SPEC_BY_TYPE.get(type) as AdminCampaignSectionSpec;
    const allowed = new Set(['type', 'anchor', ...spec.fields.map((field) => field.key)]);
    for (const key of Object.keys(section)) {
      if (!allowed.has(key)) {
        return { ok: false, message: sectionValueError(index, key, `${type} 블록에 없는 키입니다.`) };
      }
    }

    if (Object.prototype.hasOwnProperty.call(section, 'anchor')) {
      const anchor = section.anchor;
      if (typeof anchor !== 'string' || anchor.length < 1 || anchor.length > ANCHOR_MAX_LENGTH) {
        return {
          ok: false,
          message: sectionValueError(index, 'anchor', `1~${ANCHOR_MAX_LENGTH}자 문자열이어야 합니다.`),
        };
      }
    }

    for (const field of spec.fields) {
      const message = validateSectionField(index, section, field);
      if (message) return { ok: false, message };
    }
  }

  return { ok: true, value: parsed };
}

export function normalizeAdminCampaignForm(formData: FormData): AdminCampaignFormResult {
  const errors: AdminFieldErrors = {};

  const id = readString(formData, 'id').toLowerCase();
  const previousId = readString(formData, 'previousId').toLowerCase() || null;
  const title = readString(formData, 'title');
  const kind = readString(formData, 'kind');
  const status = readString(formData, 'status');

  if (!ID_PATTERN.test(id)) {
    errors.id = 'ID는 소문자·숫자·하이픈 2~64자로 입력해주세요.';
  }
  /* 이미 등록된 캠페인의 ID는 바꿀 수 없다(DB가 catalog_id_immutable로 막는다).
     폼이 읽기 전용을 우회당해도 여기서 먼저 걸러 낸다. */
  if (previousId && previousId !== id) {
    errors.id = '등록된 캠페인 ID는 변경할 수 없습니다.';
  }
  if (!title || title.length > 120) {
    errors.title = title.length > 120 ? '제목은 120자 이하로 입력해주세요.' : '캠페인 제목을 입력해주세요.';
  }
  if (!KIND_SET.has(kind)) errors.kind = '캠페인 종류를 선택해주세요.';
  if (!STATUS_SET.has(status)) errors.status = '상태를 선택해주세요.';

  const subtitle = optionalText(formData, 'subtitle', 200, errors, '부제는 200자 이하로 입력해주세요.');
  const heroImagePath = optionalText(formData, 'heroImagePath', 300, errors, '이미지 경로는 300자 이하로 입력해주세요.');
  const cardImagePath = optionalText(formData, 'cardImagePath', 300, errors, '이미지 경로는 300자 이하로 입력해주세요.');
  const bannerImagePath = optionalText(formData, 'bannerImagePath', 300, errors, '이미지 경로는 300자 이하로 입력해주세요.');

  /* 빈 값이 "배너 아님"이다. 별도 체크박스를 두면 "노출인데 순서 없음"이 표현
     가능해지고, 그 상태의 정렬은 아무도 정의하지 못한다(campaigns 스키마 주석). */
  const featuredOrderRaw = readString(formData, 'featuredOrder');
  let featuredOrder: number | null = null;
  if (featuredOrderRaw) {
    const parsed = Number(featuredOrderRaw);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      errors.featuredOrder = '배너 순서는 1 이상의 정수여야 합니다.';
    } else {
      featuredOrder = parsed;
    }
  }

  const startsAt = kstDateTimeToIso(formData, 'startsAt', errors);
  if (!startsAt && !errors.startsAt) errors.startsAt = '시작 시각을 선택해주세요.';
  const endsAt = kstDateTimeToIso(formData, 'endsAt', errors);
  if (!endsAt && !errors.endsAt) errors.endsAt = '종료 시각을 선택해주세요.';
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) {
    errors.endsAt = '종료 시각은 시작 시각보다 뒤여야 합니다.';
  }

  const rawSections = formData.get('sections');
  const sectionsResult = parseAdminCampaignSections(
    typeof rawSections === 'string' ? rawSections : '',
  );
  const sections = sectionsResult.ok ? sectionsResult.value : [];
  if (!sectionsResult.ok) errors.sections = sectionsResult.message;

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      previousId,
      id,
      kind: kind as AdminCampaignKind,
      title,
      subtitle,
      status: status as AdminCampaignStatus,
      startsAt: startsAt as string,
      endsAt: endsAt as string,
      heroImagePath,
      cardImagePath,
      bannerImagePath,
      featuredOrder,
      sections,
    },
  };
}

export function normalizeAdminCoinExchangeOfferForm(
  formData: FormData,
): AdminCoinExchangeOfferFormResult {
  const errors: AdminFieldErrors = {};

  const rawId = readString(formData, 'offerId').toLowerCase();
  const id = rawId || null;
  if (id && !UUID_PATTERN.test(id)) {
    errors.offerId = '수정할 교환처를 다시 선택해주세요.';
  }

  const poolId = readString(formData, 'poolId').toLowerCase();
  if (!UUID_PATTERN.test(poolId)) errors.poolId = '카드풀을 선택해주세요.';

  const label = readString(formData, 'label');
  if (!label || label.length > 80) {
    errors.label = label.length > 80 ? '이름은 80자 이하로 입력해주세요.' : '교환처 이름을 입력해주세요.';
  }

  const coinCostRaw = readString(formData, 'coinCost');
  const coinCost = Number(coinCostRaw);
  if (!coinCostRaw || !Number.isInteger(coinCost) || coinCost < 1 || coinCost > 100_000) {
    errors.coinCost = '코인 비용은 1~100,000 사이의 정수여야 합니다.';
  }

  const ticketCountRaw = readString(formData, 'ticketCount');
  const ticketCount = ticketCountRaw ? Number(ticketCountRaw) : 1;
  if (!Number.isInteger(ticketCount) || ticketCount < 1 || ticketCount > 10) {
    errors.ticketCount = '카드팩 수량은 1~10장이어야 합니다.';
  }

  const status = readString(formData, 'status');
  if (!OFFER_STATUS_SET.has(status)) errors.status = '노출 상태를 선택해주세요.';

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      id,
      poolId,
      label,
      coinCost,
      ticketCount,
      status: status as AdminCoinOfferStatus,
    },
  };
}

/** 저장된 timestamptz를 datetime-local 입력 값(KST)으로. */
export function adminCampaignDateTimeInput(value: string | null | undefined) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

/** 폼 textarea 초기값. 저장된 블록을 사람이 읽고 고칠 수 있게 들여쓴다. */
export function adminCampaignSectionsInput(sections: unknown[] | null | undefined) {
  if (!sections?.length) return '';
  return JSON.stringify(sections, null, 2);
}

import { parseHomeMosaicPayload } from '@/lib/home-mosaic';
import { HOME_REVIEW_MANUAL_LIMIT, isHomeSalesPeriod } from '@/lib/home-ranking';
import { HOME_HERO_CONTENT_LIMIT, HOME_HERO_TITLE_LIMIT, isHomeHeroImageDim, isHomeHeroTextColor, normalizeHeroNewlines } from '@/lib/home-hero';
import { HOME_PRODUCT_CANDIDATE_LIMIT, homeProductCountRange, isHomeProductCollectionTitle, isHomeProductImageShape, isHomeProductLayout } from '@/lib/home-product-collection';
import { parseShellNoticePageTypes } from '@/lib/shell-notices';

export type AdminCurationKind =
  | 'hero'
  | 'featured_ip'
  | 'announcement'
  | 'notice_strip'
  | 'notice_bar'
  | 'editor_pick'
  | 'band_banner'
  | 'best_tab'
  | 'sales_best'
  | 'review_best'
  | 'product_mosaic'
  | 'product_collection'
  | 'benefit';

export interface AdminCurationFormValue {
  operationId: string;
  expectedUpdatedAt: string | null;
  id: string;
  kind: AdminCurationKind;
  ipId: string | null;
  title: string;
  imagePath: string | null;
  linkPath: string | null;
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
  | 'altTitle'
  | 'altContent'
  | 'altEnabled'
  | 'imageDim'
  | 'textColor'
  | 'expectedUpdatedAt'
  | 'goodIds'
  | 'selectionMode'
  | 'itemCount'
  | 'salesExposure'
  | 'salesPeriod'
  | 'reviewSelectionMode'
  | 'mosaic'
  | 'productLayout'
  | 'productImageShape'
  | 'productItemCount'
  | 'mobileImagePath'
  | 'ctaLabel'
  | 'pageTypes'
  | 'form',
  string
>>;

export type AdminCurationFormResult =
  | { ok: true; value: AdminCurationFormValue }
  | { ok: false; errors: AdminCurationFieldErrors };

export interface AdminCurationActionState {
  errors?: AdminCurationFieldErrors;
  message?: string;
  uncertain?: boolean;
  conflict?: boolean;
}

const CURATION_KINDS = new Set<AdminCurationKind>([
  'hero',
  'featured_ip',
  'announcement',
  'notice_strip',
  'notice_bar',
  'editor_pick',
  'band_banner',
  'best_tab',
  'sales_best',
  'review_best',
  'product_mosaic',
  'product_collection',
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
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
/* 텍스트 공지 바는 셸 맨 위의 한 줄 문구와 짧은 버튼이다 — DB home_curations_notice_check와 같은 한도. */
export const NOTICE_BAR_MESSAGE_LIMIT = 60;
export const NOTICE_BAR_CTA_LIMIT = 12;
const NOTICE_PAGE_TYPES_ERROR = '공지를 보일 화면을 하나 이상 선택해주세요.';

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
 * 상품 선택기의 순서 목록을 쉼표 구분 계약으로 받는다. RPC가 거절할 형식·개수는
 * 여기서 먼저 막아 저장 실패를 폼 에러로 바꾼다.
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

/*
 * 공지 대상 화면 유형. 체크박스는 아무것도 고르지 않으면 값이 전송되지 않으므로 폼은 pageTypesField 표식을 함께 보낸다 —
 * 표식이 있는데 값이 없으면 '전 화면'이 아니라 오류다. 표식 없이 온 스트립 요청(이전 클라이언트)은 대상을 싣지 않아
 * 지금처럼 모든 화면에 보인다. 공지 바는 대상이 필수다.
 */
function readNoticePageTypes(
  formData: FormData,
  kind: 'notice_bar' | 'notice_strip',
  errors: AdminCurationFieldErrors,
  payload: Record<string, unknown>,
) {
  if (!formData.has('pageTypesField')) {
    if (kind === 'notice_bar') errors.pageTypes = NOTICE_PAGE_TYPES_ERROR;
    return;
  }
  const pageTypes = parseShellNoticePageTypes(
    formData.getAll('pageTypes').map((value) => (typeof value === 'string' ? value.trim() : value)),
  );
  if (!pageTypes) {
    errors.pageTypes = NOTICE_PAGE_TYPES_ERROR;
    return;
  }
  payload.page_types = pageTypes;
}

function readCurationPayload(
  formData: FormData,
  kind: AdminCurationKind | null,
  errors: AdminCurationFieldErrors,
) {
  const payload: Record<string, unknown> = {};

  if (kind === 'hero') {
    const imageDim = readString(formData, 'imageDim');
    const textColor = readString(formData, 'textColor');
    if (imageDim) {
      if (isHomeHeroImageDim(imageDim)) payload.image_dim = imageDim;
      else errors.imageDim = '이미지 딤 설정을 선택해주세요.';
    }
    if (textColor) {
      if (isHomeHeroTextColor(textColor)) payload.text_color = textColor;
      else errors.textColor = '텍스트 색상을 선택해주세요.';
    }
    const subtitle = normalizeHeroNewlines(readString(formData, 'subtitle'));
    // Native FormData serializes textarea line breaks as CRLF. Encode the
    // original hidden value so unchanged historical copy can keep its exact
    // bytes while new copy uses the same LF count as the visible text area.
    let originalSubtitle = '';
    try { originalSubtitle = decodeURIComponent(readString(formData, 'originalSubtitle')); } catch { /* Invalid client metadata grants no legacy exception. */ }
    const unchangedSubtitle = subtitle === normalizeHeroNewlines(originalSubtitle).trim();
    if (characterLength(subtitle) > 200 || (!unchangedSubtitle
      && (characterLength(subtitle) > HOME_HERO_CONTENT_LIMIT || subtitle.split('\n').length > 3))) {
      errors.subtitle = '내용은 150자 이하, 최대 3줄로 입력해주세요. 기존 내용은 그대로 유지할 수 있습니다.';
    }
    if (subtitle) payload.subtitle = unchangedSubtitle ? originalSubtitle : subtitle;
    if (formData.has('altEnabled')) {
      const setting = readString(formData, 'altEnabled');
      if (setting !== 'on' && setting !== 'off') errors.altEnabled = '대체텍스트 설정 여부를 선택해주세요.';
      payload.alt_enabled = setting === 'on';
      if (payload.alt_enabled) {
        const title = readString(formData, 'altTitle');
        const content = normalizeHeroNewlines(readString(formData, 'altContent'));
        if (characterLength(title) > HOME_HERO_TITLE_LIMIT) errors.altTitle = '대체텍스트 제목은 40자 이하로 입력해주세요.';
        if (characterLength(content) > HOME_HERO_CONTENT_LIMIT) errors.altContent = '대체텍스트 내용은 150자 이하로 입력해주세요.';
        if (/[\u0000-\u001f\u007f]/.test(title)) errors.altTitle = '대체텍스트 제목에 제어 문자를 입력할 수 없습니다.';
        if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(content)) errors.altContent = '대체텍스트 내용에는 줄바꿈 외의 제어 문자를 입력할 수 없습니다.';
        if (title) payload.alt_title = title;
        if (content) payload.alt_content = content;
      }
    }
    readMobileImagePath(formData, errors, payload);
  } else if (kind === 'notice_strip') {
    /* PC 비율 스트립은 모바일 폭에서 붕괴한다 — 히어로와 같은 모바일 아트웍을 나른다. */
    readMobileImagePath(formData, errors, payload);
    readNoticePageTypes(formData, kind, errors, payload);
  } else if (kind === 'notice_bar') {
    readNoticePageTypes(formData, kind, errors, payload);
    /* 버튼 문구는 이동할 화면이 있을 때만 싣는다 — 링크 없는 공지 바는 문구와 닫기만 보인다. */
    if (readString(formData, 'linkPath')) {
      const label = readString(formData, 'ctaLabel');
      if (!label || characterLength(label) > NOTICE_BAR_CTA_LIMIT || CONTROL_CHARACTER_PATTERN.test(label)) {
        errors.ctaLabel = `버튼 문구는 1자 이상 ${NOTICE_BAR_CTA_LIMIT}자 이하로 입력해주세요.`;
      } else {
        payload.cta_label = label;
      }
    }
  } else if (kind === 'editor_pick') {
    readPayloadText(formData, 'badge', errors, payload);
    readPayloadText(formData, 'description', errors, payload);
  } else if (kind === 'band_banner') {
    readPayloadText(formData, 'subcopy', errors, payload);
    readGoodIds(formData, 'band_banner', errors, payload);
  } else if (kind === 'best_tab') {
    const selectionMode = readString(formData, 'selectionMode') || 'manual';
    if (selectionMode === 'manual') readGoodIds(formData, 'best_tab', errors, payload);
    else if (selectionMode === 'latest') {
      const rawCount = readString(formData, 'itemCount');
      const count = Number(rawCount);
      if (!/^\d+$/.test(rawCount) || !Number.isInteger(count) || count < 3 || count > 10) {
        errors.itemCount = '최신 상품은 3개부터 10개까지 전시할 수 있습니다.';
      } else {
        payload.selection_mode = 'latest';
        payload.item_count = count;
      }
    } else errors.selectionMode = '상품 선정 방식을 선택해주세요.';
  } else if (kind === 'sales_best') {
    const exposure = readString(formData, 'salesExposure');
    const period = readString(formData, 'salesPeriod');
    if (exposure !== 'single' && exposure !== 'all') errors.salesExposure = '베스트 노출 방식을 선택해주세요.';
    else payload.exposure_mode = exposure;
    if (!isHomeSalesPeriod(period)) errors.salesPeriod = '베스트 집계기간을 선택해주세요.';
    else payload.period = period;
  } else if (kind === 'review_best') {
    const selection = readString(formData, 'reviewSelectionMode');
    if (selection !== 'rating' && selection !== 'manual') errors.reviewSelectionMode = '리뷰 상품 선정 방식을 선택해주세요.';
    else {
      payload.selection_mode = selection;
      if (selection === 'manual') {
        const goodIds = readString(formData, 'goodIds').split(',').map((id) => id.trim()).filter(Boolean);
        if (goodIds.length > HOME_REVIEW_MANUAL_LIMIT || goodIds.some((id) => !GOOD_ID_PATTERN.test(id))
          || new Set(goodIds).size !== goodIds.length) errors.goodIds = `중복 없는 상품을 최대 ${HOME_REVIEW_MANUAL_LIMIT}개 선택해주세요.`;
        else payload.good_ids = goodIds;
      }
    }
  } else if (kind === 'product_mosaic') {
    try {
      const mosaic = parseHomeMosaicPayload(JSON.parse(readString(formData, 'mosaic')));
      if (!mosaic) errors.mosaic = '모자이크 제목 10자·부제 20자와 8개 상품/이미지 칸을 확인해주세요.';
      else Object.assign(payload, mosaic);
    } catch { errors.mosaic = '모자이크 구성을 확인해주세요.'; }
  } else if (kind === 'product_collection') {
    const layout = readString(formData, 'productLayout');
    const shape = readString(formData, 'productImageShape');
    const rawCount = readString(formData, 'productItemCount');
    const count = Number(rawCount);
    const ids = readString(formData, 'goodIds').split(',').map(id => id.trim()).filter(Boolean);
    if (!isHomeProductLayout(layout)) errors.productLayout = '리스트형 또는 풀이미지형을 선택해주세요.';
    if (!isHomeProductImageShape(shape)) errors.productImageShape = '상품 사진 비율을 선택해주세요.';
    const [min, max] = homeProductCountRange(isHomeProductLayout(layout) ? layout : 'list');
    if (!/^\d+$/.test(rawCount) || !Number.isInteger(count) || count < min || count > max) {
      errors.productItemCount = `이 디자인은 ${min}개부터 ${max}개까지 전시할 수 있습니다.`;
    }
    if (ids.length > HOME_PRODUCT_CANDIDATE_LIMIT || ids.some(id => !GOOD_ID_PATTERN.test(id)) || new Set(ids).size !== ids.length) {
      errors.goodIds = `중복 없는 상품을 최대 ${HOME_PRODUCT_CANDIDATE_LIMIT}개 선택해주세요.`;
    }
    Object.assign(payload, { layout, image_shape: shape, item_count: count, good_ids: ids });
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
  const expectedUpdatedAt = readString(formData, 'expectedUpdatedAt') || null;
  if (expectedUpdatedAt !== null && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(expectedUpdatedAt)
    || Number.isNaN(Date.parse(expectedUpdatedAt)))) errors.expectedUpdatedAt = '저장본 정보를 확인하지 못했습니다. 새로고침해주세요.';
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
  const titleLimit = ['sales_best', 'review_best', 'product_mosaic', 'product_collection'].includes(kind ?? '') ? 15
    : kind === 'notice_bar' ? NOTICE_BAR_MESSAGE_LIMIT : 120;
  if (characterLength(title) < (kind === 'hero' ? 0 : 1) || characterLength(title) > titleLimit) {
    errors.title = kind === 'hero' ? '제목은 40자 이하로 입력해주세요.' : `제목은 1자 이상 ${titleLimit}자 이하로 입력해주세요.`;
  }
  if (kind === 'hero' && title !== readString(formData, 'originalTitle') && characterLength(title) > HOME_HERO_TITLE_LIMIT) {
    errors.title = '제목은 40자 이하로 입력해주세요. 기존 제목은 그대로 유지할 수 있습니다.';
  }
  if (kind === 'product_collection' && !isHomeProductCollectionTitle(title)) errors.title = '제목은 제어 문자 없이 1자 이상 15자 이하로 입력해주세요.';
  if (kind === 'notice_bar' && (CONTROL_CHARACTER_PATTERN.test(title) || characterLength(title) < 1 || characterLength(title) > NOTICE_BAR_MESSAGE_LIMIT)) {
    errors.title = `공지 문구는 줄바꿈 없이 1자 이상 ${NOTICE_BAR_MESSAGE_LIMIT}자 이하로 입력해주세요.`;
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
  if (kind === 'product_collection' && imagePath) errors.imagePath = '자유상품은 선택한 상품의 대표이미지를 사용합니다.';
  if (kind === 'notice_bar' && imagePath) errors.imagePath = '텍스트 공지 바는 이미지를 쓰지 않습니다.';

  const rawSlot = readString(formData, 'slot');
  let slot: string | null = null;
  if (kind === 'best_tab') {
    if (BEST_TAB_SLOTS.has(rawSlot)) slot = rawSlot;
    else errors.slot = '탭 슬롯을 선택해주세요.';
  }

  const payload = readCurationPayload(formData, kind, errors);

  const rawLinkValue = formData.get('linkPath');
  const rawLinkPath = typeof rawLinkValue === 'string' ? rawLinkValue : '';
  const trimmedLinkPath = rawLinkPath.trim();
  const linkPath = (kind === 'hero' || kind === 'product_collection' || kind === 'notice_bar') && !trimmedLinkPath ? null : trimmedLinkPath;
  const decodedLinkPath = decodeInternalLink(trimmedLinkPath);
  if (AMBIGUOUS_LINK_CHARACTER_PATTERN.test(rawLinkPath) || (linkPath !== null && (
    characterLength(linkPath) < 1
    || characterLength(linkPath) > 2048
    || AMBIGUOUS_LINK_CHARACTER_PATTERN.test(rawLinkPath)
    || isUnsafeInternalLink(linkPath)
    || decodedLinkPath === null
    || isUnsafeInternalLink(decodedLinkPath)
  ))) {
    errors.linkPath = '1~2048자의 안전한 내부 경로를 입력해주세요.';
  }
  if (kind === 'product_collection' && linkPath !== null) errors.linkPath = '자유상품은 각 상품의 상세 화면으로 이동합니다.';

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
      expectedUpdatedAt,
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

import { isUuid } from '@/lib/uuid';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { readGoodsClaimPolicy } from './goods-claim-policy';
import type { GoodClaimPolicy } from '@/lib/goods-claim-policy';
import { readGoodsLinkedMetadata, type GoodsLinkedMetadataInput } from './goods-linked-metadata';
import type { Stock } from '@/lib/data';
import { GOOD_BADGES, parseGoodBadgeText, type GoodBadge } from '@/lib/goods-taxonomy';
import {
  GOODS_NOTICE_FIELDS,
  missingGoodsNoticeKeys,
  type GoodsNoticeInfo,
} from '@/lib/goods-notice';
import { readAdminGoodsSalePolicy, type AdminGoodsSalePolicyInput } from './goods-sale-policy';
import { GOODS_HTML_IMAGE_MAX, GOODS_HTML_MAX_LENGTH, sanitizeGoodsDescription, type GoodsDescriptionFormat } from '@/lib/goods-description';
import { IP_PUBLIC_SLUG_ERROR_MESSAGES, normalizeIpPublicSlug, validateIpPublicSlug } from '@/lib/ip-identity';

/** 표준 값이 아닌 상품 표시문구를 저장하려 할 때의 칸 오류(상품 편집·상품 엑셀 검증·저장 거절이 같은 문구, 어드민 전용). */
export const GOOD_BADGES_INVALID_MESSAGE =
  `상품 표시문구는 ${GOOD_BADGES.join(', ')} 중에서만 고를 수 있습니다. 여러 개는 쉼표로 구분해 적어주세요(예: ${GOOD_BADGES.join(', ')}).`;

export type AdminFieldErrors = Record<string, string>;

export interface AdminCatalogContext {
  eventIds: ReadonlySet<string>;
  goodIpById: ReadonlyMap<string, string>;
  ipIds: ReadonlySet<string>;
  verticalKeys: ReadonlySet<string>;
}

/**
 * IP 폼 값. 새 IP는 내부 ID 없이 공개 URL로 등록하고 내부 ID는 DB(`admin_create_ip`)가 공개 URL로 발급한다
 * (S36-003 · ADR-0039). 기존 IP는 목록·상세에서 고른 내부 ID(`previousId`)의 기본 정보만 고친다 —
 * 공개 URL은 IP 상세의 공개 URL 폼(`admin_update_ip_identity`)이 바꾼다.
 */
export type AdminIpFormValue = AdminIpFormFields & (
  | { previousId: null; id: null; publicSlug: string }
  | { previousId: string; id: string; publicSlug: null }
);

interface AdminIpFormFields {
  title: string;
  sub: string | null;
  verticalKey: string;
  tagline: string | null;
  synopsis: string | null;
  glyph: string | null;
  bg: string | null;
  imagePath: string | null;
  featured: boolean;
  /**
   * 게시 상태 의도. 폼의 제출 버튼(`intent`)이 정한다 — "저장 후 공개"만 true 고, "초안으로
   * 저장"·"저장"은 null(신규는 초안으로 시작, 기존은 상태 유지)이다. 초안으로 되돌리기는
   * 폼이 아니라 별도 컨트롤(admin_set_ip_published)이 맡아 폼 저장이 조용히 비공개로
   * 바꾸는 일이 없다.
   */
  publish: boolean | null;
}

export interface AdminGoodFormValue extends AdminGoodsSalePolicyInput, GoodsLinkedMetadataInput {
  claimPolicy?: GoodClaimPolicy;
  publish: boolean | null;
  previousId: string | null;
  id: string;
  code: string | null;
  defaultVariantCode: string | null;
  ipId: string;
  name: string;
  nameEn?: string | null;
  searchKeywords?: string[];
  displayOrder?: number | null;
  price: number;
  /** 취소선으로 표기할 정가 (#326). 할인 중일 때만 값이 있고, 아니면 null 이다. */
  compareAtPrice: number | null;
  showDiscountRate?: boolean;
  /** 상품 표시문구(NEW·EXCLUSIVE). 고른 순서가 카드·상세 노출 순서이고 같은 값은 한 번만이다. 비우면 표시문구 없음. */
  badges: GoodBadge[];
  stock: Stock;
  bg: string | null;
  imagePath: string | null;
  notice: GoodsNoticeInfo;
  description: string | null;
  descriptionFormat?: GoodsDescriptionFormat;
  descriptionImagePaths?: string[];
  /** 순서가 곧 노출 순서다. 빈 슬롯은 빠진 채로 온다. */
  galleryPaths: string[];
  /** 긴 상세 이미지. 순서가 곧 상세 설명 아래 노출 순서이고, 빈 칸은 빠진 채로 온다. */
  detailImagePaths: string[];
}

export interface AdminStockAdjustmentFormValue {
  adjustmentId: string;
  goodId: string;
  variantId: string;
  expectedStockQty: number;
  delta: number;
  reason: string;
}

export interface AdminEventFormValue {
  previousId: string | null;
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
const INTEGER_PATTERN = /^-?\d+$/;
const INT32_MIN = -2147483648;
const INT32_MAX = 2147483647;
const STOCK_VALUES = new Set<Stock>(['low', 'ok', 'soldout']);
/* 추가 이미지(갤러리)는 대표 이미지 외 최대 9장이다 — 스마트스토어와 같은 대표 1 + 추가 9
 * (#172 · 계획 D6, 2026-10-07 MD 요청으로 4장에서 확대). DB check 제약 goods_gallery_paths_limit과
 * admin_upsert_good 검사(20261007160000)와 같은 값이다. */
export const GOODS_GALLERY_MAX = 9;
/*
 * 긴 상세 이미지(상세 설명 아래에 원래 비율로 이어 붙는 이미지)는 최대 10장이다(2026-11-19 MD 요청: 세로 9,000px가 넘는
 * 통이미지를 잘라 여러 장으로 올린다). DB goods_detail_image_paths_limit·admin_save_good(20261119170100)과 같은 값이다.
 * 첫 칸은 옛 한 장 칸 이름(detailImagePath)을 그대로 써서, 저장된 브라우저 자동복구·서버 임시저장이 첫 장으로 이어진다.
 */
export const GOODS_DETAIL_IMAGE_MAX = 10;
export const GOODS_DETAIL_IMAGE_FIELD_NAMES: readonly string[] = Array.from({ length: GOODS_DETAIL_IMAGE_MAX },
  (_, index) => (index === 0 ? 'detailImagePath' : `detailImagePath${index}`));
export const GOODS_DESCRIPTION_MAX_LENGTH = 2000;
export const GOODS_SEARCH_KEYWORDS_MAX_COUNT = 50;
export const GOODS_SEARCH_KEYWORD_MAX_LENGTH = 80;
const EVENT_MODES = new Set(['온라인', '오프라인']);
const EVENT_STATUSES = new Set(['예매중', '예정', '진행중', '종료']);
const ADMIN_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const ADMIN_DATE_TIME_ERROR = '일시는 날짜와 시각(시·분)까지 모두 골라주세요.';

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function nullableString(formData: FormData, key: string) {
  return readString(formData, key) || null;
}

function rawGoodsSearchKeywords(value: string) {
  return value
    .split(/[\n,]/)
    .map((keyword) => keyword.trim())
    .filter(Boolean);
}

/** 쉼표·줄바꿈 입력을 저장용 순서 있는 목록으로 바꾼다. 첫 표기를 유지한다. */
export function normalizeGoodsSearchKeywords(value: string) {
  const seen = new Set<string>();
  return rawGoodsSearchKeywords(value).filter((keyword) => {
    const identity = keyword.toLocaleLowerCase();
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

export function validateGoodsSearchKeywords(value: string) {
  const rawKeywords = rawGoodsSearchKeywords(value);
  if (rawKeywords.length > GOODS_SEARCH_KEYWORDS_MAX_COUNT
    || normalizeGoodsSearchKeywords(value).length > GOODS_SEARCH_KEYWORDS_MAX_COUNT
    || rawKeywords.some((keyword) => keyword.length > GOODS_SEARCH_KEYWORD_MAX_LENGTH)) {
    return `검색 키워드는 ${GOODS_SEARCH_KEYWORDS_MAX_COUNT}개 이하, 키워드당 ${GOODS_SEARCH_KEYWORD_MAX_LENGTH}자 이하로 입력해주세요.`;
  }
  return null;
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
  if (!isUuid(value)) errors[key] = message;
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

/*
 * 값이 없는 것과 0은 다르다 (#326 정가).
 * 빈 칸은 "할인 아님"이라는 뜻이라 null 로 남겨야 하고, 0 은 잘못 입력한 정가다.
 */
function nullableNonNegativeInteger(
  formData: FormData,
  key: string,
  errors: AdminFieldErrors,
  message: string,
) {
  const raw = readString(formData, key);
  if (!raw) return null;

  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > INT32_MAX) {
    errors[key] = message;
    return null;
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

/*
 * 저장 의도를 폼에서 읽는다 (#181).
 * 값이 없으면 신규 등록, 있으면 목록에서 선택한 레코드의 수정이다.
 * 등록된 ID는 바꿀 수 없다 — 폼에서도 읽기 전용이고 우회 시 여기서 막힌다.
 */
function readPreviousId(formData: FormData, id: string, errors: AdminFieldErrors) {
  const previousId = readString(formData, 'previousId');
  if (!previousId) return null;

  if (!SLUG_PATTERN.test(previousId)) {
    errors.id = '수정 대상을 확인할 수 없습니다. 목록에서 다시 선택해주세요.';
    return previousId;
  }

  if (previousId !== id) {
    errors.id = '등록된 ID는 변경할 수 없습니다.';
  }

  return previousId;
}

/*
 * 고시정보는 법정 표기라 한 항목이라도 비면 저장을 막는다 (#171).
 * 항목 목록은 lib/goods-notice.ts 하나에서만 늘어난다.
 */
function readGoodsNotice(formData: FormData, errors: AdminFieldErrors, required = true): GoodsNoticeInfo {
  const notice = Object.fromEntries(
    GOODS_NOTICE_FIELDS.map((field) => [field.key, nullableString(formData, field.formName)]),
  ) as GoodsNoticeInfo;
  const missing = new Set(missingGoodsNoticeKeys(notice));

  for (const field of GOODS_NOTICE_FIELDS) {
    if (required && missing.has(field.key)) errors[field.formName] = '고시정보 필수 항목입니다.';
  }

  return notice;
}

/*
 * 추가 이미지는 번호가 붙은 칸 GOODS_GALLERY_MAX개다 (#172). 운영자는 칸 순서로 노출 순서를 정하고,
 * 비운 칸은 배열에서 빠진다 — 배열 인덱스가 그대로 노출 순서가 된다.
 */
/* 긴 상세 이미지 칸(GOODS_DETAIL_IMAGE_FIELD_NAMES)도 칸 순서가 노출 순서이고 비운 칸은 빠진다. */
function readGoodsDetailImagePaths(formData: FormData, errors: AdminFieldErrors): string[] {
  const paths: string[] = [];
  for (const key of GOODS_DETAIL_IMAGE_FIELD_NAMES) {
    const path = readString(formData, key);
    if (!path) continue;
    if (paths.includes(path)) {
      errors[key] = '같은 이미지를 긴 상세 이미지에 두 번 넣을 수 없습니다.';
      continue;
    }
    paths.push(path);
  }
  return paths;
}

function readGoodsGalleryPaths(formData: FormData, errors: AdminFieldErrors): string[] {
  const paths: string[] = [];

  for (let slot = 0; slot < GOODS_GALLERY_MAX; slot += 1) {
    const key = `galleryPath${slot}`;
    const path = readString(formData, key);
    if (!path) continue;
    if (paths.includes(path)) {
      errors[key] = '같은 이미지를 갤러리에 두 번 넣을 수 없습니다.';
      continue;
    }
    paths.push(path);
  }

  return paths;
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

/*
 * 초안 저장과 공개 저장의 검증 요건은 지금 같다(새 IP는 공개 URL, 기존 IP는 내부 ID·이름·버티컬) —
 * 초안이라고 이 칸들을 비울 수는 없다(DB 제약이기도 하다). 공개 전용 요건이 생기면 `publish` 가
 * true 일 때만 여기서 더 검사한다.
 */
export function normalizeAdminIpForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminIpFormValue> {
  const errors: AdminFieldErrors = {};
  let identity: { previousId: null; id: null; publicSlug: string } | { previousId: string; id: string; publicSlug: null };
  if (readString(formData, 'previousId')) {
    /* 기존 IP: 읽기 전용 내부 ID가 고른 레코드와 같아야 한다(#181 저장 의도). */
    const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
    identity = { previousId: readPreviousId(formData, id, errors) ?? id, id, publicSlug: null };
  } else {
    /* 새 IP: 사람은 공개 URL만 넣는다. 내부 ID는 처음 저장할 때 DB가 이 주소로 발급한다. */
    const publicSlug = normalizeIpPublicSlug(formData.get('publicSlug'));
    const slugError = validateIpPublicSlug(publicSlug);
    if (slugError) errors.publicSlug = IP_PUBLIC_SLUG_ERROR_MESSAGES[slugError];
    identity = { previousId: null, id: null, publicSlug };
  }
  const title = readString(formData, 'title');
  const verticalKey = readString(formData, 'verticalKey');
  const publish = readString(formData, 'intent') === 'publish' ? true : null;

  if (!title) errors.title = 'IP 이름을 입력해주세요.';
  if (!verticalKey || !context.verticalKeys.has(verticalKey)) {
    errors.verticalKey = '등록된 IP 분류를 선택해주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      ...identity,
      title,
      sub: nullableString(formData, 'sub'),
      verticalKey,
      tagline: nullableString(formData, 'tagline'),
      synopsis: nullableString(formData, 'synopsis'),
      glyph: nullableString(formData, 'glyph'),
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
      featured: formData.get('featured') === 'on',
      publish,
    },
  };
}

/*
 * 정가(compareAtPrice) 검증은 상품 편집기와 상품 엑셀이 함께 쓴다. 엑셀 v8은 편집기와 같은 판매가·즉시할인 열이고
 * goodsWorkbookStoredPrice가 먼저 열 이름으로 알린다. 아래 엑셀 문구는 그 뒤의 방어 검증이 같은 열 이름을 쓰게 한다(T17a·T20).
 */
const COMPARE_AT_PRICE_COPY = {
  editor: {
    invalid: '판매가와 할인은 0 이상의 원 단위 숫자로 입력해주세요.',
    notAbovePrice: '할인은 0원보다 크고 판매가보다 작아야 해요. 판매가와 할인을 확인해주세요.',
  },
  workbook: {
    invalid: '판매가와 즉시할인은 0 이상의 원 단위 정수로 입력해주세요.',
    notAbovePrice: '즉시할인은 1원 이상, 판매가보다 작아야 합니다.',
  },
} as const;
export type AdminGoodFormCopy = keyof typeof COMPARE_AT_PRICE_COPY;

/** ADR-0044: 대표 카테고리 없이 공개를 요청했을 때의 안내(상품 편집·엑셀 공통). */
export const GOOD_CATEGORY_PUBLISH_REQUIRED = '대표 카테고리를 고른 뒤 공개해주세요.';

export function normalizeAdminGoodForm(
  formData: FormData,
  context: AdminCatalogContext,
  options: { copy?: AdminGoodFormCopy; /** 엑셀 반입: 대표 카테고리가 원래 없던 공개 상품의 '공개' 행은 카테고리 검사만 건너뛴다(대표 이미지·고시 검사는 유지). */ skipPublishCategory?: boolean } = {},
): AdminFormResult<AdminGoodFormValue> {
  const priceCopy = COMPARE_AT_PRICE_COPY[options.copy ?? 'editor'];
  const errors: AdminFieldErrors = {};
  const publish = formData.get('intent') === 'publish' ? true : null;
  const requiresCompleteNotice = publish === true || formData.get('published') === 'true';
  const id = readString(formData, 'id');
  const previousId = nullableString(formData, 'previousId');
  if (id && (!SLUG_PATTERN.test(id) || id.length>64)) errors.id='URL은 영문 소문자·숫자·하이픈 64자 이내로 입력해주세요.';
  if (previousId && !SLUG_PATTERN.test(previousId)) errors.id='수정 대상을 확인할 수 없습니다. 목록에서 다시 선택해주세요.';
  const code=nullableString(formData,'code')?.toUpperCase() ?? null;
  const defaultVariantCode=nullableString(formData,'defaultVariantCode')?.toUpperCase() ?? null;
  if (code && code.length>100) errors.code='상품 자동코드는 100자 이내로 입력해주세요.';
  if (defaultVariantCode && defaultVariantCode.length>120) errors.defaultVariantCode='옵션코드는 120자 이내로 입력해주세요.';
  const ipId = validIpId(readString(formData, 'ipId'), context, errors);
  const name = readString(formData, 'name');
  const stock = (readString(formData, 'stock') || 'ok') as Stock;
  const price = nonNegativeInteger(formData, 'price', errors, '가격은 0 이상의 정수여야 합니다.');
  const compareAtPrice = nullableNonNegativeInteger(
    formData,
    'compareAtPrice',
    errors,
    priceCopy.invalid,
  );
  const notice = readGoodsNotice(formData, errors, requiresCompleteNotice);
  const showDiscountRate = formData.has('showDiscountRate') ? readString(formData, 'showDiscountRate') : undefined;
  if (showDiscountRate !== undefined && !['true', 'false'].includes(showDiscountRate)) {
    errors.showDiscountRate = '할인율 표시 여부를 선택해주세요.';
  }
  const descriptionFormat = readString(formData, 'descriptionFormat') || 'plain';
  const rawDescription = nullableString(formData, 'description');
  const htmlContent = descriptionFormat === 'html' && rawDescription && rawDescription.length <= GOODS_HTML_MAX_LENGTH
    ? sanitizeGoodsDescription(rawDescription) : null;
  const description = descriptionFormat === 'html' ? htmlContent?.html || null : rawDescription;
  if (!['plain', 'html'].includes(descriptionFormat)) errors.descriptionFormat = '일반 텍스트 또는 HTML을 선택해주세요.';
  if (descriptionFormat === 'html' && ((rawDescription?.length ?? 0) > GOODS_HTML_MAX_LENGTH || (description?.length ?? 0) > GOODS_HTML_MAX_LENGTH)) {
    errors.description = `HTML 설명은 정리된 코드까지 ${GOODS_HTML_MAX_LENGTH.toLocaleString('ko-KR')}자 이하로 입력해주세요.`;
  }
  if ((htmlContent?.imagePaths.length ?? 0) > GOODS_HTML_IMAGE_MAX) errors.description = 'HTML 설명 이미지는 최대 20장입니다.';
  const nameEn = nullableString(formData, 'nameEn');
  if (nameEn && nameEn.length > 200) errors.nameEn = '영문 상품명은 200자 이하로 입력해주세요.';
  const searchKeywords = formData.has('searchKeywords')
    ? normalizeGoodsSearchKeywords(readString(formData, 'searchKeywords'))
    : undefined;
  if (formData.has('searchKeywords')) {
    const keywordError = validateGoodsSearchKeywords(readString(formData, 'searchKeywords'));
    if (keywordError) errors.searchKeywords = keywordError;
  }
  const displayOrder = formData.has('displayOrder')
    ? nullableNonNegativeInteger(formData, 'displayOrder', errors, '진열 순서는 0 이상의 정수여야 합니다.')
    : undefined;
  const claimPolicy = readGoodsClaimPolicy(formData);
  Object.assign(errors, claimPolicy.errors);
  const linkedMetadata = readGoodsLinkedMetadata(formData);
  Object.assign(errors, linkedMetadata.errors);
  const salePolicy = readAdminGoodsSalePolicy(formData);
  Object.assign(errors, salePolicy.errors);
  const galleryPaths = readGoodsGalleryPaths(formData, errors);
  const detailImagePaths = readGoodsDetailImagePaths(formData, errors);
  /* 상품 표시문구는 한 칸에 고른 순서대로 쉼표로 이어 온다(편집 화면 숨은 칸·상품 엑셀 열 모두 같은 모양, 옛 한 값 포함). */
  const badgeText = parseGoodBadgeText(readString(formData, 'badge'));
  if (badgeText.invalid.length) errors.badge = GOOD_BADGES_INVALID_MESSAGE;

  if (!name) errors.name = adminGoodsCopy('굿즈 이름을 입력해주세요.');
  /* ADR-0044: 상품 유형은 없다. 공개하려면 대표 카테고리가 있어야 한다. */
  if (publish && !options.skipPublishCategory && !errors.categoryId && !readString(formData, 'categoryId')) errors.categoryId = GOOD_CATEGORY_PUBLISH_REQUIRED;
  if (publish && !nullableString(formData, 'imagePath')) errors.imagePath = '대표 이미지를 업로드한 뒤 공개해주세요.';
  if (!STOCK_VALUES.has(stock)) errors.stock = '재고 상태를 선택해주세요.';
  /* 정가가 판매가 이하면 0%·음수 할인율이 나온다. RPC 도 goods_compare_at_price_invalid
     로 막지만, 운영자에게는 저장 실패가 아니라 그 칸의 에러로 보여야 고칠 수 있다. */
  if (compareAtPrice !== null && !errors.compareAtPrice && compareAtPrice <= price) {
    errors.compareAtPrice = priceCopy.notAbovePrice;
  }
  if (descriptionFormat === 'plain' && description && description.length > GOODS_DESCRIPTION_MAX_LENGTH) {
    errors.description = '설명은 2,000자 이하로 입력해주세요.';
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      previousId,
      id,
      ipId,
      name,
      ...salePolicy.value,
      ...linkedMetadata.value,
      ...(claimPolicy.value ? { claimPolicy: claimPolicy.value } : {}),
      price,
      code,
      defaultVariantCode,
      publish,
      compareAtPrice,
      ...(showDiscountRate !== undefined ? { showDiscountRate: showDiscountRate === 'true' } : {}),
      ...(searchKeywords !== undefined ? { searchKeywords } : {}),
      ...(displayOrder !== undefined ? { displayOrder } : {}),
      badges: badgeText.badges,
      stock,
      bg: nullableString(formData, 'bg'),
      imagePath: nullableString(formData, 'imagePath'),
      notice,
      description,
      ...(formData.has('descriptionFormat') ? { descriptionFormat: descriptionFormat as GoodsDescriptionFormat, descriptionImagePaths: htmlContent?.imagePaths ?? [] } : {}),
      ...(formData.has('nameEn') ? { nameEn } : {}),
      galleryPaths,
      detailImagePaths,
    },
  };
}

export function normalizeAdminStockAdjustmentForm(
  formData: FormData,
): AdminFormResult<AdminStockAdjustmentFormValue> {
  const errors: AdminFieldErrors = {};
  const adjustmentId = readString(formData, 'adjustmentId').toLowerCase();
  const goodId = readSlug(formData, 'goodId', errors, adminGoodsCopy('굿즈를 선택해주세요.'));
  const variantId = readString(formData, 'variantId').toLowerCase();
  const expectedStockQtyRaw = readString(formData, 'expectedStockQty');
  const deltaRaw = readString(formData, 'delta');
  const reason = readString(formData, 'reason');

  if (!isUuid(adjustmentId)) {
    errors.adjustmentId = '재고 조정 요청을 읽지 못했습니다. 새로고침한 뒤 다시 시도해주세요.';
  }
  if (!isUuid(variantId)) errors.variantId = '재고를 조정할 옵션을 선택해주세요.';

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
    errors.delta = '조정 수량이 너무 큽니다. -2,147,483,648~2,147,483,647 안의 정수로 입력해주세요.';
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
      variantId,
      expectedStockQty,
      delta,
      reason,
    },
  };
}

export function normalizeAdminEventForm(
  formData: FormData,
  context: AdminCatalogContext,
): AdminFormResult<AdminEventFormValue> {
  const errors: AdminFieldErrors = {};
  const id = readSlug(formData, 'id', errors, 'ID를 입력해주세요.');
  const previousId = readPreviousId(formData, id, errors);
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
      previousId,
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
  const operationId = readUuid(formData, 'operationId', errors, '저장 요청을 읽지 못했습니다. 새로고침한 뒤 다시 저장해주세요.');
  const id = readUuid(formData, 'id', errors, '티켓 회차를 찾지 못했습니다. 새로고침한 뒤 다시 골라주세요.');
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

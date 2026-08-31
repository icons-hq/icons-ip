/* 굿즈 리뷰의 공용 도메인 모듈(#254).
 *
 * 리뷰는 배송완료된 굿즈에 구매자가 남기는 별점·글·사진 후기다(CONTEXT.md).
 * 구매평·상품평·댓글이라고 부르지 않는다 — 댓글은 커뮤니티 개념이고, 리뷰의
 * 작성 자격은 "그 굿즈를 실제로 받은 주문"에 매여 있다.
 *
 * 이 파일은 서버·클라이언트·어드민이 함께 보는 순수 모듈이라 DB도 env도 모른다.
 * 길이·장수·기한 상수는 DB의 CHECK 제약·RPC와 같은 값이어야 한다
 * (supabase/migrations/20260818130001_goods_reviews.sql). 한쪽만 넓히면 화면은
 * 통과시키는데 저장이 거절되는 폼이 만들어진다.
 *
 * 자격·기한·중복의 최종 판정은 언제나 서버다. 여기 있는 계산은 그 판정을 미리
 * 보여 주기 위한 것이지 대체하는 것이 아니다. */

export const MIN_REVIEW_RATING = 1;
export const MAX_REVIEW_RATING = 5;
export const REVIEW_RATINGS = [1, 2, 3, 4, 5] as const;
export type ReviewRating = (typeof REVIEW_RATINGS)[number];

export const MIN_REVIEW_BODY_LENGTH = 5;
export const MAX_REVIEW_BODY_LENGTH = 1000;
export const MAX_REVIEW_IMAGES = 5;
export const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

/** 작성·수정 기한. DB의 private.review_write_deadline과 같은 값이다. */
export const REVIEW_WINDOW_DAYS = 90;

/** 저평점 기준. 어드민 콘솔의 고정 필터와 같은 경계를 쓴다. */
export const LOW_REVIEW_RATING_MAX = 2;

export const REVIEW_STATUSES = ['visible', 'hidden'] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/* 사용자에게 보이는 말과 운영자에게 보이는 말을 나눈다. 구매자에게 "숨김"은
   운영 용어라, 자기 리뷰가 왜 안 보이는지를 설명하지 못한다. */
export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  visible: '공개',
  hidden: '비공개 처리됨',
};

export const ADMIN_REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  visible: '공개',
  hidden: '블라인드',
};

export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isReviewRating(value: unknown): value is ReviewRating {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_REVIEW_RATING
    && value <= MAX_REVIEW_RATING;
}

/* ---------------------------------------------------------------------------
 * 공개 목록 정렬·필터
 * ------------------------------------------------------------------------- */

export const REVIEW_SORTS = ['recent', 'rating_desc', 'rating_asc'] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];

export const REVIEW_SORT_LABELS: Record<ReviewSort, string> = {
  recent: '최신순',
  rating_desc: '평점 높은순',
  rating_asc: '평점 낮은순',
};

export function isReviewSort(value: unknown): value is ReviewSort {
  return typeof value === 'string' && (REVIEW_SORTS as readonly string[]).includes(value);
}

export const GOOD_REVIEW_PAGE_SIZE = 10;

export interface GoodReviewListOptions {
  sort: ReviewSort;
  photoOnly: boolean;
  page: number;
}

export const DEFAULT_GOOD_REVIEW_OPTIONS: GoodReviewListOptions = {
  sort: 'recent',
  photoOnly: false,
  page: 1,
};

type SearchParamValue = string | string[] | undefined;

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

/**
 * 굿즈 상세의 리뷰 목록 조건.
 *
 * 조건을 URL에 남긴다 — "사진 리뷰만 평점 낮은순"으로 보던 화면을 새로고침이나
 * 공유로 잃으면, 그 조건을 다시 만들 방법이 화면에 없다.
 */
export function normalizeGoodReviewOptions(
  searchParams: Record<string, SearchParamValue>,
): GoodReviewListOptions {
  const rawSort = singleParam(searchParams.reviewSort);
  const rawPage = Number(singleParam(searchParams.reviewPage));

  return {
    sort: isReviewSort(rawSort) ? rawSort : 'recent',
    photoOnly: singleParam(searchParams.reviewPhoto) === '1',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

/**
 * 굿즈 상세의 리뷰 목록으로 가는 링크. 리뷰 조건만 바꾸고 나머지 경로는 유지한다.
 *
 * 기본 조건이라고 `reviewPage`까지 뺀 "깨끗한" URL을 만들지 않는다 — 굿즈 상세는
 * 리뷰 파라미터를 보고 리뷰 탭에서 시작하고(GoodDetail의 pdpDefaultPanelId), 하나도
 * 없으면 `#reviews` 앵커가 숨겨진 패널 안을 가리켜 클릭이 아무 일도 하지 않는다.
 */
export function goodReviewsHref(
  goodId: string,
  options: GoodReviewListOptions = DEFAULT_GOOD_REVIEW_OPTIONS,
  overrides: Partial<GoodReviewListOptions> = {},
) {
  const next = { ...options, ...overrides };
  const params = new URLSearchParams();
  if (next.sort !== 'recent') params.set('reviewSort', next.sort);
  if (next.photoOnly) params.set('reviewPhoto', '1');
  params.set('reviewPage', String(Math.max(1, next.page)));
  return `/shop/${goodId}?${params.toString()}#reviews`;
}

/* ---------------------------------------------------------------------------
 * 평점 표시
 * ------------------------------------------------------------------------- */

export interface ReviewRatingSummary {
  count: number;
  average: number;
  /** 별점별 건수. 인덱스 0이 1점이다. */
  distribution: [number, number, number, number, number];
  photoCount: number;
}

export const EMPTY_REVIEW_SUMMARY: ReviewRatingSummary = {
  count: 0,
  average: 0,
  distribution: [0, 0, 0, 0, 0],
  photoCount: 0,
};

/** 소수 한 자리. 4.0을 "4"로 접지 않는다 — 4.0과 4.04는 다른 신호다. */
export function formatReviewAverage(average: number) {
  if (!Number.isFinite(average) || average <= 0) return '0.0';
  return average.toFixed(1);
}

/**
 * 별점 분포의 막대 비율(%).
 *
 * 0건일 때 0을 돌려준다. 전체가 0인데 1/0으로 NaN을 만들면 style에 그대로
 * 흘러들어 막대가 사라지거나 100%로 늘어난다.
 */
export function reviewDistributionPercent(count: number, total: number) {
  if (!Number.isFinite(count) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10;
}

/** 스크린리더용 별점 문구. 별 문자를 그대로 읽히면 "검은 별 검은 별..."이 된다. */
export function reviewRatingLabel(rating: number) {
  return `5점 만점에 ${rating}점`;
}

/* ---------------------------------------------------------------------------
 * 작성 기한
 * ------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;

/** 배송완료 시각 + 90일. 기산점이 없으면 기한도 없다 — 지어내지 않는다. */
export function reviewWriteDeadline(deliveredAt: string | null | undefined): Date | null {
  if (!deliveredAt) return null;
  const delivered = new Date(deliveredAt);
  if (Number.isNaN(delivered.getTime())) return null;
  return new Date(delivered.getTime() + REVIEW_WINDOW_DAYS * DAY_MS);
}

/**
 * 남은 일수.
 *
 * 올림한다 — 3시간 남았을 때 "0일 남음"은 이미 끝났다는 말로 읽힌다.
 * 기한이 지났으면 0이고, 기산점이 없으면 null이다.
 */
export function reviewDaysRemaining(
  deliveredAt: string | null | undefined,
  now: Date = new Date(),
): number | null {
  const deadline = reviewWriteDeadline(deliveredAt);
  if (!deadline) return null;
  const remaining = deadline.getTime() - now.getTime();
  return remaining <= 0 ? 0 : Math.ceil(remaining / DAY_MS);
}

/* ---------------------------------------------------------------------------
 * 첨부
 * ------------------------------------------------------------------------- */

const IMAGE_EXTENSIONS_BY_MIME_TYPE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

export const REVIEW_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

const IMAGE_ERROR =
  `리뷰 사진은 JPEG, PNG, WebP, GIF 형식의 5MB 이하 파일만 최대 ${MAX_REVIEW_IMAGES}장까지 올릴 수 있습니다.`;

/**
 * 사진 업로드 경로.
 *
 * 커뮤니티와 같은 `user-uploads` 버킷을 쓰되 접두는 `<uid>/review/`로 분리한다.
 * 커뮤니티 경로를 재사용하면 커뮤니티 글쓰기를 닫는 운영 스위치가 리뷰 사진까지
 * 함께 잠근다 — 성격이 다른 두 판단이 한 스위치에 묶인다.
 */
export function buildReviewUploadPath({
  userId,
  mimeType,
  nonce,
}: {
  userId: string;
  mimeType: string;
  nonce: string;
}) {
  const extension = IMAGE_EXTENSIONS_BY_MIME_TYPE.get(mimeType) ?? 'bin';
  return `${userId}/review/${nonce}.${extension}`;
}

function isAcceptedImage(file: File) {
  return file.size > 0
    && file.size <= MAX_REVIEW_IMAGE_BYTES
    && IMAGE_EXTENSIONS_BY_MIME_TYPE.has(file.type);
}

/** FormData의 파일 항목만 걸러 낸다. 빈 file input은 크기 0짜리 File로 들어온다. */
export function reviewImagesFromFormData(entries: readonly FormDataEntryValue[]): File[] {
  return entries.filter((entry): entry is File => (
    typeof entry === 'object' && entry !== null && 'size' in entry && (entry as File).size > 0
  ));
}

/* ---------------------------------------------------------------------------
 * 폼 정규화
 * ------------------------------------------------------------------------- */

export interface ReviewFormErrors {
  rating?: string;
  body?: string;
  images?: string;
  form?: string;
}

export interface ReviewCreateFormValue {
  orderId: string;
  goodId: string;
  rating: ReviewRating;
  body: string;
  images: File[];
}

export type ReviewCreateFormResult =
  | { ok: true; value: ReviewCreateFormValue }
  | { ok: false; errors: ReviewFormErrors };

export interface ReviewUpdateFormValue {
  reviewId: string;
  rating: ReviewRating;
  body: string;
  images: File[];
  /** 그대로 유지할 기존 사진 경로. 체크를 푼 사진은 여기서 빠진다. */
  keptImagePaths: string[];
}

export type ReviewUpdateFormResult =
  | { ok: true; value: ReviewUpdateFormValue }
  | { ok: false; errors: ReviewFormErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REVIEW_IMAGE_PATH_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/review\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/i;

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, name: string) {
  const value = readString(formData, name).toLowerCase();
  return UUID_PATTERN.test(value) ? value : null;
}

function readRating(formData: FormData) {
  const parsed = Number(readString(formData, 'rating'));
  return isReviewRating(parsed) ? parsed : null;
}

function validateBody(body: string, errors: ReviewFormErrors) {
  if (!body) errors.body = '리뷰 내용을 입력해주세요.';
  else if (body.length < MIN_REVIEW_BODY_LENGTH) {
    errors.body = `리뷰 내용은 ${MIN_REVIEW_BODY_LENGTH}자 이상 입력해주세요.`;
  } else if (body.length > MAX_REVIEW_BODY_LENGTH) {
    errors.body = `리뷰 내용은 ${MAX_REVIEW_BODY_LENGTH}자 이내로 입력해주세요.`;
  }
}

export function normalizeReviewCreateForm(formData: FormData): ReviewCreateFormResult {
  const orderId = readUuid(formData, 'orderId');
  const goodId = readString(formData, 'goodId');
  const rating = readRating(formData);
  const body = readString(formData, 'body');
  const images = reviewImagesFromFormData(formData.getAll('images'));
  const errors: ReviewFormErrors = {};

  if (!orderId || !goodId) errors.form = '리뷰를 남길 주문을 찾을 수 없습니다.';
  if (rating === null) errors.rating = '별점을 선택해주세요.';
  validateBody(body, errors);
  if (images.length > MAX_REVIEW_IMAGES || images.some((image) => !isAcceptedImage(image))) {
    errors.images = IMAGE_ERROR;
  }

  if (Object.keys(errors).length || !orderId || !goodId || rating === null) {
    return { ok: false, errors };
  }

  return { ok: true, value: { orderId, goodId, rating, body, images } };
}

/**
 * 수정 폼.
 *
 * 유지할 기존 사진은 경로 그대로 돌아온다. 형식이 맞지 않는 값은 조용히 버린다 —
 * 클라이언트가 보낸 문자열을 그대로 DB에 넘기면 남의 폴더를 가리키는 경로가
 * 섞일 수 있다. 소유 검증 자체는 DB가 한 번 더 한다.
 */
export function normalizeReviewUpdateForm(formData: FormData): ReviewUpdateFormResult {
  const reviewId = readUuid(formData, 'reviewId');
  const rating = readRating(formData);
  const body = readString(formData, 'body');
  const images = reviewImagesFromFormData(formData.getAll('images'));
  const keptImagePaths = formData
    .getAll('keepImagePaths')
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => REVIEW_IMAGE_PATH_PATTERN.test(entry));
  const errors: ReviewFormErrors = {};

  if (!reviewId) errors.form = '리뷰를 찾을 수 없습니다.';
  if (rating === null) errors.rating = '별점을 선택해주세요.';
  validateBody(body, errors);
  if (
    images.length + keptImagePaths.length > MAX_REVIEW_IMAGES
    || images.some((image) => !isAcceptedImage(image))
  ) {
    errors.images = IMAGE_ERROR;
  }

  if (Object.keys(errors).length || !reviewId || rating === null) {
    return { ok: false, errors };
  }

  return { ok: true, value: { reviewId, rating, body, images, keptImagePaths } };
}

/* ---------------------------------------------------------------------------
 * 표시 헬퍼
 * ------------------------------------------------------------------------- */

export function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

export function formatReviewDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

/** 목록·그리드의 본문 미리보기. 줄바꿈을 접어 한 줄로 만든다. */
export function reviewBodyPreview(body: string, limit = 60) {
  const normalized = body.trim().replace(/\s+/g, ' ');
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

/** 리뷰 작성 화면 링크. 주문 상세·마이페이지가 공유하는 진입점이다. */
export function newReviewHref(orderId: string, goodId: string) {
  const params = new URLSearchParams({ orderId, goodId });
  return `/my/reviews/new?${params.toString()}`;
}

export function editReviewHref(reviewId: string) {
  return `/my/reviews/${reviewId}`;
}

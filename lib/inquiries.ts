/* 인앱 1:1 문의의 공용 도메인 모듈(#253).
 *
 * 문의는 비공개 질문 스레드다 — 질문·답변·종결로 끝나는 대화이며, 상태기계와
 * 환불·재출고를 갖는 클레임과는 다른 개념이다(CONTEXT.md "문의 vs 클레임").
 * 이 파일은 서버·클라이언트·어드민이 함께 보는 순수 모듈이라 DB도 env도 모른다.
 *
 * 카테고리·상태 문자열은 DB CHECK 제약과 같은 집합이어야 한다
 * (supabase/migrations/20260818100001_inquiry_threads.sql). 한쪽만 넓히면
 * 새 값이 화면에는 뜨는데 저장이 거절되거나, 저장된 값이 화면에서 사라진다. */

export const INQUIRY_CATEGORIES = [
  { id: 'order', label: '주문/배송' },
  /* "취소/반품/교환"에 관한 질문이다. 클레임 레코드 자체가 아니다 —
     실제 접수는 주문 상세의 청약철회 경로가 담당한다. */
  { id: 'claim', label: '취소/반품/교환' },
  { id: 'good', label: '상품' },
  { id: 'account', label: '계정' },
  { id: 'etc', label: '기타' },
] as const;

export type InquiryCategory = (typeof INQUIRY_CATEGORIES)[number]['id'];

export const INQUIRY_CATEGORY_IDS = INQUIRY_CATEGORIES.map((category) => category.id);

export const INQUIRY_CATEGORY_LABELS = Object.fromEntries(
  INQUIRY_CATEGORIES.map((category) => [category.id, category.label]),
) as Record<InquiryCategory, string>;

export function isInquiryCategory(value: unknown): value is InquiryCategory {
  return typeof value === 'string' && (INQUIRY_CATEGORY_IDS as string[]).includes(value);
}

export function inquiryCategoryLabel(value: string): string {
  return isInquiryCategory(value) ? INQUIRY_CATEGORY_LABELS[value] : '기타';
}

export const INQUIRY_STATUSES = ['open', 'answered', 'closed'] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/* 사용자에게 보이는 말과 운영자에게 보이는 말을 나눈다.
   구매자에게 "미답변"은 운영 사정이고, 구매자가 알아야 하는 것은 "답변 대기"다. */
export const INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  open: '답변 대기',
  answered: '답변 완료',
  closed: '종결',
};

export const ADMIN_INQUIRY_STATUS_LABELS: Record<InquiryStatus, string> = {
  open: '미답변',
  answered: '답변 완료',
  closed: '종결',
};

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return typeof value === 'string' && (INQUIRY_STATUSES as readonly string[]).includes(value);
}

export const MAX_INQUIRY_TITLE_LENGTH = 80;
export const MAX_INQUIRY_BODY_LENGTH = 2000;
export const MAX_INQUIRY_IMAGES = 3;
export const MAX_INQUIRY_IMAGE_BYTES = 5 * 1024 * 1024;

/** 자동 종결까지의 시간. DB의 close_stale_answered_inquiries와 같은 값이다. */
export const INQUIRY_AUTO_CLOSE_DAYS = 7;

/** 1차 답변 SLA. 영업일 기준 24시간이다. */
export const INQUIRY_FIRST_REPLY_BUSINESS_HOURS = 24;

const IMAGE_EXTENSIONS_BY_MIME_TYPE = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

export const INQUIRY_IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';

const IMAGE_ERROR =
  `첨부 이미지는 JPEG, PNG, WebP, GIF 형식의 5MB 이하 파일만 최대 ${MAX_INQUIRY_IMAGES}장까지 올릴 수 있습니다.`;

/**
 * 첨부 업로드 경로.
 *
 * 커뮤니티와 같은 `user-uploads` 버킷을 쓰되 접두는 `<uid>/inquiry/`로 분리한다.
 * 커뮤니티 경로를 재사용하면 커뮤니티 글쓰기를 닫는 운영 스위치가 문의 첨부까지
 * 함께 잠근다 — 성격이 다른 두 판단이 한 스위치에 묶인다.
 */
export function buildInquiryUploadPath({
  userId,
  mimeType,
  nonce,
}: {
  userId: string;
  mimeType: string;
  nonce: string;
}) {
  const extension = IMAGE_EXTENSIONS_BY_MIME_TYPE.get(mimeType) ?? 'bin';
  return `${userId}/inquiry/${nonce}.${extension}`;
}

function isAcceptedImage(file: File) {
  return file.size > 0
    && file.size <= MAX_INQUIRY_IMAGE_BYTES
    && IMAGE_EXTENSIONS_BY_MIME_TYPE.has(file.type);
}

/** FormData의 파일 항목만 걸러 낸다. 빈 file input은 크기 0짜리 File로 들어온다. */
export function inquiryImagesFromFormData(entries: readonly FormDataEntryValue[]): File[] {
  return entries.filter((entry): entry is File => (
    typeof entry === 'object' && entry !== null && 'size' in entry && (entry as File).size > 0
  ));
}

export interface InquiryFormValue {
  category: InquiryCategory;
  title: string;
  body: string;
  orderId: string | null;
  goodId: string | null;
  images: File[];
}

export interface InquiryFormErrors {
  category?: string;
  title?: string;
  body?: string;
  images?: string;
  form?: string;
}

export type InquiryFormResult =
  | { ok: true; value: InquiryFormValue }
  | { ok: false; errors: InquiryFormErrors };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function readUuid(formData: FormData, name: string) {
  const value = readString(formData, name).toLowerCase();
  return UUID_PATTERN.test(value) ? value : null;
}

/**
 * 접수 폼 정규화.
 *
 * 연결 대상(주문·굿즈)은 형식만 본다. 소유 검증은 DB가 한다 — 남의 주문번호를
 * 실은 문의가 어드민 컨텍스트 패널에서 그 주문 요약을 그려 주면 문의 접수만으로
 * 타인 주문을 들여다보는 창이 되므로, 그 판단을 클라이언트 근처에 두지 않는다.
 */
export function normalizeInquiryForm(formData: FormData): InquiryFormResult {
  const category = readString(formData, 'category');
  const title = readString(formData, 'title');
  const body = readString(formData, 'body');
  const images = inquiryImagesFromFormData(formData.getAll('images'));
  const errors: InquiryFormErrors = {};

  if (!isInquiryCategory(category)) errors.category = '문의 유형을 선택해주세요.';
  if (!title) errors.title = '제목을 입력해주세요.';
  else if (title.length > MAX_INQUIRY_TITLE_LENGTH) {
    errors.title = `제목은 ${MAX_INQUIRY_TITLE_LENGTH}자 이내로 입력해주세요.`;
  }
  if (!body) errors.body = '문의 내용을 입력해주세요.';
  else if (body.length > MAX_INQUIRY_BODY_LENGTH) {
    errors.body = `문의 내용은 ${MAX_INQUIRY_BODY_LENGTH}자 이내로 입력해주세요.`;
  }
  if (images.length > MAX_INQUIRY_IMAGES || images.some((image) => !isAcceptedImage(image))) {
    errors.images = IMAGE_ERROR;
  }

  if (Object.keys(errors).length || !isInquiryCategory(category)) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      category,
      title,
      body,
      orderId: readUuid(formData, 'orderId'),
      goodId: readString(formData, 'goodId') || null,
      images,
    },
  };
}

export interface InquiryReplyFormValue {
  inquiryId: string;
  body: string;
  images: File[];
}

export type InquiryReplyFormResult =
  | { ok: true; value: InquiryReplyFormValue }
  | { ok: false; errors: InquiryFormErrors };

export function normalizeInquiryReplyForm(formData: FormData): InquiryReplyFormResult {
  const inquiryId = readUuid(formData, 'inquiryId');
  const body = readString(formData, 'body');
  const images = inquiryImagesFromFormData(formData.getAll('images'));
  const errors: InquiryFormErrors = {};

  if (!inquiryId) errors.form = '문의를 찾을 수 없습니다.';
  if (!body) errors.body = '추가 문의 내용을 입력해주세요.';
  else if (body.length > MAX_INQUIRY_BODY_LENGTH) {
    errors.body = `문의 내용은 ${MAX_INQUIRY_BODY_LENGTH}자 이내로 입력해주세요.`;
  }
  if (images.length > MAX_INQUIRY_IMAGES || images.some((image) => !isAcceptedImage(image))) {
    errors.images = IMAGE_ERROR;
  }

  if (!inquiryId || Object.keys(errors).length) return { ok: false, errors };

  return { ok: true, value: { inquiryId, body, images } };
}

/* ---------------------------------------------------------------------------
 * SLA
 * ------------------------------------------------------------------------- */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/**
 * 1차 답변 기한 — 접수 시각 + 영업일 24시간.
 *
 * 주말은 통째로 건너뛴다. 공휴일은 반영하지 않는다 — 달력을 코드에 박으면 해마다
 * 틀리고, 틀린 기한은 지켜지지 않는 약속보다 나쁘다. 공휴일 보정이 필요해지면
 * 운영 캘린더를 데이터로 들여오는 편이 맞다.
 *
 * KST는 서머타임이 없어 고정 오프셋 산술이 정확하다.
 */
export function inquiryFirstReplyDueAt(
  createdAt: string,
  businessHours: number = INQUIRY_FIRST_REPLY_BUSINESS_HOURS,
): Date | null {
  const start = new Date(createdAt);
  if (Number.isNaN(start.getTime())) return null;

  let cursor = start.getTime();
  let remaining = businessHours * HOUR_MS;

  /* 24영업시간이면 최대 5일치 경계만 넘으면 되지만, 연휴 확장에 대비해 넉넉히 잡는다. */
  for (let guard = 0; guard < 64 && remaining > 0; guard += 1) {
    const shifted = cursor + KST_OFFSET_MS;
    const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
    const nextDayStart = dayStart + DAY_MS;
    const weekday = new Date(dayStart).getUTCDay();

    if (weekday === 0 || weekday === 6) {
      cursor = nextDayStart - KST_OFFSET_MS;
      continue;
    }

    const availableToday = nextDayStart - shifted;
    if (availableToday >= remaining) return new Date(cursor + remaining);

    remaining -= availableToday;
    cursor = nextDayStart - KST_OFFSET_MS;
  }

  return new Date(cursor);
}

export type InquirySlaTone = 'ok' | 'warning' | 'danger' | 'settled';

export interface InquirySlaState {
  tone: InquirySlaTone;
  label: string;
  dueAt: string | null;
}

/**
 * 1차 답변 SLA 상태.
 *
 * 답변이 등록된 뒤에는 기한이 다투는 값이 아니다 — 이미 지났는지만 남는다.
 * 미답변 건은 남은 시간을 보여주되, 기한을 넘긴 건은 "얼마나 넘겼는지"를 말한다.
 * 남은 시간을 0으로 접으면 3시간 늦은 건과 3일 늦은 건이 같아 보인다.
 */
export function inquirySlaState(
  input: { createdAt: string; answeredAt: string | null; status: string },
  now: Date = new Date(),
): InquirySlaState {
  const due = inquiryFirstReplyDueAt(input.createdAt);
  if (!due) return { tone: 'settled', label: '-', dueAt: null };

  const dueAt = due.toISOString();

  if (input.answeredAt) {
    const answered = new Date(input.answeredAt);
    if (Number.isNaN(answered.getTime())) return { tone: 'settled', label: '답변 완료', dueAt };
    return answered.getTime() > due.getTime()
      ? { tone: 'danger', label: `기한 초과 답변 (${durationLabel(answered.getTime() - due.getTime())})`, dueAt }
      : { tone: 'settled', label: '기한 내 답변', dueAt };
  }

  if (input.status === 'closed') return { tone: 'settled', label: '답변 없이 종결', dueAt };

  const remaining = due.getTime() - now.getTime();
  if (remaining <= 0) return { tone: 'danger', label: `기한 초과 ${durationLabel(-remaining)}`, dueAt };
  if (remaining <= 4 * HOUR_MS) return { tone: 'warning', label: `${durationLabel(remaining)} 남음`, dueAt };
  return { tone: 'ok', label: `${durationLabel(remaining)} 남음`, dueAt };
}

function durationLabel(ms: number) {
  const value = Math.max(0, ms);
  if (value < MINUTE_MS) return '1분 미만';
  if (value < HOUR_MS) return `${Math.floor(value / MINUTE_MS)}분`;
  if (value < DAY_MS) return `${Math.floor(value / HOUR_MS)}시간`;
  return `${Math.floor(value / DAY_MS)}일`;
}

/** 접수·최근 메시지로부터 흐른 시간. 어드민 그리드의 경과시간 칸이 쓴다. */
export function inquiryElapsedLabel(value: string, now: Date = new Date()) {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return '-';

  const elapsed = now.getTime() - at.getTime();
  if (elapsed < MINUTE_MS) return '방금';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}분`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}시간`;
  return `${Math.floor(elapsed / DAY_MS)}일`;
}

/** 문의번호 표기. 주문번호(uuid 축약)와 섞이지 않게 `#` 접두를 고정한다. */
export function inquiryReferenceLabel(reference: number) {
  return `#${reference}`;
}

export function formatInquiryDateTime(value: string): string {
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

/** 새 문의 작성 화면 링크. 진입점(마이·주문 상세·굿즈 상세)이 공유한다. */
export function newInquiryHref(options: {
  category?: InquiryCategory;
  orderId?: string | null;
  goodId?: string | null;
} = {}) {
  const params = new URLSearchParams();
  if (options.category) params.set('category', options.category);
  if (options.orderId) params.set('orderId', options.orderId);
  if (options.goodId) params.set('goodId', options.goodId);
  const query = params.toString();
  return query ? `/my/inquiries/new?${query}` : '/my/inquiries/new';
}

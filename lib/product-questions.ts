/* 상품 Q&A의 공용 도메인 모듈(#330).
 *
 * 상품 Q&A는 굿즈 상세에 공개로 남기는 구매 전 질문과 운영자 답변이다(CONTEXT.md).
 * 비공개 1:1 문의와도, 배송완료 후 남기는 리뷰와도 다르다 — 두 표면의 어휘를 이
 * 모듈 안에서 섞지 않는다. 여기서 만드는 문구는 전부 "질문/답변" 계열이다.
 *
 * 서버·클라이언트가 함께 보는 순수 모듈이라 DB도 env도 모른다. 길이 상수는 DB의
 * CHECK 제약과 같은 값이어야 한다(supabase/migrations/20260831100200_product_questions.sql).
 * 한쪽만 넓히면 화면은 통과시키는데 저장이 거절되는 폼이 만들어진다.
 *
 * 작성 자격의 최종 판정은 언제나 서버다(RLS insert 정책). 여기 있는 검사는 그
 * 판정을 미리 보여 주기 위한 것이지 대체하는 것이 아니다. */

export const PRODUCT_QUESTION_STATUSES = ['visible', 'hidden'] as const;
export type ProductQuestionStatus = (typeof PRODUCT_QUESTION_STATUSES)[number];

/* DB의 `char_length(body) between 1 and 1000`과 같은 경계. */
export const MIN_PRODUCT_QUESTION_BODY_LENGTH = 1;
export const MAX_PRODUCT_QUESTION_BODY_LENGTH = 1000;

/** 굿즈 상세 Q&A 탭의 페이지 크기. 같은 탭 줄에 선 리뷰 목록과 같은 관례를 쓴다. */
export const GOOD_QUESTION_PAGE_SIZE = 10;

export function isProductQuestionStatus(value: unknown): value is ProductQuestionStatus {
  return typeof value === 'string' && (PRODUCT_QUESTION_STATUSES as readonly string[]).includes(value);
}

export interface ProductQuestion {
  id: string;
  goodId: string;
  userId: string;
  body: string;
  status: ProductQuestionStatus;
  answerBody: string | null;
  answeredAt: string | null;
  createdAt: string;
  /** 목록에 그릴 작성자 표시명. */
  authorName: string;
}

/**
 * 내 Q&A 목록의 한 줄 — 질문에 대상 굿즈를 붙인다.
 *
 * 작성자 표시명이 없다. 전부 내 글이라 이 화면에는 그릴 자리가 없고, 쓰지도 않을
 * 이름을 채우면 어딘가에서 "내 닉네임" 대신 마스킹된 이름이 새어 나온다.
 */
export interface MyProductQuestion extends Omit<ProductQuestion, 'authorName'> {
  goodName: string;
  goodPath: string;
}

/* ---------------------------------------------------------------------------
 * 작성자 표시명
 * ------------------------------------------------------------------------- */

/**
 * 작성자 표시명.
 *
 * 리뷰(good_reviews RPC)가 쓰는 규칙을 그대로 미러한다 — 닉네임이 있으면 그대로
 * 쓰고, 없으면 `fan_` + 사용자 id 앞 6자다. 같은 굿즈 상세에서 리뷰는 닉네임을
 * 그대로 보여 주는데 Q&A만 별표로 가리면 같은 사람이 두 이름으로 보인다.
 */
export function productQuestionAuthorName({
  nickname,
  userId,
}: {
  nickname: string | null | undefined;
  userId: string;
}): string {
  const trimmed = (nickname ?? '').trim();
  if (trimmed) return trimmed;
  return `fan_${userId.slice(0, 6)}`;
}

/* ---------------------------------------------------------------------------
 * 상태 표기
 * ------------------------------------------------------------------------- */

export type ProductQuestionState = 'awaiting' | 'answered' | 'hidden';

export const PRODUCT_QUESTION_STATE_LABELS: Record<ProductQuestionState, string> = {
  awaiting: '답변 대기',
  answered: '답변 완료',
  /* 작성자 본인 화면에서만 쓴다. 공개 목록에는 블라인드된 글이 실리지 않는다. */
  hidden: '비공개 처리됨',
};

/**
 * 한 질문의 표시 상태.
 *
 * 블라인드가 답변 여부를 이긴다 — 답변이 달린 뒤 내려간 글에 "답변 완료"만 적으면
 * 작성자는 자기 글이 왜 굿즈 상세에서 사라졌는지 알 방법이 없다.
 */
export function productQuestionState(question: {
  status: ProductQuestionStatus;
  answerBody: string | null;
}): ProductQuestionState {
  if (question.status === 'hidden') return 'hidden';
  return question.answerBody ? 'answered' : 'awaiting';
}

export function questionStateLabel(question: {
  status: ProductQuestionStatus;
  answerBody: string | null;
}): string {
  return PRODUCT_QUESTION_STATE_LABELS[productQuestionState(question)];
}

/* ---------------------------------------------------------------------------
 * 목록 URL
 * ------------------------------------------------------------------------- */

type SearchParamValue = string | string[] | undefined;

export interface GoodQuestionListOptions {
  page: number;
}

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

/** 굿즈 상세 Q&A 탭의 페이지. 모르는 값은 1로 접는다. */
export function normalizeGoodQuestionOptions(
  searchParams: Record<string, SearchParamValue>,
): GoodQuestionListOptions {
  const rawPage = Number(singleParam(searchParams.qnaPage));
  return { page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1 };
}

/**
 * Q&A 링크. 굿즈 상세로 돌아가되 Q&A 조건만 싣는다.
 *
 * 1페이지에서도 `qnaPage`를 뺀 "깨끗한" URL을 만들지 않는다 — 굿즈 상세는 이
 * 파라미터가 있어야 Q&A 탭에서 열리고(GoodDetail.pdpDefaultPanelId), 파라미터가
 * 없으면 `#qna` 앵커가 숨겨진 패널 안을 가리켜 클릭이 아무 일도 하지 않는다.
 */
export function goodQuestionsHref(goodId: string, page = 1) {
  return `/shop/${goodId}?qnaPage=${Math.max(1, page)}#qna`;
}

/**
 * 숫자 페이저에 그릴 페이지 번호.
 *
 * 항상 같은 개수를 유지한다 — 끝 페이지에서 창이 줄어들면 페이저 폭이 흔들려
 * 다음 클릭 지점이 이동한다(리뷰 페이저와 같은 규칙).
 */
export function productQuestionPageWindow(current: number, pageCount: number, span = 5): number[] {
  const size = Math.min(span, Math.max(1, pageCount));
  const start = Math.max(1, Math.min(current - Math.floor(size / 2), pageCount - size + 1));
  return Array.from({ length: size }, (_, index) => start + index);
}

/* ---------------------------------------------------------------------------
 * 표시 헬퍼
 * ------------------------------------------------------------------------- */

export function formatProductQuestionDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(date);
}

/* ---------------------------------------------------------------------------
 * 폼 정규화
 * ------------------------------------------------------------------------- */

export interface ProductQuestionFormErrors {
  body?: string;
  form?: string;
}

export interface ProductQuestionFormValue {
  goodId: string;
  body: string;
}

export type ProductQuestionFormResult =
  | { ok: true; value: ProductQuestionFormValue }
  | { ok: false; errors: ProductQuestionFormErrors };

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeProductQuestionForm(formData: FormData): ProductQuestionFormResult {
  const goodId = readString(formData, 'goodId');
  const body = readString(formData, 'body');
  const errors: ProductQuestionFormErrors = {};

  if (!goodId) errors.form = '질문을 남길 굿즈를 찾을 수 없습니다.';
  if (!body) errors.body = '질문 내용을 입력해주세요.';
  else if (body.length > MAX_PRODUCT_QUESTION_BODY_LENGTH) {
    errors.body = `질문은 ${MAX_PRODUCT_QUESTION_BODY_LENGTH}자 이내로 입력해주세요.`;
  }

  if (Object.keys(errors).length || !goodId) return { ok: false, errors };
  return { ok: true, value: { goodId, body } };
}

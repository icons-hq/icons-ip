import { isUuid } from '@/lib/uuid';

export const REVIEW_EVENTS_ADMIN_PATH = '/admin/cs/review-events';
export const REVIEW_EVENTS_PATH = '/review-events';
export const REVIEW_EVENT_STATES = ['scheduled', 'active', 'closed', 'ready', 'announced', 'archived'] as const;
export type ReviewEventState = typeof REVIEW_EVENT_STATES[number];
export const reviewEventStateLabel: Record<ReviewEventState, string> = { scheduled: '진행예정', active: '진행중', closed: '응모마감', ready: '발표대기', announced: '당첨자발표', archived: '보관' };
export interface ReviewEventValues {
  title: string; description: string; targetType: 'all' | 'goods' | 'categories';
  goodIds: string[]; categoryIds: string[]; startsOn: string; endsOn: string; announcesOn: string;
  plannedWinners: number; creditAmount: number; creditValidityDays: number; bannerStyle: 'basic' | 'emphasis';
}
export interface ReviewEvent extends ReviewEventValues {
  id: string; number: number; revision: number; createdAt: string; updatedAt: string; archivedAt: string | null; announcedAt: string | null;
  state: ReviewEventState; canEdit: boolean; entryCount: number; selectedCount: number; awardedCount: number; revokedCount: number;
}
export interface PublicReviewEvent extends Omit<ReviewEventValues, 'targetType' | 'goodIds' | 'categoryIds'> {
  id: string; state: Exclude<ReviewEventState, 'archived'>; announcedAt: string | null; nextChangeAt: string | null;
}
export interface ReviewEventSelection { id: string; reviewUpdatedAt: string; reviewFingerprint: string }
export interface ReviewEventTarget { id: string; label: string; code: string }
export interface ReviewEventEntry {
  id: string; reviewId: string | null; userId: string; goodId: string; goodName: string; nickname: string;
  body: string | null; rating: number | null; imagePaths: string[]; imageUrls?: string[];
  enteredAt: string; reviewUpdatedAt: string | null; reviewFingerprint: string;
  selected: boolean; selectionReason: string | null; selectionChanged: boolean; problem: string | null;
  creditAmount: number; grantedAt: string | null; revokedAt: string | null; revokeReason: string | null; expiresAt: string | null;
}
export interface ReviewEventWorkspace {
  event: ReviewEvent; total: number; page: number; pageSize: 50; canPay: boolean;
  creditPolicy: { enabled: boolean; maxBalance: number | null; validityDays: number | null };
  selected: ReviewEventSelection[]; rows: ReviewEventEntry[];
}
export interface ReviewEventFilters { query: string; state: 'all' | ReviewEventState; dateField: 'created' | 'start' | 'end' | 'announce'; from: string; to: string; page: number; pageSize: 20 | 50 | 100 }
export interface ReviewEventList { total: number; rows: ReviewEvent[]; filters: ReviewEventFilters }
export interface PublicReviewEventList { total: number; rows: PublicReviewEvent[]; nextChangeAt: string | null; unavailable?: boolean }
export interface PublicReviewEventDetail { event: PublicReviewEvent; winnerTotal: number; winnerPage: number; winners: { reviewId: string; goodId: string; goodName: string; nickname: string; body: string }[] }
export interface GoodsReviewEvents { rows: { goodId: string; event: PublicReviewEvent }[]; nextChangeAt: string | null; unavailable?: boolean }
export interface ReviewEventDisclosure { eventTitle: string; revoked: boolean; unavailable?: boolean }
export interface MyReviewEventEntry {
  reviewId: string; eventId: string; title: string; creditAmount: number; announcesOn: string; state: ReviewEventState;
  grantedAt: string | null; revokedAt: string | null; revokeReason: string | null; expiresAt: string | null;
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
const instant = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const nullableInstant = (value: unknown): boolean => value === null || instant(value);
const goodId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,199}$/.test(value);
const text = (value: unknown, min: number, max: number): value is string => typeof value === 'string' && [...value].length >= min && [...value].length <= max && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const uniqueIds = (value: unknown, maximum: number, valid: (value: unknown) => boolean): value is string[] => Array.isArray(value) && value.length <= maximum && value.every(valid) && new Set(value).size === value.length;
export function isReviewEventDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function reviewEventDayOffset(day: string, offset: number): string { return new Date(Date.parse(`${day}T00:00:00Z`) + offset * 86400000).toISOString().slice(0, 10); }
export function reviewEventToday(now = Date.now()): string { return new Date(now + 9 * 3600000).toISOString().slice(0, 10); }
export function newReviewEventValues(today = reviewEventToday()): ReviewEventValues {
  return { title: '', description: '', targetType: 'all', goodIds: [], categoryIds: [], startsOn: reviewEventDayOffset(today, 1), endsOn: reviewEventDayOffset(today, 8),
    announcesOn: reviewEventDayOffset(today, 11), plannedWinners: 10, creditAmount: 1000, creditValidityDays: 30, bannerStyle: 'basic' };
}
export function parseReviewEventValues(value: unknown, allowRemovedTargets = false): ReviewEventValues | null {
  if (!object(value) || !text(value.title, 1, 15) || !text(value.description, 1, 30) || !['all', 'goods', 'categories'].includes(String(value.targetType))
    || !['basic', 'emphasis'].includes(String(value.bannerStyle)) || !isReviewEventDate(value.startsOn) || !isReviewEventDate(value.endsOn) || !isReviewEventDate(value.announcesOn)
    || value.endsOn < reviewEventDayOffset(value.startsOn, 1) || value.endsOn > reviewEventDayOffset(value.startsOn, 31)
    || value.announcesOn < reviewEventDayOffset(value.endsOn, 3) || value.announcesOn > reviewEventDayOffset(value.endsOn, 10)
    || !integer(value.plannedWinners, 1, 1000) || !integer(value.creditAmount, 1, 999999999999) || !integer(value.creditValidityDays, 1, 36500)
    || !uniqueIds(value.goodIds, 500, goodId) || !uniqueIds(value.categoryIds, 500, isUuid)
    || value.targetType !== 'goods' && value.goodIds.length > 0 || value.targetType !== 'categories' && value.categoryIds.length > 0
    || !allowRemovedTargets && (value.targetType === 'goods' && !value.goodIds.length || value.targetType === 'categories' && !value.categoryIds.length)) return null;
  return { title: value.title, description: value.description, targetType: value.targetType as ReviewEventValues['targetType'], goodIds: value.goodIds, categoryIds: value.categoryIds,
    startsOn: value.startsOn, endsOn: value.endsOn, announcesOn: value.announcesOn, plannedWinners: value.plannedWinners, creditAmount: value.creditAmount,
    creditValidityDays: value.creditValidityDays, bannerStyle: value.bannerStyle as ReviewEventValues['bannerStyle'] };
}
/* R6: 등록 화면이 저장 전에 같은 규칙으로 필드별 이유를 보여 준다. parseReviewEventValues·DB
   private.review_event_values_valid·admin_save_review_event와 기준이 같아야 한다. */
export type ReviewEventField = 'title' | 'description' | 'target' | 'startsOn' | 'endsOn' | 'announcesOn' | 'plannedWinners' | 'creditAmount' | 'creditValidityDays';
export type ReviewEventFieldErrors = Partial<Record<ReviewEventField | 'form', string>>;
export interface ReviewEventCreditPolicy { enabled: boolean; maxBalance: number | null; validityDays: number | null }
/** 메뉴 경로는 사이드바 그대로다(대분류 > 메뉴). 적립금 정책은 관리자 전용 메뉴라 그렇게 밝힌다 — 매니저는 메뉴가 보이지 않는다. */
export const REVIEW_EVENT_CREDIT_POLICY_OFF = '적립금 정책이 꺼져 있어 리뷰이벤트를 저장할 수 없습니다. 혜택/마케팅 > 적립금 정책(관리자)에서 켠 뒤 저장하세요.';
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** 제목·내용 앞뒤 공백 때문에 저장 전체가 실패하지 않도록, 검증 전에 잘라 낸다. 내부 공백은 그대로 둔다. */
export function trimReviewEventText(values: ReviewEventValues): ReviewEventValues {
  return { ...values, title: values.title.trim(), description: values.description.trim() };
}
export function reviewEventFieldErrors(values: ReviewEventValues, today = reviewEventToday()): ReviewEventFieldErrors {
  const errors: ReviewEventFieldErrors = {};
  if (!text(values.title, 1, 15)) errors.title = '이벤트명은 1~15자로 입력하세요. 줄바꿈·제어 문자는 쓸 수 없습니다.';
  if (!text(values.description, 1, 30)) errors.description = '내용은 1~30자로 입력하세요. 줄바꿈·제어 문자는 쓸 수 없습니다.';
  if (values.targetType === 'goods' && !values.goodIds.length) errors.target = '이벤트 대상 상품을 1개 이상 고르세요.';
  if (values.targetType === 'categories' && !values.categoryIds.length) errors.target = '이벤트 대상 카테고리를 1개 이상 고르세요.';
  if (!isReviewEventDate(values.startsOn) || values.startsOn <= today) errors.startsOn = '시작일은 내일(한국 시각)부터 고를 수 있습니다.';
  if (!isReviewEventDate(values.endsOn) || !isReviewEventDate(values.startsOn)
    || values.endsOn < reviewEventDayOffset(values.startsOn, 1) || values.endsOn > reviewEventDayOffset(values.startsOn, 31)) errors.endsOn = '종료일은 시작일 +1~31일 사이로 고르세요.';
  if (!isReviewEventDate(values.announcesOn) || !isReviewEventDate(values.endsOn)
    || values.announcesOn < reviewEventDayOffset(values.endsOn, 3) || values.announcesOn > reviewEventDayOffset(values.endsOn, 10)) errors.announcesOn = '발표일은 종료일 +3~10일 사이로 고르세요.';
  if (!integer(values.plannedWinners, 1, 1000)) errors.plannedWinners = '선정 예정 인원은 1~1,000명 사이 정수로 입력하세요.';
  if (!integer(values.creditAmount, 1, 999999999999)) errors.creditAmount = '1인당 적립금은 1원 이상 정수로 입력하세요.';
  if (!integer(values.creditValidityDays, 1, 36500)) errors.creditValidityDays = '지급 후 유효기간은 1일 이상 정수로 입력하세요.';
  return errors;
}
/** 시작일을 바꾸면 종료·발표일이 기존 간격을 유지한 채 허용 범위(+1~31일, +3~10일) 안으로 따라 움직인다. */
export function withReviewEventStartsOn(values: ReviewEventValues, startsOn: string): ReviewEventValues {
  if (!isReviewEventDate(startsOn)) return { ...values, startsOn };
  const duration = isReviewEventDate(values.startsOn) && isReviewEventDate(values.endsOn) ? daysBetween(values.startsOn, values.endsOn) : 7;
  const endsOn = reviewEventDayOffset(startsOn, clamp(duration, 1, 31));
  const wait = isReviewEventDate(values.endsOn) && isReviewEventDate(values.announcesOn) ? daysBetween(values.endsOn, values.announcesOn) : 3;
  return { ...values, startsOn, endsOn, announcesOn: reviewEventDayOffset(endsOn, clamp(wait, 3, 10)) };
}
/** 종료일을 바꿨을 때 발표일이 범위(+3~10일)를 벗어나면 가장 이른 발표일로 옮긴다. 범위 안이면 그대로 둔다. */
export function withReviewEventEndsOn(values: ReviewEventValues, endsOn: string): ReviewEventValues {
  if (!isReviewEventDate(endsOn)) return { ...values, endsOn };
  const inRange = isReviewEventDate(values.announcesOn) && values.announcesOn >= reviewEventDayOffset(endsOn, 3) && values.announcesOn <= reviewEventDayOffset(endsOn, 10);
  return { ...values, endsOn, announcesOn: inRange ? values.announcesOn : reviewEventDayOffset(endsOn, 3) };
}
export function parseReviewEventCreditPolicy(value: unknown): ReviewEventCreditPolicy | null {
  if (!object(value) || typeof value.enabled !== 'boolean' || value.maxBalance !== null && !integer(value.maxBalance)
    || value.validityDays !== null && !integer(value.validityDays, 1, 36500)) return null;
  return { enabled: value.enabled, maxBalance: value.maxBalance as number | null, validityDays: value.validityDays as number | null };
}
export function reviewEventCreditPolicyLabel(policy: ReviewEventCreditPolicy): string {
  if (!policy.enabled) return '적립금 정책: 꺼짐';
  return `적립금 정책: 켜짐 · 보유 상한 ${policy.maxBalance === null ? '-' : `${policy.maxBalance.toLocaleString('ko-KR')}원`} · 유효기간 ${policy.validityDays === null ? '-' : `${policy.validityDays.toLocaleString('ko-KR')}일`}`;
}
/** DB가 거절할 정책 조건(꺼짐·적립금 > 보유 상한·유효기간 > 정책 유효기간)을 저장 전에 알린다. 정책을 못 읽었으면(null) 서버 판단에 맡긴다. */
export function reviewEventCreditPolicyProblem(values: ReviewEventValues, policy: ReviewEventCreditPolicy | null): ReviewEventFieldErrors {
  if (!policy) return {};
  if (!policy.enabled) return { form: REVIEW_EVENT_CREDIT_POLICY_OFF };
  const errors: ReviewEventFieldErrors = {};
  if (policy.maxBalance !== null && values.creditAmount > policy.maxBalance) errors.creditAmount = `1인당 적립금이 적립금 정책의 보유 상한 ${policy.maxBalance.toLocaleString('ko-KR')}원을 넘습니다.`;
  if (policy.validityDays !== null && values.creditValidityDays > policy.validityDays) errors.creditValidityDays = `지급 후 유효기간이 적립금 정책의 유효기간 ${policy.validityDays.toLocaleString('ko-KR')}일을 넘습니다.`;
  return errors;
}
export function parseReviewEvent(value: unknown): ReviewEvent | null {
  if (!object(value) || !isUuid(value.id) || !integer(value.number, 1) || !integer(value.revision, 1) || !instant(value.createdAt) || !instant(value.updatedAt)
    || !nullableInstant(value.archivedAt) || !nullableInstant(value.announcedAt) || !REVIEW_EVENT_STATES.includes(value.state as ReviewEventState)
    || typeof value.canEdit !== 'boolean' || ![value.entryCount, value.selectedCount, value.awardedCount, value.revokedCount].every(item => integer(item))) return null;
  return parseReviewEventValues(value, true) ? value as unknown as ReviewEvent : null;
}
export function parseReviewEventSelection(value: unknown): ReviewEventSelection[] | null {
  if (!Array.isArray(value) || value.length > 1000 || new Set(value.map(item => item?.id)).size !== value.length
    || value.some(item => !object(item) || !isUuid(item.id) || !instant(item.reviewUpdatedAt) || typeof item.reviewFingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(item.reviewFingerprint))) return null;
  return value as ReviewEventSelection[];
}
export function parseReviewEventWorkspace(value: unknown): ReviewEventWorkspace | null {
  if (!object(value) || !parseReviewEvent(value.event) || !integer(value.total) || !integer(value.page, 1) || value.pageSize !== 50 || typeof value.canPay !== 'boolean'
    || !object(value.creditPolicy) || typeof value.creditPolicy.enabled !== 'boolean' || value.creditPolicy.maxBalance !== null && !integer(value.creditPolicy.maxBalance)
    || value.creditPolicy.validityDays !== null && !integer(value.creditPolicy.validityDays, 1, 36500) || !parseReviewEventSelection(value.selected)
    || !Array.isArray(value.rows) || value.rows.length > 50 || value.rows.length > value.total) return null;
  for (const row of value.rows) {
    if (!object(row) || !isUuid(row.id) || row.reviewId !== null && !isUuid(row.reviewId) || !isUuid(row.userId) || !goodId(row.goodId)
      || typeof row.goodName !== 'string' || typeof row.nickname !== 'string' || row.body !== null && typeof row.body !== 'string'
      || row.rating !== null && !integer(row.rating, 1, 5) || !instant(row.enteredAt) || !nullableInstant(row.reviewUpdatedAt)
      || typeof row.reviewFingerprint !== 'string' || !/^[0-9a-f]{32}$/.test(row.reviewFingerprint)
      || !Array.isArray(row.imagePaths) || row.imagePaths.some(path => typeof path !== 'string') || typeof row.selected !== 'boolean' || typeof row.selectionChanged !== 'boolean'
      || row.selectionReason !== null && typeof row.selectionReason !== 'string' || row.problem !== null && typeof row.problem !== 'string'
      || !integer(row.creditAmount, 1, 999999999999) || ![row.grantedAt, row.revokedAt, row.expiresAt].every(nullableInstant) || row.revokeReason !== null && typeof row.revokeReason !== 'string') return null;
  }
  return value as unknown as ReviewEventWorkspace;
}
export function parsePublicReviewEvent(value: unknown): PublicReviewEvent | null {
  if (!object(value) || !isUuid(value.id) || !text(value.title, 1, 15) || !text(value.description, 1, 30) || !isReviewEventDate(value.startsOn) || !isReviewEventDate(value.endsOn) || !isReviewEventDate(value.announcesOn)
    || !integer(value.creditAmount, 1, 999999999999) || !integer(value.creditValidityDays, 1, 36500) || !integer(value.plannedWinners, 1, 1000)
    || !['basic', 'emphasis'].includes(String(value.bannerStyle)) || !['scheduled', 'active', 'closed', 'ready', 'announced'].includes(String(value.state))
    || !nullableInstant(value.announcedAt) || !nullableInstant(value.nextChangeAt)) return null;
  return value as unknown as PublicReviewEvent;
}
export function normalizeReviewEventFilters(raw: Record<string, string | string[] | undefined>): ReviewEventFilters {
  const get = (key: string) => typeof raw[key] === 'string' ? raw[key].trim() : '';
  const state = get('state'), dateField = get('dateField'), page = Number(get('page')), size = Number(get('pageSize'));
  const from = isReviewEventDate(get('from')) ? get('from') : ''; let to = isReviewEventDate(get('to')) ? get('to') : ''; if (from && to && from > to) to = from;
  return { query: get('q').slice(0, 100), state: REVIEW_EVENT_STATES.includes(state as ReviewEventState) ? state as ReviewEventState : 'all',
    dateField: ['created', 'start', 'end', 'announce'].includes(dateField) ? dateField as ReviewEventFilters['dateField'] : 'created', from, to,
    page: integer(page, 1, 100000) ? page : 1, pageSize: [20, 50, 100].includes(size) ? size as 20 | 50 | 100 : 20 };
}
export function reviewEventAdminHref(filters: ReviewEventFilters, page = filters.page) {
  return `${REVIEW_EVENTS_ADMIN_PATH}?${new URLSearchParams({ q: filters.query, state: filters.state, dateField: filters.dateField, from: filters.from, to: filters.to, page: String(page), pageSize: String(filters.pageSize) })}`;
}
export function reviewEventProblemLabel(problem: string | null): string {
  return ({ review_deleted: '리뷰 삭제', review_hidden: '리뷰 비공개', review_changed: '리뷰 정보 변경', purchase_ineligible: '취소·반품 또는 구매 자격 변경', customer_unavailable: '고객 계정 이용 불가', good_unavailable: '상품 공개 상태 변경' } as Record<string, string>)[problem ?? ''] ?? (problem ? '자격 확인 필요' : '선정 가능');
}
export function reviewEventError(message: string | undefined): string {
  const errors: Record<string, string> = {
    review_event_changed: '다른 운영자가 변경했습니다. 입력은 유지됩니다. 최신 이벤트를 다시 열어 확인해주세요.',
    review_event_review_changed: '선정한 리뷰가 변경되었습니다. 최신 리뷰를 확인하고 선정을 다시 저장해주세요.',
    review_event_terms_locked: '이벤트가 시작되면 조건을 바꾸거나 보관할 수 없습니다.',
    review_event_start_tomorrow: '이벤트는 한국 시각으로 내일부터 시작할 수 있습니다.',
    review_event_credit_policy: '적립금 정책의 활성 여부·보유 상한·유효기간을 확인해주세요.',
    invalid_review_event: '입력값을 확인해주세요. 이벤트명 1~15자, 내용 1~30자, 종료일은 시작일 +1~31일, 발표일은 종료일 +3~10일입니다.',
    review_event_selection_closed: '응모 마감 후, 발표 전에만 선정을 저장할 수 있습니다.',
    review_event_publish_not_ready: '발표일 이후에만 발표 및 지급할 수 있습니다.',
    review_event_entry_ineligible: '선정 대상의 리뷰·구매·고객 상태가 바뀌었습니다. 최신 응모 현황에서 확인해주세요.',
    review_event_customer_once: '한 이벤트에서는 고객 한 명당 리뷰 하나만 선정할 수 있습니다.',
    review_event_target_missing: '선택한 상품이나 카테고리가 보관·삭제되었습니다.',
    store_credit_balance_limit: '일부 고객의 적립금 보유 상한을 넘었습니다. 전체 지급과 발표가 취소되었으니 대상 잔액을 확인해주세요.',
    store_credit_disabled: '적립금 정책이 비활성 상태입니다. 지급과 발표는 반영되지 않았습니다.',
    account_suspended: '일부 고객의 계정이 정지되었습니다. 전체 지급과 발표는 반영되지 않았습니다.',
    account_deletion_in_progress: '탈퇴 처리 중인 고객이 있습니다. 전체 지급과 발표는 반영되지 않았습니다.',
  };
  return errors[message ?? ''] ?? '입력값과 현재 권한을 확인해주세요. 입력과 기존 선정은 유지됩니다.';
}

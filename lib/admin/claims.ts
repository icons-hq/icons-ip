import {
  ORDER_CLAIM_STAGE_LABELS,
  ORDER_CLAIM_STAGES,
  ORDER_CLAIM_TYPE_SLUGS,
  isOpenOrderClaimStage,
  type OrderClaimRefundMethod,
  type OrderClaimStage,
  type OrderClaimType,
} from '@/lib/orders/claims';
import {
  ORDER_WITHDRAWAL_REASON_LABELS,
  ORDER_WITHDRAWAL_REASON_TYPES,
  type OrderWithdrawalReasonType,
} from '@/lib/orders';

/**
 * 어드민 클레임 콘솔(#252) — 취소·반품·교환 3화면이 같은 필터 모델을 쓴다.
 *
 * 화면이 셋인 이유는 처리 절차가 다르기 때문이지 데이터가 다르기 때문이 아니다.
 * 필터·정렬·페이지네이션은 전부 URL에 남는다 — 운영자가 "기한 초과 반품만"을
 * 동료에게 링크로 넘길 수 있어야 한다.
 */

export const ADMIN_CLAIM_PAGE_SIZE = 20;

export type AdminClaimStageFilter = OrderClaimStage | 'all' | 'open';
export type AdminClaimReasonFilter = OrderWithdrawalReasonType | 'all';

/** 기본 필터는 미처리다. 이 화면의 존재 이유가 "지금 처리할 것"이기 때문이다. */
export const DEFAULT_ADMIN_CLAIM_STAGE: AdminClaimStageFilter = 'open';

export const ADMIN_CLAIM_STAGE_OPTIONS: { value: AdminClaimStageFilter; label: string }[] = [
  { value: 'open', label: '미처리 전체' },
  { value: 'all', label: '전체' },
  ...ORDER_CLAIM_STAGES.map((stage) => ({
    value: stage as AdminClaimStageFilter,
    label: ORDER_CLAIM_STAGE_LABELS[stage],
  })),
];

export const ADMIN_CLAIM_REASON_OPTIONS: { value: AdminClaimReasonFilter; label: string }[] = [
  { value: 'all', label: '전체' },
  ...ORDER_WITHDRAWAL_REASON_TYPES.map((reasonType) => ({
    value: reasonType as AdminClaimReasonFilter,
    label: ORDER_WITHDRAWAL_REASON_LABELS[reasonType],
  })),
];

export const ADMIN_CLAIM_SEARCH_FIELDS = [
  { value: 'all', label: '전체' },
  { value: 'order', label: '주문·클레임번호' },
  { value: 'buyer', label: '구매자' },
];

export interface AdminClaimFilters {
  stage: AdminClaimStageFilter;
  reasonType: AdminClaimReasonFilter;
  from: string | null;
  to: string | null;
  query: string;
  page: number;
}

export interface AdminClaimRow {
  id: string;
  reference: number;
  orderId: string;
  claimType: OrderClaimType;
  stage: OrderClaimStage;
  reasonType: OrderWithdrawalReasonType;
  buyerName: string;
  buyerEmail: string | null;
  orderStatus: string;
  orderTotal: number;
  requestedAt: string;
  collectedAt: string | null;
  completedAt: string | null;
  refundMethod: OrderClaimRefundMethod | null;
  handlerName: string | null;
}

export interface AdminClaimConsoleData {
  claimType: OrderClaimType;
  filters: AdminClaimFilters;
  rows: AdminClaimRow[];
  pageSize: number;
  total: number;
  /** 단계별 건수. 0건도 그대로 싣는다 — 감추면 집계 실패와 구분되지 않는다. */
  counts: Record<OrderClaimStage, number>;
}

type SearchParamValue = string | string[] | undefined;

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const STAGE_FILTERS = new Set<string>(['all', 'open', ...ORDER_CLAIM_STAGES]);
const REASON_FILTERS = new Set<string>(['all', ...ORDER_WITHDRAWAL_REASON_TYPES]);

function singleParam(value: SearchParamValue) {
  return typeof value === 'string' ? value : '';
}

function validCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function normalizedDate(value: SearchParamValue) {
  const candidate = singleParam(value);
  return validCalendarDate(candidate) ? candidate : null;
}

/** URL 파라미터를 화면이 믿을 수 있는 필터로 좁힌다. 주문·문의 콘솔과 같은 규율이다. */
export function normalizeAdminClaimFilters(
  searchParams: Record<string, SearchParamValue>,
): AdminClaimFilters {
  let from = normalizedDate(searchParams.from);
  let to = normalizedDate(searchParams.to);
  /* 뒤집힌 기간은 RPC가 거절한다. 화면이 오류로 죽는 대신 조건을 버린다. */
  if (from && to && from > to) {
    from = null;
    to = null;
  }

  const rawStage = singleParam(searchParams.stage);
  const rawReason = singleParam(searchParams.reasonType);
  const rawQuery = singleParam(searchParams.query).trim();
  const rawPage = Number(singleParam(searchParams.page));

  return {
    stage: STAGE_FILTERS.has(rawStage)
      ? rawStage as AdminClaimStageFilter
      : DEFAULT_ADMIN_CLAIM_STAGE,
    reasonType: REASON_FILTERS.has(rawReason) ? rawReason as AdminClaimReasonFilter : 'all',
    from,
    to,
    query: rawQuery.length <= 100 ? rawQuery : '',
    page: Number.isSafeInteger(rawPage) && rawPage > 0 ? rawPage : 1,
  };
}

export function adminClaimBasePath(claimType: OrderClaimType) {
  return `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[claimType]}`;
}

export function adminClaimHref(
  claimType: OrderClaimType,
  filters: AdminClaimFilters,
  overrides: Partial<AdminClaimFilters> = {},
) {
  const next = { ...filters, ...overrides };
  const params = new URLSearchParams();
  params.set('stage', next.stage);
  if (next.reasonType !== 'all') params.set('reasonType', next.reasonType);
  if (next.from) params.set('from', next.from);
  if (next.to) params.set('to', next.to);
  if (next.query) params.set('query', next.query);
  params.set('page', String(next.page));
  return `${adminClaimBasePath(claimType)}?${params.toString()}`;
}

/** 상세로 갈 때 목록 조건을 잃지 않게 필터를 그대로 실어 보낸다. */
export function adminClaimDetailHref(
  claimType: OrderClaimType,
  claimId: string,
  filters?: AdminClaimFilters,
) {
  const base = `${adminClaimBasePath(claimType)}/${claimId}`;
  if (!filters) return base;
  const back = adminClaimHref(claimType, filters).split('?')[1] ?? '';
  return back ? `${base}?back=${encodeURIComponent(back)}` : base;
}

const BACK_PARAM_KEYS = ['stage', 'reasonType', 'from', 'to', 'query', 'page'] as const;

/**
 * `?back=`으로 돌아온 목록 조건.
 *
 * URL에서 온 값이라 그대로 되살리지 않는다. 경로는 항상 해당 클레임 목록으로
 * 고정하고, 아는 필터 키만 통과시켜 다시 정규화한다 — 모르는 파라미터를 실어
 * 나르면 목록 URL이 임의 입력의 운반 수단이 된다.
 */
export function adminClaimBackHref(claimType: OrderClaimType, back: unknown) {
  if (typeof back !== 'string' || !back.trim()) return adminClaimBasePath(claimType);

  const source = new URLSearchParams(back);
  const known: Record<string, string> = {};
  for (const key of BACK_PARAM_KEYS) {
    const value = source.get(key);
    if (value) known[key] = value;
  }

  return adminClaimHref(claimType, normalizeAdminClaimFilters(known));
}

/** 구매자 표기. 닉네임이 비면 주문 콘솔과 같은 fan_ 축약(구매자 id 앞 6자)을 쓴다. */
export function adminClaimBuyerLabel(name: string | null, buyerId: string) {
  return name?.trim() || `fan_${buyerId.slice(0, 6)}`;
}

/** 칩에 쓰는 미처리 합계. `open` 필터가 가리키는 집합과 같은 정의를 쓴다. */
export function adminClaimOpenCount(counts: Record<OrderClaimStage, number>) {
  return ORDER_CLAIM_STAGES
    .filter((stage) => isOpenOrderClaimStage(stage))
    .reduce((total, stage) => total + (counts[stage] ?? 0), 0);
}

/* ---------------------------------------------------------------------------
 * 폼 정규화 — 콘솔 액션이 DB에 닿기 전에 입력을 좁힌다
 * ------------------------------------------------------------------------- */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TRACKING_NUMBER_PATTERN = /^[A-Z0-9]{8,30}$/;

export type AdminClaimFormResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function readString(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

export const ADMIN_CLAIM_DECISIONS = ['review', 'approve', 'reject', 'hold', 'resume'] as const;
export type AdminClaimDecision = (typeof ADMIN_CLAIM_DECISIONS)[number];

/**
 * 거부·보류는 사유가 필수다(10~200자).
 *
 * DB도 같은 길이로 다시 검증한다. 여기서 먼저 거르는 이유는 운영자가 어느 칸이
 * 문제인지 알아야 하기 때문이지, DB 검증을 대신하기 위해서가 아니다.
 */
export function normalizeAdminClaimDecisionForm(
  formData: FormData,
): AdminClaimFormResult<{ claimId: string; decision: AdminClaimDecision; note: string | null }> {
  const claimId = readString(formData, 'claimId').toLowerCase();
  const decision = readString(formData, 'decision');
  const note = readString(formData, 'note');

  if (!UUID_PATTERN.test(claimId)) return { ok: false, error: '클레임을 찾을 수 없습니다.' };
  if (!(ADMIN_CLAIM_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: '처리할 수 없는 결정입니다.' };
  }
  if ((decision === 'reject' || decision === 'hold') && (note.length < 10 || note.length > 200)) {
    return {
      ok: false,
      error: decision === 'reject'
        ? '거부 사유를 10자 이상 200자 이하로 입력해주세요.'
        : '보류 사유를 10자 이상 200자 이하로 입력해주세요.',
    };
  }

  return {
    ok: true,
    value: {
      claimId,
      decision: decision as AdminClaimDecision,
      note: note.length > 0 ? note : null,
    },
  };
}

export function normalizeAdminClaimRefundForm(
  formData: FormData,
): AdminClaimFormResult<{
  claimId: string;
  method: OrderClaimRefundMethod;
  stage: 'filed' | 'completed';
  note: string | null;
}> {
  const claimId = readString(formData, 'claimId').toLowerCase();
  const method = readString(formData, 'method');
  const stage = readString(formData, 'stage');
  const note = readString(formData, 'note');

  if (!UUID_PATTERN.test(claimId)) return { ok: false, error: '클레임을 찾을 수 없습니다.' };
  if (method !== 'pg_cancel' && method !== 'bank_transfer') {
    return { ok: false, error: '환불 수단을 선택해주세요.' };
  }
  if (stage !== 'filed' && stage !== 'completed') {
    return { ok: false, error: '처리할 수 없는 환불 단계입니다.' };
  }
  if (note.length > 300) {
    return { ok: false, error: '상계·정산 메모는 300자 이내로 입력해주세요.' };
  }

  return {
    ok: true,
    value: {
      claimId,
      method,
      stage,
      note: note.length > 0 ? note : null,
    },
  };
}

export function normalizeAdminClaimReshipmentForm(
  formData: FormData,
): AdminClaimFormResult<{ claimId: string; carrier: string; trackingNumber: string }> {
  const claimId = readString(formData, 'claimId').toLowerCase();
  const carrier = readString(formData, 'carrier');
  const trackingNumber = readString(formData, 'trackingNumber').toUpperCase();

  if (!UUID_PATTERN.test(claimId)) return { ok: false, error: '클레임을 찾을 수 없습니다.' };
  if (!carrier) return { ok: false, error: '택배사를 선택해주세요.' };
  if (!TRACKING_NUMBER_PATTERN.test(trackingNumber)) {
    return { ok: false, error: '운송장번호를 영문 대문자와 숫자 8~30자로 입력해주세요.' };
  }

  return { ok: true, value: { claimId, carrier, trackingNumber } };
}

export function normalizeAdminClaimCollectionForm(
  formData: FormData,
): AdminClaimFormResult<{ claimId: string; stage: 'collecting' | 'collected' }> {
  const claimId = readString(formData, 'claimId').toLowerCase();
  const stage = readString(formData, 'stage');

  if (!UUID_PATTERN.test(claimId)) return { ok: false, error: '클레임을 찾을 수 없습니다.' };
  if (stage !== 'collecting' && stage !== 'collected') {
    return { ok: false, error: '처리할 수 없는 수거 단계입니다.' };
  }

  return { ok: true, value: { claimId, stage } };
}

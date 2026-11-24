import { CRON_JOBS, systemJobLabel } from '@/lib/system-health/cron-jobs';
import { isUuid } from '@/lib/uuid';

/*
 * 시스템 상태 화면(원장 OPS-039·OPS-040·PAY-067·PAY-063·CUS-066)의 읽기 모델.
 * DB 판정(admin_system_health·admin_unresolved_payment_attempts)을 검증해 화면 값으로 바꾼다. 형식이 틀리면 null — 화면은
 * '불러오지 못했습니다'를 보이고 상태를 정상처럼 보이지 않는다.
 */

export const SYSTEM_HEALTH_PATH = '/admin/settings/system';

export type SystemJobSource = 'vercel_cron' | 'pg_cron';
export type SystemJobState = 'failing' | 'stalled' | 'ok' | 'unrecorded' | 'inactive';

export interface SystemJob {
  jobKey: string;
  source: SystemJobSource;
  label: string;
  schedule: string | null;
  expectedIntervalMinutes: number | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastStatusCode: number | null;
  lastErrorCode: string | null;
  failures24h: number;
  failing: boolean;
  stalled: boolean;
  active: boolean;
  /** 실행 기록이 한 번이라도 있는가(Vercel cron은 배포 뒤 첫 실행 전, 로컬·preview에서는 없다). */
  recorded: boolean;
}

export interface SystemJobFailure {
  jobKey: string;
  source: SystemJobSource;
  label: string;
  occurredAt: string;
  statusCode: number | null;
  errorCode: string;
}

export interface SystemHealthReport {
  asOf: string;
  jobs: SystemJob[];
  recentFailures: SystemJobFailure[];
  payments: { goods: number; tickets: number; other: number; oldestAt: string | null };
  emails: { failed24h: number; bounced24h: number };
  /** 가상계좌 환불 송금 확인 필요(실패·7일 지연·결제사 기록 불일치, ADR-0049 결정 5 보강). 예전 판정에는 없어 0으로 읽는다. */
  refunds: { virtualAccountFailed: number; oldestAt: string | null };
  /**
   * 가상계좌 입금 오류 되돌림 중 시스템이 끝내지 못한 것(확인 필요 + 입금 기한 + 2시간이 지나도 열린 자동 처리, ADR-0049 결정 4).
   * 예전 판정에는 없어 0으로 읽는다.
   */
  depositReversals: { review: number; oldestAt: string | null };
  counts: { failingJobs: number; stalledJobs: number; problemJobs: number; unresolvedPayments: number; emailFailures: number; emailBounces: number; refundFailures: number; depositReversalReviews: number; issues: number };
}

export const SYSTEM_JOB_STATE_LABELS: Record<SystemJobState, string> = {
  failing: '실패 중', stalled: '멈춤', ok: '정상', unrecorded: '기록 없음', inactive: '꺼짐',
};
export const SYSTEM_JOB_SOURCE_LABELS: Record<SystemJobSource, string> = { vercel_cron: '앱 자동 작업', pg_cron: 'DB 자동 작업' };

export function systemJobState(job: Pick<SystemJob, 'failing' | 'stalled' | 'active' | 'recorded'>): SystemJobState {
  if (!job.active) return 'inactive';
  if (job.failing) return 'failing';
  if (job.stalled) return 'stalled';
  return job.recorded ? 'ok' : 'unrecorded';
}

/** 오류 코드를 운영자 말로. 모르는 코드는 코드 그대로 보인다(개발팀에 그대로 전달). */
export function systemErrorCodeLabel(code: string | null): string | null {
  if (!code) return null;
  if (code === 'unhealthy_result') return '일부 건 처리 실패';
  if (code === 'pg_cron_failed') return 'DB 작업 실패';
  if (code === 'rows_skipped') return '일부 건 건너뜀';
  if (code === 'reconciliation_candidates_unavailable') return '재확인 대상 조회 실패';
  // 토스 에스크로 부가서비스 API 키(TOSS_ESCROW_SECRET_KEY) — 런북 '가상계좌' 절의 키 등록 단계로 고친다.
  if (code === 'toss_escrow_key_missing') return '에스크로 API 키 없음(배송 등록 대기 중)';
  if (code === 'toss_escrow_key_rejected') return '토스가 API 키를 거절함(키 확인 필요)';
  if (code.startsWith('exception')) return '처리 중 오류';
  if (code.startsWith('db:') || code.startsWith('sqlstate_')) return `DB 오류(${code.replace(/^(db:|sqlstate_)/, '')})`;
  return code;
}

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const optionalTime = (value: unknown): string | null | undefined => value === null || value === undefined ? null : isTime(value) ? value : undefined;
const count = (value: unknown): number | undefined => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const optionalCount = (value: unknown): number | null | undefined => value === null || value === undefined ? null : count(value);
const optionalString = (value: unknown, max = 200): string | null | undefined =>
  value === null || value === undefined ? null : typeof value === 'string' && value.length <= max ? value : undefined;

function parseJob(value: unknown): SystemJob | null {
  if (!isObject(value)) return null;
  const source = value.source;
  if (source !== 'vercel_cron' && source !== 'pg_cron') return null;
  const jobKey = optionalString(value.jobKey);
  const schedule = optionalString(value.schedule);
  const recordedLabel = optionalString(value.label, 60);
  const fields = {
    lastRunAt: optionalTime(value.lastRunAt), lastSuccessAt: optionalTime(value.lastSuccessAt), lastFailureAt: optionalTime(value.lastFailureAt),
    expectedIntervalMinutes: optionalCount(value.expectedIntervalMinutes), lastStatusCode: optionalCount(value.lastStatusCode),
    lastErrorCode: optionalString(value.lastErrorCode, 64),
  };
  const failures24h = count(value.failures24h);
  if (!jobKey || schedule === undefined || recordedLabel === undefined || failures24h === undefined
    || Object.values(fields).some(field => field === undefined)
    || typeof value.failing !== 'boolean' || typeof value.stalled !== 'boolean'
    || (value.active !== undefined && typeof value.active !== 'boolean')) return null;
  return {
    jobKey, source, label: systemJobLabel(jobKey, source, recordedLabel), schedule,
    expectedIntervalMinutes: fields.expectedIntervalMinutes!, lastRunAt: fields.lastRunAt!, lastSuccessAt: fields.lastSuccessAt!,
    lastFailureAt: fields.lastFailureAt!, lastStatusCode: fields.lastStatusCode!, lastErrorCode: fields.lastErrorCode!,
    failures24h, failing: value.failing, stalled: value.stalled, active: value.active !== false,
    recorded: source === 'pg_cron' ? fields.lastRunAt !== null : true,
  };
}

function parseFailure(value: unknown): SystemJobFailure | null {
  if (!isObject(value)) return null;
  const { jobKey, source, occurredAt, statusCode, errorCode } = value;
  const status = optionalCount(statusCode);
  if (typeof jobKey !== 'string' || !jobKey || jobKey.length > 200 || (source !== 'vercel_cron' && source !== 'pg_cron') || !isTime(occurredAt)
    || status === undefined || typeof errorCode !== 'string' || !/^[A-Za-z0-9_.:-]{1,64}$/.test(errorCode)) return null;
  return { jobKey, source, label: systemJobLabel(jobKey, source), occurredAt, statusCode: status, errorCode };
}

/** 판정 결과를 검증하고, 아직 기록이 없는 앱 자동 작업(작업 목록에만 있는 것)을 '기록 없음'으로 채운다. */
export function parseSystemHealthReport(value: unknown): SystemHealthReport | null {
  if (!isObject(value) || !isTime(value.asOf) || !Array.isArray(value.jobs) || !Array.isArray(value.recentFailures)
    || !isObject(value.payments) || !isObject(value.emails) || !isObject(value.counts)) return null;
  const jobs = value.jobs.map(parseJob);
  const failures = value.recentFailures.map(parseFailure);
  const payments = { goods: count(value.payments.goods), tickets: count(value.payments.tickets), other: count(value.payments.other), oldestAt: optionalTime(value.payments.oldestAt) };
  const emails = { failed24h: count(value.emails.failed24h), bounced24h: count(value.emails.bounced24h) };
  const refundSource = isObject(value.refunds) ? value.refunds : { virtualAccountFailed: 0, oldestAt: null };
  const refunds = { virtualAccountFailed: count(refundSource.virtualAccountFailed), oldestAt: optionalTime(refundSource.oldestAt) };
  const reversalSource = isObject(value.depositReversals) ? value.depositReversals : { review: 0, oldestAt: null };
  const depositReversals = { review: count(reversalSource.review), oldestAt: optionalTime(reversalSource.oldestAt) };
  const rawCounts = { refundFailures: 0, depositReversalReviews: 0, ...(value.counts as Record<string, unknown>) };
  const counts = Object.fromEntries(['failingJobs', 'stalledJobs', 'problemJobs', 'unresolvedPayments', 'emailFailures', 'emailBounces', 'refundFailures', 'depositReversalReviews', 'issues']
    .map(key => [key, count(rawCounts[key as keyof typeof rawCounts])]));
  if (jobs.some(job => !job) || failures.some(failure => !failure)
    || (value.refunds !== undefined && !isObject(value.refunds))
    || (value.depositReversals !== undefined && !isObject(value.depositReversals))
    || [payments.goods, payments.tickets, payments.other, payments.oldestAt, emails.failed24h, emails.bounced24h, refunds.virtualAccountFailed, refunds.oldestAt,
      depositReversals.review, depositReversals.oldestAt]
      .some(field => field === undefined)
    || Object.values(counts).some(field => field === undefined)) return null;
  const parsedJobs = jobs as SystemJob[];
  for (const [jobKey, job] of Object.entries(CRON_JOBS)) {
    if (parsedJobs.some(row => row.source === 'vercel_cron' && row.jobKey === jobKey)) continue;
    parsedJobs.push({
      jobKey, source: 'vercel_cron', label: job.label, schedule: null, expectedIntervalMinutes: job.intervalMinutes,
      lastRunAt: null, lastSuccessAt: null, lastFailureAt: null, lastStatusCode: null, lastErrorCode: null,
      failures24h: 0, failing: false, stalled: false, active: true, recorded: false,
    });
  }
  const rank: Record<SystemJobState, number> = { failing: 0, stalled: 1, unrecorded: 2, ok: 3, inactive: 4 };
  parsedJobs.sort((a, b) => rank[systemJobState(a)] - rank[systemJobState(b)] || a.source.localeCompare(b.source) || a.label.localeCompare(b.label, 'ko'));
  return {
    asOf: value.asOf, jobs: parsedJobs, recentFailures: failures as SystemJobFailure[],
    payments: payments as SystemHealthReport['payments'], emails: emails as SystemHealthReport['emails'],
    refunds: refunds as SystemHealthReport['refunds'],
    depositReversals: depositReversals as SystemHealthReport['depositReversals'],
    counts: counts as SystemHealthReport['counts'],
  };
}

// --- 미종결 결제 시도 ---------------------------------------------------------------------------------------------------

/* awaiting_deposit: 입금 기한이 2시간 넘게 지났는데 닫히지 않은 토스 가상계좌 입금 대기(ADR-0049). 자동 재확인이 멈춘 신호다. */
export type UnresolvedPaymentReason = 'unknown' | 'needs_review' | 'confirming_stalled' | 'awaiting_deposit';
const UNRESOLVED_PAYMENT_REASONS = new Set<string>(['unknown', 'needs_review', 'confirming_stalled', 'awaiting_deposit']);
export const UNRESOLVED_PAYMENT_REASON_LABELS: Record<UnresolvedPaymentReason, string> = {
  unknown: '결제 결과 불명', needs_review: '결제사·주문 불일치', confirming_stalled: '확인 처리 멈춤', awaiting_deposit: '입금 기한 지남(가상계좌)',
};
export const UNRESOLVED_PAYMENT_REASON_HINTS: Record<UnresolvedPaymentReason, string> = {
  unknown: '결제사에서 결과를 받지 못했습니다. 결제 상태 다시 확인을 누르면 결제사에 조회해 승인 또는 취소로 확정합니다.',
  needs_review: '결제사 결과가 주문과 맞지 않습니다(금액·주문 불일치 등). 다시 확인해도 같으면 결제사 관리자 화면에서 거래를 확인해주세요.',
  confirming_stalled: '승인 확인 처리가 끝나지 않고 멈췄습니다. 결제 상태 다시 확인을 누르면 결제사에 조회해 마무리합니다.',
  awaiting_deposit: '가상계좌 입금 기한이 2시간 넘게 지났는데 자동 재확인이 주문을 닫지 못했습니다. [결제 상태 다시 확인]을 눌러 결제사 상태를 다시 조회하고, 그래도 남아 있으면 토스페이먼츠 상점관리자에서 이 결제의 입금 여부를 확인한 뒤 개발 담당자에게 알려주세요.',
};
export const PAYMENT_PURPOSE_LABELS: Record<string, string> = { order: '상품 주문', ticket: '티켓 예매', prize_sale: '실물 쿠지', wallet: '폐기된 결제 유형' };
export const PAYMENT_PROVIDER_LABELS: Record<string, string> = { toss: '토스페이먼츠', nicepay: '나이스페이', korpay: '코페이', bank_transfer: '무통장입금' };

export interface UnresolvedPaymentAttempt {
  attemptId: string;
  purpose: string;
  provider: string;
  state: string;
  reason: UnresolvedPaymentReason;
  amount: number;
  currency: string;
  refId: string | null;
  orderNumber: string | null;
  createdAt: string;
  updatedAt: string;
  claimExpiresAt: string | null;
  lastCheckedAt: string | null;
  reconcilable: boolean;
}
export interface UnresolvedPaymentAttemptList { total: number; asOf: string; items: UnresolvedPaymentAttempt[] }

function parseAttempt(value: unknown): UnresolvedPaymentAttempt | null {
  if (!isObject(value)) return null;
  const { attemptId, purpose, provider, state, reason, amount, currency, refId, orderNumber, createdAt, updatedAt, claimExpiresAt, lastCheckedAt, reconcilable } = value;
  const claim = optionalTime(claimExpiresAt);
  const checked = optionalTime(lastCheckedAt);
  const number = optionalString(orderNumber, 60);
  if (!isUuid(attemptId) || typeof purpose !== 'string' || typeof provider !== 'string' || typeof state !== 'string'
    || typeof reason !== 'string' || !UNRESOLVED_PAYMENT_REASONS.has(reason)
    || count(amount) === undefined || typeof currency !== 'string' || (refId !== null && !isUuid(refId))
    || number === undefined || !isTime(createdAt) || !isTime(updatedAt) || claim === undefined || checked === undefined
    || typeof reconcilable !== 'boolean') return null;
  return {
    attemptId, purpose, provider, state, reason: reason as UnresolvedPaymentReason, amount: amount as number, currency, refId: refId as string | null, orderNumber: number,
    createdAt, updatedAt, claimExpiresAt: claim, lastCheckedAt: checked,
    reconcilable,
  };
}

export function parseUnresolvedPaymentAttempts(value: unknown): UnresolvedPaymentAttemptList | null {
  if (!isObject(value) || count(value.total) === undefined || !isTime(value.asOf) || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseAttempt);
  if (items.some(item => !item) || items.length > (value.total as number)) return null;
  return { total: value.total as number, asOf: value.asOf, items: items as UnresolvedPaymentAttempt[] };
}

// --- 가상계좌 환불 송금 확인 필요 -------------------------------------------------------------------------------------------

export const VIRTUAL_ACCOUNT_REFUND_FAILURE_CODES = ['refund_failed', 'refund_partial_failed', 'refund_overdue', 'payment_mismatch'] as const;
export type VirtualAccountRefundFailureCode = (typeof VIRTUAL_ACCOUNT_REFUND_FAILURE_CODES)[number];
const REFUND_FAILURE_CODE_SET = new Set<string>(VIRTUAL_ACCOUNT_REFUND_FAILURE_CODES);
export const VIRTUAL_ACCOUNT_REFUND_FAILURE_SHORT_LABELS: Record<VirtualAccountRefundFailureCode, string> = {
  refund_failed: '은행 송금 실패', refund_partial_failed: '일부 송금 실패', refund_overdue: '7일째 송금 확인 안 됨', payment_mismatch: '결제사 기록 불일치',
};

export interface VirtualAccountRefundFailure {
  orderId: string;
  orderNumber: string | null;
  amount: number;
  failureCode: VirtualAccountRefundFailureCode;
  refundedAt: string;
  failedAt: string;
}
export interface VirtualAccountRefundFailureList { total: number; items: VirtualAccountRefundFailure[] }

function parseRefundFailure(value: unknown): VirtualAccountRefundFailure | null {
  if (!isObject(value)) return null;
  const { orderId, orderNumber, amount, failureCode, refundedAt, failedAt } = value;
  const number = optionalString(orderNumber, 60);
  if (!isUuid(orderId) || number === undefined || count(amount) === undefined
    || typeof failureCode !== 'string' || !REFUND_FAILURE_CODE_SET.has(failureCode) || !isTime(refundedAt) || !isTime(failedAt)) return null;
  return { orderId, orderNumber: number, amount: amount as number, failureCode: failureCode as VirtualAccountRefundFailureCode, refundedAt, failedAt };
}

/** `admin_virtual_account_refund_failures` 응답. 형식이 어긋나면 null(화면이 '불러오지 못했다'고 안내한다). */
export function parseVirtualAccountRefundFailures(value: unknown): VirtualAccountRefundFailureList | null {
  if (!isObject(value) || count(value.total) === undefined || !Array.isArray(value.items)) return null;
  const items = value.items.map(parseRefundFailure);
  if (items.some(item => !item) || items.length > (value.total as number)) return null;
  return { total: value.total as number, items: items as VirtualAccountRefundFailure[] };
}

/** "3일 4시간", "2시간 5분", "12분" — 기준 시각에서 얼마나 지났는가. */
export function formatElapsed(since: string, asOf: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(since)) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return hours ? `${days}일 ${hours}시간` : `${days}일`;
  if (hours) return rest ? `${hours}시간 ${rest}분` : `${hours}시간`;
  return `${rest}분`;
}

/** 일정·주기를 운영자 말로. */
export function formatJobInterval(minutes: number | null): string {
  if (!minutes) return '—';
  if (minutes % 1440 === 0) return minutes === 1440 ? '매일' : `${minutes / 1440}일마다`;
  if (minutes % 60 === 0) return minutes === 60 ? '매시간' : `${minutes / 60}시간마다`;
  return minutes === 1 ? '매분' : `${minutes}분마다`;
}

// --- 결제 상태 다시 확인 결과 ---------------------------------------------------------------------------------------------

export const PAYMENT_RECONCILE_OUTCOME_MESSAGES: Record<string, string> = {
  approved: '결제사에서 승인이 확인되어 결제를 확정했습니다.',
  declined: '결제사에서 승인되지 않은 결제로 확인되어 결제 없이 닫았습니다. 잡혀 있던 재고·쿠폰이 풀립니다.',
  canceled: '결제사에서 취소된 결제로 확인되어 결제 없이 닫았습니다. 잡혀 있던 재고·쿠폰이 풀립니다.',
  unknown: '결제사에서 아직 결과를 받지 못했습니다. 잠시 뒤 다시 확인해주세요(자동으로도 계속 다시 확인합니다).',
  needs_review: '결제사 결과가 주문과 맞지 않습니다. 결제사 관리자 화면에서 거래를 확인한 뒤 개발팀에 전달해주세요.',
};

export function paymentReconcileError(code?: string | null, message?: string | null): string {
  if (code === '42501' || message === 'operator_capability_required') return '결제 상태를 다시 확인할 권한이 없습니다.';
  if (message === 'payment_reconciliation_cooldown') return '방금 확인한 결제입니다. 1분 뒤 다시 시도해주세요.';
  if (message === 'payment_attempt_not_unresolved') return '이미 처리 중이거나 끝난 결제입니다. 화면을 새로고침해주세요.';
  if (message === 'payment_attempt_not_found') return '결제 시도를 찾지 못했습니다. 화면을 새로고침해주세요.';
  if (message === 'payment_reconciliation_operation_conflict') return '다른 요청과 겹쳤습니다. 화면을 새로고침한 뒤 다시 시도해주세요.';
  return '결제 상태를 다시 확인하지 못했습니다. 잠시 뒤 다시 시도해주세요.';
}

/*
 * 운영 알림 요약 메일(OPS-095) — 설정 문서 해석과 입력 검사. 근거는 migration 20261119107000 머리말.
 * 받는 주소 입력·발송 상태 이름은 안전재고 요약 메일(lib/admin/stock-safety-digest)과 같은 것을 쓴다.
 */
import { STOCK_DIGEST_ERROR_LABELS, STOCK_DIGEST_STATUS_LABELS, parseRecipientList, type StockDigestDeliveryStatus } from './stock-safety-digest';

export const OPS_ALERT_DIGEST_RECIPIENT_LIMIT = 10;
export const OPS_ALERT_DIGEST_DEFAULT_DELAY_HOURS = 4;
export const OPS_ALERT_DIGEST_MIN_DELAY_HOURS = 1;
export const OPS_ALERT_DIGEST_MAX_DELAY_HOURS = 72;
export { parseRecipientList };
export const OPS_ALERT_DIGEST_STATUS_LABELS = STOCK_DIGEST_STATUS_LABELS;
export const OPS_ALERT_DIGEST_ERROR_LABELS: Record<string, string> = { ...STOCK_DIGEST_ERROR_LABELS, digest_expired: '6시간이 지나 보내지 않음' };

export const OPS_ALERT_DIGEST_CATEGORIES = ['inquiries', 'questions', 'delay', 'system'] as const;
export type OpsAlertDigestCategory = (typeof OPS_ALERT_DIGEST_CATEGORIES)[number];
export const OPS_ALERT_DIGEST_CATEGORY_LABELS: Record<OpsAlertDigestCategory, string> = {
  inquiries: '새 1:1 문의', questions: '새 상품 문의', delay: '답변 지연', system: '시스템 장애',
};
export const OPS_ALERT_DIGEST_CATEGORY_HINTS: Record<OpsAlertDigestCategory, string> = {
  inquiries: '고객이 새로 남기거나 다시 연 1:1 문의가 있으면 건수만 알립니다.',
  questions: '상품 상세에 새 상품 문의가 올라오면 건수만 알립니다.',
  delay: '답변을 기다리는 문의가 아래 기준 시간을 넘기면 문의당 한 번만 알립니다.',
  system: '자동 작업 실패·멈춤(앱 자동 작업과 DB 작업 모두), 메일 발송 실패, 미종결 결제를 건수와 작업 이름으로 알립니다. 시스템 상태 화면과 같은 기준입니다. 작업 실패·멈춤과 미종결 결제는 이어지면 한 시간에 한 번씩 다시 알리고, 메일 발송 실패는 새 실패가 생길 때만 알립니다.',
};

export interface OpsAlertDigestDelivery { recipient: string; status: StockDigestDeliveryStatus; errorCode: string | null; attempts: number; updatedAt: string }
export interface OpsAlertDigestRun {
  runId: string; createdAt: string;
  counts: { inquiries: number; questions: number; delayedInquiries: number; delayedQuestions: number; system: number };
  deliveries: OpsAlertDigestDelivery[];
}
export interface OpsAlertDigestSettings {
  revision: number; enabled: boolean; recipients: string[]; categories: OpsAlertDigestCategory[]; delayHours: number;
  enabledAt: string | null; updatedAt: string; updatedByName: string | null; runs: OpsAlertDigestRun[];
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | null => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
const int = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const time = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const strings = (value: unknown): string[] | null => Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value as string[] : null;

function parseRun(value: unknown): OpsAlertDigestRun | null {
  const row = record(value); const counts = record(row?.counts); const createdAt = time(row?.createdAt);
  if (!row || !counts || !createdAt || typeof row.runId !== 'string' || !Array.isArray(row.deliveries)) return null;
  const parsed = { inquiries: int(counts.inquiries), questions: int(counts.questions), delayedInquiries: int(counts.delayedInquiries),
    delayedQuestions: int(counts.delayedQuestions), system: int(counts.system) };
  if (Object.values(parsed).some((entry) => entry === null)) return null;
  const deliveries: OpsAlertDigestDelivery[] = [];
  for (const entry of row.deliveries) {
    const delivery = record(entry); const attempts = int(delivery?.attempts); const updatedAt = time(delivery?.updatedAt);
    if (!delivery || typeof delivery.recipient !== 'string' || attempts === null || !updatedAt || typeof delivery.status !== 'string'
      || !Object.hasOwn(STOCK_DIGEST_STATUS_LABELS, delivery.status) || (delivery.errorCode !== null && typeof delivery.errorCode !== 'string')) return null;
    deliveries.push({ recipient: delivery.recipient, status: delivery.status as StockDigestDeliveryStatus, errorCode: delivery.errorCode as string | null, attempts, updatedAt });
  }
  return { runId: row.runId, createdAt, counts: parsed as OpsAlertDigestRun['counts'], deliveries };
}

export function parseOpsAlertDigestSettings(value: unknown): OpsAlertDigestSettings | null {
  const row = record(value);
  if (!row || !Array.isArray(row.runs)) return null;
  const revision = int(row.revision); const recipients = strings(row.recipients); const categories = strings(row.categories);
  const delayHours = int(row.delayHours); const updatedAt = time(row.updatedAt);
  const enabledAt = row.enabledAt === null ? null : time(row.enabledAt);
  if (revision === null || revision < 1 || !recipients || !categories || delayHours === null || !updatedAt || typeof row.enabled !== 'boolean'
    || (row.enabledAt !== null && !enabledAt) || (row.updatedByName !== null && typeof row.updatedByName !== 'string')
    || !categories.every((category): category is OpsAlertDigestCategory => (OPS_ALERT_DIGEST_CATEGORIES as readonly string[]).includes(category))) return null;
  const runs = row.runs.map(parseRun);
  if (runs.some((run) => !run)) return null;
  return { revision, enabled: row.enabled, recipients, categories, delayHours, enabledAt, updatedAt,
    updatedByName: row.updatedByName as string | null, runs: runs as OpsAlertDigestRun[] };
}

/** 설정 화면을 떠날 때의 보호: 고친 입력·결과 불명 저장은 묻고, 저장 요청이 진행 중이면 묻지 않고 막는다(재시도용 요청 ID 보존). */
export function opsAlertDigestLeaveGuard({ changed, uncertain, pending }: { changed: boolean; uncertain: boolean; pending: boolean }) {
  return { dirty: changed || uncertain, blocked: pending };
}

export function isOpsAlertDigestDelayHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= OPS_ALERT_DIGEST_MIN_DELAY_HOURS && value <= OPS_ALERT_DIGEST_MAX_DELAY_HOURS;
}

export function opsAlertDigestErrorMessage(error: { code?: unknown; message?: unknown } | null | undefined): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === '42501' || code === '28000' || message.includes('operator_capability_required')) return '운영 알림 메일 설정은 계정 주매니저 이상만 바꿀 수 있습니다.';
  if (code === 'PT409' || message.includes('ops_alert_digest_changed')) return '다른 운영자가 먼저 설정을 바꿨습니다. 새로고침한 뒤 다시 저장해주세요.';
  if (message.includes('operation_conflict')) return '같은 요청이 다른 내용으로 이미 처리됐습니다. 새로고침한 뒤 다시 저장해주세요.';
  if (message.includes('ops_alert_recipient_limit')) return `받는 주소는 최대 ${OPS_ALERT_DIGEST_RECIPIENT_LIMIT}개까지 넣을 수 있습니다. 주소를 줄여 다시 저장해주세요.`;
  if (message.includes('invalid_ops_alert_recipient')) return '형식이 맞지 않는 메일 주소가 있습니다. name@example.com처럼 한 줄에 하나씩 넣어 다시 저장해주세요.';
  if (message.includes('invalid_ops_alert_category')) return '알릴 범주를 하나 이상 골라주세요.';
  if (message.includes('invalid_ops_alert_digest')) return `답변 지연 기준 시간은 ${OPS_ALERT_DIGEST_MIN_DELAY_HOURS}~${OPS_ALERT_DIGEST_MAX_DELAY_HOURS}시간 사이로 넣어주세요.`;
  return '운영 알림 메일 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
}

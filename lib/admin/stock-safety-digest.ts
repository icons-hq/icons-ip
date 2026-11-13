/*
 * 안전재고 하루 1회 요약 메일(QNA-014) — 설정 문서 해석과 입력 검사.
 *
 * 매일 설정 시각(KST)이 지나면 그날 한 번, 안전재고 기준 이하 옵션을 운영자 수신 주소(전체)와
 * 출고지 담당자 주소(그 출고지 상품만)로 보낸다. 기본은 꺼짐·09:00이다(근거는 migration 20261112161000 머리말).
 * 수신 주소가 비어 있거나 대상 옵션이 없으면 보내지 않는다. 같은 날·같은 주소에는 한 번만 보낸다(DB 멱등) —
 * 한 주소가 여러 출고지 담당이면 그 출고지들의 옵션을 한 통에 담는다.
 */

export const STOCK_SAFETY_DIGEST_DEFAULT_TIME = '09:00';
export const STOCK_DIGEST_OPERATOR_RECIPIENT_LIMIT = 10;
export const STOCK_DIGEST_ORIGIN_RECIPIENT_LIMIT = 5;
/** 메일 한 통에 싣는 옵션 수(DB `stock_safety_digest_job_items`와 같다). */
export const STOCK_DIGEST_EMAIL_ITEM_LIMIT = 300;

const EMAIL = /^[^@\s,;<>"\u0000-\u001f\u007f]{1,64}@[^@\s,;<>"\u0000-\u001f\u007f]+\.[^@\s,;<>".\u0000-\u001f\u007f]+$/;

/** 쉼표·세미콜론·줄바꿈으로 나눈 주소 목록을 소문자·중복 제거로 정리한다. 틀린 주소는 따로 돌려준다. */
export function parseRecipientList(value: string, limit: number): { ok: true; recipients: string[] } | { ok: false; error: string } {
  const recipients: string[] = [];
  for (const part of value.split(/[\s,;]+/)) {
    const address = part.trim().toLowerCase();
    if (!address) continue;
    if (address.length > 254 || !EMAIL.test(address)) return { ok: false, error: `메일 주소 형식을 확인해주세요: ${address.slice(0, 60)}` };
    if (!recipients.includes(address)) recipients.push(address);
  }
  if (recipients.length > limit) return { ok: false, error: `받는 주소는 ${limit}개까지 넣을 수 있습니다.` };
  return { ok: true, recipients };
}

export function isDigestSendTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export type StockDigestDeliveryStatus = 'queued' | 'processing' | 'sent' | 'failed' | 'unknown' | 'suppressed';
export const STOCK_DIGEST_STATUS_LABELS: Record<StockDigestDeliveryStatus, string> = {
  queued: '발송 대기', processing: '발송 중', sent: '보냄', failed: '보내지 못함', unknown: '결과 확인 필요', suppressed: '수신 거부',
};
export const STOCK_DIGEST_ERROR_LABELS: Record<string, string> = {
  provider_not_configured: '메일 발송 설정 전',
  delivery_disabled: '요약 메일이 꺼져 있음',
  provider_retryable: '메일 서버 일시 오류(다시 시도)',
  provider_rejected: '메일 서버가 거절',
  provider_suppressed: '수신 거부 주소',
  delivery_in_progress: '발송 처리 중',
  delivery_needs_review: '결과 확인 필요',
  delivery_outcome_unknown: '발송 결과 불명',
  digest_expired: '하루가 지나 보내지 않음',
};

export interface StockDigestDelivery {
  /** 출고지 담당자 메일이면 그 주소가 맡은 출고지 이름들(운영자 메일은 빈 배열). */
  audience: 'operator' | 'origin'; originNames: string[]; recipient: string; itemCount: number;
  status: StockDigestDeliveryStatus; errorCode: string | null; attempts: number; updatedAt: string;
}
export interface StockDigestRun { digestDate: string; createdAt: string; itemCount: number; deliveries: StockDigestDelivery[] }
export interface StockDigestOrigin { originId: string; originCode: string; originName: string; active: boolean; revision: number; recipients: string[] }
export interface StockSafetyDigestSettings {
  revision: number; enabled: boolean; sendTime: string; operatorRecipients: string[]; enabledAt: string | null; updatedAt: string;
  updatedByName: string | null; nextSendAt: string | null; lowStockCount: number; origins: StockDigestOrigin[]; runs: StockDigestRun[];
}

type JsonRecord = Record<string, unknown>;
function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null;
}
function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string') ? value as string[] : null;
}
function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
function time(value: unknown): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
}

export function parseStockDigestOrigin(value: unknown): StockDigestOrigin | null {
  const row = record(value);
  const recipients = strings(row?.recipients); const revision = int(row?.revision);
  if (!row || typeof row.originId !== 'string' || typeof row.originCode !== 'string' || typeof row.originName !== 'string'
    || typeof row.active !== 'boolean' || recipients === null || revision === null) return null;
  return { originId: row.originId, originCode: row.originCode, originName: row.originName, active: row.active, revision, recipients };
}

function parseDelivery(value: unknown): StockDigestDelivery | null {
  const row = record(value);
  const itemCount = int(row?.itemCount); const attempts = int(row?.attempts); const updatedAt = time(row?.updatedAt);
  const originNames = strings(row?.originNames);
  if (!row || (row.audience !== 'operator' && row.audience !== 'origin') || typeof row.recipient !== 'string'
    || itemCount === null || attempts === null || !updatedAt || typeof row.status !== 'string' || !Object.hasOwn(STOCK_DIGEST_STATUS_LABELS, row.status)
    || originNames === null || (row.errorCode !== null && typeof row.errorCode !== 'string')) return null;
  return { audience: row.audience, originNames, recipient: row.recipient, itemCount,
    status: row.status as StockDigestDeliveryStatus, errorCode: row.errorCode as string | null, attempts, updatedAt };
}

export function parseStockSafetyDigestSettings(value: unknown): StockSafetyDigestSettings | null {
  const row = record(value);
  if (!row || !Array.isArray(row.origins) || !Array.isArray(row.runs)) return null;
  const revision = int(row.revision); const lowStockCount = int(row.lowStockCount); const operatorRecipients = strings(row.operatorRecipients);
  const updatedAt = time(row.updatedAt);
  const enabledAt = row.enabledAt === null ? null : time(row.enabledAt);
  const nextSendAt = row.nextSendAt === null ? null : time(row.nextSendAt);
  if (revision === null || revision < 1 || lowStockCount === null || !operatorRecipients || !updatedAt || typeof row.enabled !== 'boolean'
    || !isDigestSendTime(row.sendTime) || (row.enabledAt !== null && !enabledAt) || (row.nextSendAt !== null && !nextSendAt)
    || (row.updatedByName !== null && typeof row.updatedByName !== 'string')) return null;
  const origins = row.origins.map(parseStockDigestOrigin);
  const runs: (StockDigestRun | null)[] = row.runs.map((entry) => {
    const run = record(entry);
    const itemCount = int(run?.itemCount); const createdAt = time(run?.createdAt);
    if (!run || typeof run.digestDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(run.digestDate) || itemCount === null || !createdAt
      || !Array.isArray(run.deliveries)) return null;
    const deliveries = run.deliveries.map(parseDelivery);
    return deliveries.some((delivery) => !delivery) ? null
      : { digestDate: run.digestDate, createdAt, itemCount, deliveries: deliveries as StockDigestDelivery[] };
  });
  if (origins.some((origin) => !origin) || runs.some((run) => !run)) return null;
  return { revision, enabled: row.enabled, sendTime: row.sendTime, operatorRecipients, enabledAt, updatedAt,
    updatedByName: row.updatedByName as string | null, nextSendAt, lowStockCount,
    origins: origins as StockDigestOrigin[], runs: runs as StockDigestRun[] };
}

export function stockDigestErrorMessage(error: { code?: unknown; message?: unknown } | null | undefined): string {
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  if (code === '42501' || code === '28000' || message.includes('operator_capability_required')) return '요약 메일 설정은 계정 주매니저 이상만 바꿀 수 있습니다.';
  if (code === 'PT409' || message.includes('stock_safety_digest_changed')) return '다른 운영자가 먼저 설정을 바꿨습니다. 새로고침한 뒤 다시 저장해주세요.';
  if (message.includes('operation_conflict')) return '같은 요청이 다른 내용으로 이미 처리됐습니다. 새로고침한 뒤 다시 저장해주세요.';
  if (message.includes('stock_digest_recipient_limit')) return '받는 주소가 너무 많습니다.';
  if (message.includes('invalid_stock_digest_recipient')) return '메일 주소 형식을 확인해주세요.';
  if (message.includes('fulfillment_origin_not_found')) return '출고지를 찾지 못했습니다. 새로고침해주세요.';
  return '요약 메일 설정을 저장하지 못했습니다. 잠시 후 다시 시도해주세요.';
}

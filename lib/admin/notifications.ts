export type AdminNotificationScope = 'all' | 'ip_followers';

export interface AdminNotificationFormValue {
  operationId: string;
  scope: AdminNotificationScope;
  ipId: string | null;
  title: string;
  body: string;
}

export interface AdminNotificationFieldErrors {
  operationId?: string;
  scope?: string;
  ipId?: string;
  title?: string;
  body?: string;
  form?: string;
}

export type AdminNotificationFormResult =
  | { ok: true; value: AdminNotificationFormValue }
  | { ok: false; errors: AdminNotificationFieldErrors };

export interface AdminNotificationAudience {
  scope: AdminNotificationScope;
  ipId: string | null;
  ipTitle: string | null;
  recipientCount: number;
  canSend: boolean;
}

export interface AdminNotificationHistoryRecord {
  operationId: string;
  actorName: string;
  scope: AdminNotificationScope;
  ipId: string | null;
  ipTitle: string | null;
  title: string;
  body: string;
  recipientCount: number;
  sentAt: string;
}

export interface AdminNotificationConsoleData {
  audiences: AdminNotificationAudience[];
  history: AdminNotificationHistoryRecord[];
}

export interface AdminNotificationActionState {
  errors?: AdminNotificationFieldErrors;
  message?: string;
  recipientCount?: number;
  nextOperationId?: string;
}

export interface AdminNotificationAudienceRow {
  scope: string;
  ip_id: string | null;
  ip_title: string | null;
  recipient_count: number | string;
  can_send: boolean;
}

export interface AdminNotificationHistoryRow {
  operation_id: string;
  actor_name: string;
  scope: string;
  ip_id: string | null;
  ip_title: string | null;
  title: string;
  body: string;
  recipient_count: number | string;
  sent_at: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IP_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value.trim() : '';
}

function characterCount(value: string) {
  return [...value].length;
}

function isScope(value: string): value is AdminNotificationScope {
  return value === 'all' || value === 'ip_followers';
}

function readRecipientCount(value: number | string) {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('Invalid admin notification recipient count');
  }
  return count;
}

function requireScope(value: string) {
  if (!isScope(value)) throw new Error('Unsupported admin notification audience');
  return value;
}

function requireAudienceTarget(scope: AdminNotificationScope, ipId: string | null) {
  if (scope === 'all' && ipId !== null) {
    throw new Error('Invalid admin notification audience target');
  }
  if (scope === 'ip_followers' && (!ipId || !IP_ID_PATTERN.test(ipId))) {
    throw new Error('Invalid admin notification audience target');
  }
}

export function normalizeAdminNotificationForm(
  formData: FormData,
): AdminNotificationFormResult {
  const errors: AdminNotificationFieldErrors = {};
  const operationId = readString(formData, 'operationId').toLowerCase();
  const rawScope = readString(formData, 'scope');
  const scope = isScope(rawScope) ? rawScope : null;
  const rawIpId = readString(formData, 'ipId');
  const ipId = scope === 'all' ? null : rawIpId;
  const title = readString(formData, 'title');
  const body = readString(formData, 'body');

  if (!UUID_PATTERN.test(operationId)) {
    errors.operationId = '올바른 발송 요청 ID가 필요합니다.';
  }
  if (!scope) {
    errors.scope = '허용된 발송 대상을 선택해주세요.';
  }
  if (scope === 'ip_followers' && !IP_ID_PATTERN.test(ipId ?? '')) {
    errors.ipId = '발송할 IP를 선택해주세요.';
  }
  if (characterCount(title) < 1 || characterCount(title) > 120) {
    errors.title = '제목은 1자 이상 120자 이하로 입력해주세요.';
  }
  if (characterCount(body) < 1 || characterCount(body) > 500) {
    errors.body = '본문은 1자 이상 500자 이하로 입력해주세요.';
  }

  if (Object.keys(errors).length > 0 || !scope) return { ok: false, errors };

  return {
    ok: true,
    value: { operationId, scope, ipId, title, body },
  };
}

export function adminNotificationAudienceFromRow(
  row: AdminNotificationAudienceRow,
): AdminNotificationAudience {
  const scope = requireScope(row.scope);
  requireAudienceTarget(scope, row.ip_id);

  const recipientCount = readRecipientCount(row.recipient_count);

  return {
    scope,
    ipId: row.ip_id,
    ipTitle: row.ip_title,
    recipientCount,
    canSend: row.can_send,
  };
}

export function adminNotificationHistoryFromRow(
  row: AdminNotificationHistoryRow,
): AdminNotificationHistoryRecord {
  const scope = requireScope(row.scope);
  requireAudienceTarget(scope, row.ip_id);

  if (!UUID_PATTERN.test(row.operation_id)) {
    throw new Error('Invalid admin notification operation ID');
  }

  return {
    operationId: row.operation_id.toLowerCase(),
    actorName: row.actor_name,
    scope,
    ipId: row.ip_id,
    ipTitle: row.ip_title,
    title: row.title,
    body: row.body,
    recipientCount: readRecipientCount(row.recipient_count),
    sentAt: row.sent_at,
  };
}

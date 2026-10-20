import { isUuid } from '@/lib/uuid';
import { MANAGER_ROLE_LABELS } from './access';
import { MANAGER_INVITATION_PATH } from '@/lib/routes';
import { isAssignableManagerRole, isManagerRole, isOperatorDuty, type AssignableManagerRole, type OperatorDuty } from './operator-directory';

export const OPERATOR_INVITATION_PATH = MANAGER_INVITATION_PATH;
export type OperatorInvitationInput = { id: string; email: string; name: string; managerRole: AssignableManagerRole; duty: OperatorDuty };
export const OPERATOR_INVITATION_STATUSES = ['pending', 'accepted', 'cancelled', 'replaced', 'expired'] as const;
export type OperatorInvitationStatus = typeof OPERATOR_INVITATION_STATUSES[number];
export const OPERATOR_INVITATION_STATUS_LABELS: Record<OperatorInvitationStatus, string> = { pending: '수락 대기', accepted: '수락 완료', cancelled: '초대 취소', replaced: '재초대됨', expired: '기간 만료' };
export const INVITATION_EMAIL_STATES = ['queued', 'dispatching', 'accepted', 'unknown', 'needs_review', 'sent', 'delivered', 'delayed', 'bounced', 'complained', 'suppressed', 'failed'] as const;
export type InvitationEmailState = typeof INVITATION_EMAIL_STATES[number];
export type InvitationDeliveryError = 'provider_not_configured' | 'delivery_disabled' | 'delivery_in_progress' | 'delivery_outcome_unknown' | 'provider_rejected' | 'provider_retryable' | 'delivery_needs_review' | 'token_key_changed';
const DELIVERY_ERRORS: InvitationDeliveryError[] = ['provider_not_configured', 'delivery_disabled', 'delivery_in_progress', 'delivery_outcome_unknown', 'provider_rejected', 'provider_retryable', 'delivery_needs_review', 'token_key_changed'];
export interface OperatorInvitationRecord {
  id: string; name: string; maskedEmail: string; managerRole: AssignableManagerRole; duty: OperatorDuty;
  status: OperatorInvitationStatus; revision: number; createdAt: string; expiresAt: string; acceptedAt: string | null; cancelledAt: string | null;
  emailState: InvitationEmailState; deliveryError: InvitationDeliveryError | null; dispatchAttemptedAt: string | null;
}
export interface OperatorInvitationList { rows: OperatorInvitationRecord[]; total: number; query: string; status: OperatorInvitationStatus | 'all'; page: number; pageSize: 20 | 50 | 100 }
export type OperatorInvitationWriteResult = { error: string; uncertain?: boolean } | { count: number; accessRevision: number; delivery: string };
export type MyOperatorInvitation = { status: 'unavailable' | 'email_confirmation_required' }
  | { status: 'pending'; managerRole: AssignableManagerRole; duty: OperatorDuty; expiresAt: string }
  | { status: 'accepted'; managerRole: keyof typeof MANAGER_ROLE_LABELS | null; accessActive: boolean };
export function parseMyOperatorInvitation(value: unknown): MyOperatorInvitation | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (data.status === 'unavailable' || data.status === 'email_confirmation_required') return { status: data.status };
  if (data.status === 'pending' && isAssignableManagerRole(data.managerRole) && isOperatorDuty(data.duty)
    && typeof data.expiresAt === 'string' && Number.isFinite(Date.parse(data.expiresAt))) return { status: data.status, managerRole: data.managerRole, duty: data.duty, expiresAt: data.expiresAt };
  if (data.status === 'accepted' && (data.managerRole === null || isManagerRole(data.managerRole)) && typeof data.accessActive === 'boolean') return { status: data.status, managerRole: data.managerRole, accessActive: data.accessActive };
  return null;
}

export function normalizeOperatorInvitationInput(value: unknown): OperatorInvitationInput | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as OperatorInvitationInput;
  if (!isUuid(row.id) || typeof row.email !== 'string' || typeof row.name !== 'string' || !isAssignableManagerRole(row.managerRole) || !isOperatorDuty(row.duty)) return null;
  const email = row.email.trim().toLowerCase(); const name = row.name.trim();
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || /[\u0000-\u001f\u007f]/.test(email)
    || !name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return null;
  return { id: row.id.toLowerCase(), email, name, managerRole: row.managerRole, duty: row.duty };
}
export function parseOperatorInvitations(value: unknown): { rows: OperatorInvitationRecord[]; total: number } | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as { rows: OperatorInvitationRecord[]; total: number };
  if (!Number.isSafeInteger(data.total) || data.total < 0 || !Array.isArray(data.rows)) return null;
  const ids = new Set<string>(); const date = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  for (const row of data.rows) {
    if (!row || !isUuid(row.id) || ids.has(row.id) || typeof row.name !== 'string' || typeof row.maskedEmail !== 'string'
      || !isAssignableManagerRole(row.managerRole) || !isOperatorDuty(row.duty) || !OPERATOR_INVITATION_STATUSES.includes(row.status)
      || !Number.isSafeInteger(row.revision) || row.revision < 1 || !date(row.createdAt) || !date(row.expiresAt)
      || (row.acceptedAt !== null && !date(row.acceptedAt)) || (row.cancelledAt !== null && !date(row.cancelledAt))
      || !INVITATION_EMAIL_STATES.includes(row.emailState) || (row.deliveryError !== null && !DELIVERY_ERRORS.includes(row.deliveryError))
      || (row.dispatchAttemptedAt !== null && !date(row.dispatchAttemptedAt))) return null;
    ids.add(row.id);
  }
  return { rows: data.rows, total: data.total };
}
export function invitationEmailLabel(row: Pick<OperatorInvitationRecord, 'emailState' | 'deliveryError'>): string {
  if (row.emailState === 'delivered') return '전달 완료';
  if (['accepted', 'sent', 'delayed'].includes(row.emailState)) return row.emailState === 'delayed' ? '전달 지연' : '발송 접수';
  if (row.deliveryError === 'token_key_changed') return '재초대 필요';
  if (row.emailState === 'needs_review' || ['delivery_needs_review', 'delivery_outcome_unknown'].includes(row.deliveryError ?? '')) return '결과 확인 필요';
  if (row.emailState === 'dispatching' || row.deliveryError === 'delivery_in_progress') return '발송 처리 중';
  if (['failed', 'bounced', 'complained', 'suppressed'].includes(row.emailState) || row.deliveryError === 'provider_rejected') return '발송 실패';
  if (row.deliveryError === 'provider_not_configured' || row.deliveryError === 'delivery_disabled') return '발송 설정 확인 필요';
  return '발송 대기';
}

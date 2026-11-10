import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';
import { MANAGER_ROLE_LABELS } from '@/lib/admin/access';
import { isAssignableManagerRole, type AssignableManagerRole } from '@/lib/admin/operator-directory';
import { OPERATOR_INVITATION_PATH, type InvitationDeliveryError, type OperatorInvitationInput } from '@/lib/admin/operator-invitations';
import { emailDispatcherFromEnvironment } from './dispatcher.server';
import { emailDispatchDigest, getEmailDispatchHmacConfig } from './supabase-dispatcher-repository.server';
import type { DispatchOutcome, EmailDispatcher } from './dispatcher';
import { emailSiteUrl } from './site-url';
import { escapeHtml } from './templates';

export function operatorInvitationToken(id: string, email: string): string {
  const { secret, isConfigured } = getEmailDispatchHmacConfig();
  if (!isConfigured || !secret) throw new Error('operator_invitation_token_not_configured');
  return createHmac('sha256', secret).update('icons:operator-invitation:v1\0').update(id.toLowerCase()).update('\0').update(email.trim().toLowerCase()).digest('base64url');
}
export function operatorInvitationTokenHash(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function prepareOperatorInvitationEntry(input: OperatorInvitationInput) {
  return { ...input, tokenHash: operatorInvitationTokenHash(operatorInvitationToken(input.id, input.email)),
    sourceDigest: emailDispatchDigest('source', input.id), recipientDigest: emailDispatchDigest('recipient', input.email) };
}
export interface OperatorInvitationEmailJob { id: string; claimId: string; intentId: string; recipient: string; name: string; managerRole: AssignableManagerRole; expiresAt: string; tokenHash: string }
export interface OperatorInvitationEmailRepository {
  prepare(id: string, actorId: string): Promise<OperatorInvitationEmailJob | null>;
  finish(id: string, claimId: string, error: InvitationDeliveryError | null): Promise<boolean>;
}
export function operatorInvitationEmailRepository(): OperatorInvitationEmailRepository {
  const service = createServiceClient();
  return {
    async prepare(id, actorId) {
      const { data, error } = await service.rpc('service_prepare_operator_invitation_email', { p_invitation_id: id, p_actor_id: actorId });
      if (error || !data) throw new Error('operator_invitation_email_prepare_failed');
      if (data.kind === 'unavailable') return null;
      if (data.kind !== 'ready' || !isUuid(data.id) || data.id !== id || !isUuid(data.claimId) || !isUuid(data.intentId)
        || typeof data.recipient !== 'string' || typeof data.name !== 'string' || !isAssignableManagerRole(data.managerRole)
        || typeof data.expiresAt !== 'string' || !Number.isFinite(Date.parse(data.expiresAt)) || typeof data.tokenHash !== 'string' || !/^[0-9a-f]{64}$/.test(data.tokenHash)) throw new Error('operator_invitation_email_prepare_failed');
      return data as OperatorInvitationEmailJob;
    },
    async finish(id, claimId, errorCode) {
      const { data, error } = await service.rpc('service_finish_operator_invitation_email', { p_invitation_id: id, p_claim_id: claimId, p_error: errorCode });
      if (error || typeof data !== 'boolean') throw new Error('operator_invitation_email_finish_failed');
      return data;
    },
  };
}
function deliveryError(result: DispatchOutcome): InvitationDeliveryError | null {
  if (['accepted', 'sent', 'delivered', 'delayed'].includes(result.state)) return null;
  if (['bounced', 'complained', 'suppressed', 'failed'].includes(result.state)) return 'provider_rejected';
  if (result.kind === 'skipped' && result.reason === 'disabled') return 'delivery_disabled';
  if (result.kind === 'skipped' && result.reason === 'in_progress') return 'delivery_in_progress';
  if (result.state === 'needs_review') return 'delivery_needs_review';
  if (result.state === 'unknown') return 'delivery_outcome_unknown';
  return 'provider_retryable';
}
export function renderOperatorInvitationEmail(job: OperatorInvitationEmailJob, token: string, siteUrl: string) {
  const href = `${siteUrl}${OPERATOR_INVITATION_PATH}#token=${encodeURIComponent(token)}`;
  const expires = new Date(job.expiresAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
  const subject = 'ICONS 매니저 초대';
  const text = `${job.name}님, ICONS의 ${MANAGER_ROLE_LABELS[job.managerRole]}로 초대되었습니다.\n\n초대받은 이메일로 로그인하거나 가입한 뒤 이메일 인증을 마치고 초대를 수락해주세요.\n유효기간: ${expires} (한국 시간)\n\n초대 확인: ${href}\n\n요청하지 않은 초대라면 수락하지 않아도 됩니다.`;
  return { subject, text, html: `<h1>${subject}</h1><p>${escapeHtml(job.name)}님, ICONS의 ${escapeHtml(MANAGER_ROLE_LABELS[job.managerRole])}로 초대되었습니다.</p><p>초대받은 이메일로 로그인하거나 가입한 뒤 이메일 인증을 마치고 초대를 수락해주세요.</p><p>유효기간: ${escapeHtml(expires)} (한국 시간)</p><p><a href="${escapeHtml(href)}">초대 확인</a></p><p>요청하지 않은 초대라면 수락하지 않아도 됩니다.</p>` };
}

/** No raw token, recipient or rendered URL is returned to a console or logged. */
export async function dispatchOperatorInvitations(ids: string[], actorId: string, dependencies: {
  repository: OperatorInvitationEmailRepository; dispatcher: EmailDispatcher | null; siteUrl: string;
} = { repository: operatorInvitationEmailRepository(), dispatcher: emailDispatcherFromEnvironment(), siteUrl: emailSiteUrl() }) {
  const summary = { accepted: 0, pending: 0, unavailable: 0, needsReview: 0 };
  for (const id of ids) {
    let job: OperatorInvitationEmailJob | null;
    try { job = await dependencies.repository.prepare(id, actorId); } catch { summary.needsReview += 1; continue; }
    if (!job) { summary.unavailable += 1; continue; }
    let error: InvitationDeliveryError | null;
    try {
      const token = operatorInvitationToken(job.id, job.recipient);
      const actualHash = Buffer.from(operatorInvitationTokenHash(token), 'hex');
      if (!timingSafeEqual(actualHash, Buffer.from(job.tokenHash, 'hex'))) error = 'token_key_changed';
      else if (!dependencies.dispatcher) error = 'provider_not_configured';
      else error = deliveryError(await dependencies.dispatcher.dispatch({ intentId: job.intentId, recipient: job.recipient, message: renderOperatorInvitationEmail(job, token, dependencies.siteUrl) }));
    } catch { error = 'delivery_outcome_unknown'; }
    try {
      if (!await dependencies.repository.finish(job.id, job.claimId, error)) { summary.needsReview += 1; continue; }
    } catch { summary.needsReview += 1; continue; }
    if (!error) summary.accepted += 1;
    else if (['delivery_needs_review', 'delivery_outcome_unknown', 'token_key_changed'].includes(error)) summary.needsReview += 1;
    else summary.pending += 1;
  }
  return summary;
}

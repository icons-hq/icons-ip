'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { OPERATOR_DIRECTORY_PATH, type OperatorMutationResult } from '@/lib/admin/operator-directory';
import { normalizeOperatorInvitationInput, type OperatorInvitationInput, type OperatorInvitationWriteResult } from '@/lib/admin/operator-invitations';
import { dispatchOperatorInvitations, prepareOperatorInvitationEntry } from '@/lib/email/operator-invitations.server';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

const uncertain = () => ({ error: '초대 처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
function invitationError(error: { code?: string; message?: string }) {
  if (error.code === 'PT409') return { error: '매니저 또는 초대 정보가 바뀌었습니다. 목록을 새로고침해주세요.' };
  if (['22023', '23505', '23514', '42501'].includes(error.code ?? '')) {
    const messages: Record<string, string> = {
      operator_invitation_batch_limit: '한 번에 최대 10명까지 초대할 수 있습니다.',
      operator_invitation_duplicate: '같은 이메일은 한 번만 입력해주세요.',
      operator_invitation_pending: '수락 대기 중인 초대가 있습니다. 초대 내역에서 재초대를 선택해주세요.',
      operator_already_manager: '이미 매니저로 등록된 계정입니다. 매니저 목록에서 역할을 변경해주세요.',
      operator_invitation_reissue_invalid: '기존 초대와 같은 이메일을 입력해주세요. 수락 완료된 초대는 재초대할 수 없습니다.',
      operator_invitation_not_pending: '수락 대기 중인 초대만 취소할 수 있습니다.',
      operator_setup_required: '먼저 기존 운영자의 매니저 역할 설정을 완료해주세요.',
      operator_limit: '매니저와 수락 대기 중인 초대를 합해 최대 1,000명까지 등록할 수 있습니다.',
      operation_conflict: '다른 작업에 사용된 요청입니다. 목록을 새로고침해주세요.',
    };
    return { error: messages[error.message ?? ''] ?? '현재 권한과 초대할 이름·이메일·역할을 확인해주세요.' };
  }
  return uncertain();
}
async function deliver(ids: string[], actorId: string) {
  try {
    const result = await dispatchOperatorInvitations(ids, actorId);
    return `발송 접수 ${result.accepted}명 · 발송 대기 ${result.pending}명 · 결과 확인 필요 ${result.needsReview}명${result.unavailable ? ` · 유효하지 않은 초대 ${result.unavailable}명` : ''}`;
  } catch { return '초대는 등록되었습니다. 초대 내역에서 발송 상태를 확인하고 다시 시도해주세요.'; }
}
async function createInvitations(name: string, args: Record<string, unknown>, expectedIds: string[], accessRevision: number, actorId: string): Promise<OperatorInvitationWriteResult> {
  const client = await createClient();
  const { data, error } = await client.rpc(name, args);
  if (error) return invitationError(error);
  if (!data || data.count !== expectedIds.length || !Number.isSafeInteger(data.accessRevision) || data.accessRevision <= accessRevision
    || !Array.isArray(data.invitationIds) || data.invitationIds.length !== expectedIds.length || new Set(data.invitationIds).size !== expectedIds.length
    || data.invitationIds.some((id: unknown) => typeof id !== 'string' || !expectedIds.includes(id))) return uncertain();
  const delivery = await deliver(data.invitationIds, actorId);
  revalidatePath(OPERATOR_DIRECTORY_PATH);
  return { count: data.count, accessRevision: data.accessRevision, delivery };
}
export async function createOperatorInvitationsAction(inputs: OperatorInvitationInput[], accessRevision: number, operationId: string): Promise<OperatorInvitationWriteResult> {
  try {
    const auth = await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' });
    if (!auth) return { error: '매니저 관리 권한이 없습니다.' };
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 10 || !Number.isSafeInteger(accessRevision) || accessRevision < 1 || !isUuid(operationId)) return { error: '한 번에 1명부터 10명까지 초대할 수 있습니다.' };
    const rows = inputs.map(normalizeOperatorInvitationInput);
    if (rows.some(row => !row)) return { error: '이름·이메일·역할·담당업무를 확인해주세요.' };
    const normalized = rows as OperatorInvitationInput[];
    if (new Set(normalized.map(row => row.id)).size !== normalized.length || new Set(normalized.map(row => row.email)).size !== normalized.length) return { error: '같은 이메일은 한 번만 입력해주세요.' };
    let entries: ReturnType<typeof prepareOperatorInvitationEntry>[];
    try { entries = normalized.map(prepareOperatorInvitationEntry); } catch { return { error: '초대 이메일 발송 설정이 완료되지 않았습니다. 설정을 확인해주세요.' }; }
    return await createInvitations('admin_create_operator_invitations', { p_entries: entries, p_expected_access_revision: accessRevision, p_operation_id: operationId }, normalized.map(row => row.id), accessRevision, auth.user.id);
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function reissueOperatorInvitationAction(invitationId: string, input: OperatorInvitationInput, revision: number, accessRevision: number, operationId: string): Promise<OperatorInvitationWriteResult> {
  try {
    const auth = await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' });
    if (!auth) return { error: '매니저 관리 권한이 없습니다.' };
    const normalized = normalizeOperatorInvitationInput(input);
    if (!normalized || !isUuid(invitationId) || !isUuid(operationId) || normalized.id === invitationId || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(accessRevision) || accessRevision < 1) return { error: '재초대할 이름·이메일·역할을 확인해주세요.' };
    let entry: ReturnType<typeof prepareOperatorInvitationEntry>;
    try { entry = prepareOperatorInvitationEntry(normalized); } catch { return { error: '초대 이메일 발송 설정이 완료되지 않았습니다. 설정을 확인해주세요.' }; }
    return await createInvitations('admin_reissue_operator_invitation', { p_invitation_id: invitationId, p_entry: entry, p_expected_revision: revision, p_expected_access_revision: accessRevision, p_operation_id: operationId }, [normalized.id], accessRevision, auth.user.id);
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function cancelOperatorInvitationAction(invitationId: string, revision: number, accessRevision: number, operationId: string): Promise<OperatorMutationResult> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' })) return { error: '매니저 관리 권한이 없습니다.' };
    if (!isUuid(invitationId) || !isUuid(operationId) || !Number.isSafeInteger(revision) || revision < 1 || !Number.isSafeInteger(accessRevision) || accessRevision < 1) return { error: '취소할 초대를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_cancel_operator_invitation', { p_invitation_id: invitationId, p_expected_revision: revision, p_expected_access_revision: accessRevision, p_operation_id: operationId });
    if (error) return invitationError(error);
    if (!data || !Number.isSafeInteger(data.revision) || data.revision <= revision || !Number.isSafeInteger(data.accessRevision) || data.accessRevision <= accessRevision) return uncertain();
    revalidatePath(OPERATOR_DIRECTORY_PATH);
    return { revision: data.revision, accessRevision: data.accessRevision };
  } catch (error) { unstable_rethrow(error); return uncertain(); }
}
export async function retryOperatorInvitationEmailAction(invitationId: string): Promise<{ error: string } | { message: string }> {
  try {
    const auth = await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' });
    if (!auth) return { error: '매니저 관리 권한이 없습니다.' };
    if (!isUuid(invitationId)) return { error: '발송할 초대를 확인해주세요.' };
    const message = await deliver([invitationId], auth.user.id);
    revalidatePath(OPERATOR_DIRECTORY_PATH);
    return { message };
  } catch (error) { unstable_rethrow(error); return { error: '발송 상태를 확인하지 못했습니다. 초대 내역을 새로고침해주세요.' }; }
}

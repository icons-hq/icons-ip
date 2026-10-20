'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { isAssignableManagerRole, isManagerRole, isOperatorDuty, OPERATOR_DIRECTORY_PATH, type OperatorMutationResult, type OperatorSetupAssignment } from '@/lib/admin/operator-directory';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export async function saveOperatorDutyAction(profileId: string, duty: string, revision: number, operationId: string): Promise<{ error: string; uncertain?: boolean } | { revision: number }> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' })) return { error: '매니저 관리 권한이 없습니다.' };
    if (!isUuid(profileId) || !isUuid(operationId) || !isOperatorDuty(duty) || !Number.isSafeInteger(revision) || revision < 0) return { error: '운영자와 담당업무를 확인해주세요.' };
    const client = await createClient();
    const { data, error } = await client.rpc('admin_set_operator_duty', { p_profile_id: profileId, p_duty: duty, p_expected_revision: revision, p_operation_id: operationId });
    if (error) {
      if (error.code === 'PT409') return { error: '다른 관리자가 담당업무를 변경했습니다. 입력을 확인하고 목록을 새로고침해주세요.' };
      if (['22023', '42501', '23505'].includes(error.code ?? '')) return { error: '저장하지 못했습니다. 통합 매니저의 업무는 대표로 고정됩니다. 현재 권한을 확인해주세요.' };
      return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    }
    if (!data || !Number.isSafeInteger(data.revision) || data.revision <= revision || data.duty !== duty) return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true };
    revalidatePath(OPERATOR_DIRECTORY_PATH);
    return { revision: data.revision };
  } catch (error) { unstable_rethrow(error); return { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
}

const validRevision = (value: number) => Number.isSafeInteger(value) && value >= 1;
const uncertainResult = (): OperatorMutationResult => ({ error: '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true });
function mutationError(error: { code?: string; message?: string }): OperatorMutationResult {
  if (error.code === 'PT409') return { error: '매니저 정보가 변경되었습니다. 입력을 확인하고 목록을 새로고침해주세요.' };
  const messages: Record<string, string> = {
    operator_setup_incomplete: '기존 운영자를 빠짐없이 한 번씩 배정해주세요. 정지 계정은 권한 회수를 선택해주세요.',
    operator_owner_required: '이용 중인 기존 관리자 중 통합 매니저 한 명을 선택해주세요.',
    operator_actor_mapping_required: '설정하는 본인은 통합 매니저 또는 계정 주매니저로 유지해주세요.',
    operator_setup_required: '먼저 기존 운영자의 매니저 역할 설정을 완료해주세요.',
    operator_self_change_denied: '본인의 권한은 다른 통합 매니저 또는 계정 주매니저가 변경해야 합니다.',
    operator_owner_change_denied: '통합 매니저는 일반 변경·회수할 수 없습니다. 승계 기능을 사용해주세요.',
    operator_primary_revoke_denied: '계정 주매니저는 다른 주매니저를 직접 회수할 수 없습니다. 먼저 다른 역할로 변경해주세요.',
    operator_suspended_target: '정지된 계정에는 역할을 부여하거나 통합 매니저를 승계할 수 없습니다.',
    operator_primary_target_required: '이용 중인 계정 주매니저를 승계 대상으로 선택해주세요.',
    operator_limit: '통합 매니저를 제외하고 최대 1,000명까지 배정할 수 있습니다.',
    operation_conflict: '이미 다른 작업에 사용된 요청입니다. 목록을 새로고침해주세요.',
  };
  if (['22023', '42501', '23505'].includes(error.code ?? '')) return { error: messages[error.message ?? ''] ?? '매니저 권한과 입력값을 확인해주세요. 현재 권한으로 처리할 수 없습니다.' };
  return uncertainResult();
}
async function writeManagerMutation(name: string, args: Record<string, unknown>, expectedAccessRevision: number): Promise<OperatorMutationResult> {
  const client = await createClient();
  const { data, error } = await client.rpc(name, args);
  if (error) return mutationError(error);
  if (!data || !Number.isSafeInteger(data.revision) || data.revision < 0 || !Number.isSafeInteger(data.accessRevision) || data.accessRevision <= expectedAccessRevision) return uncertainResult();
  revalidatePath(OPERATOR_DIRECTORY_PATH);
  revalidatePath('/admin', 'layout');
  return { revision: data.revision, accessRevision: data.accessRevision };
}

export async function activateOperatorAccessAction(assignments: OperatorSetupAssignment[], revision: number, operationId: string): Promise<OperatorMutationResult> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' })) return { error: '매니저 관리 권한이 없습니다.' };
    if (!validRevision(revision) || !isUuid(operationId) || !Array.isArray(assignments) || !assignments.length || assignments.length > 10000
      || assignments.some(row => !row || !isUuid(row.profileId) || (row.managerRole !== null && !isManagerRole(row.managerRole)))
      || new Set(assignments.map(row => row.profileId)).size !== assignments.length
      || assignments.filter(row => row.managerRole === 'owner').length !== 1
      || assignments.filter(row => row.managerRole !== null).length > 1001) return { error: '모든 기존 운영자의 역할과 통합 매니저 한 명을 명시적으로 선택해주세요.' };
    return await writeManagerMutation('admin_activate_operator_access', { p_assignments: assignments, p_expected_revision: revision, p_operation_id: operationId }, revision);
  } catch (error) { unstable_rethrow(error); return uncertainResult(); }
}

export async function changeOperatorRoleAction(profileId: string, managerRole: string | null, membershipRevision: number, accessRevision: number, operationId: string): Promise<OperatorMutationResult> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' })) return { error: '매니저 관리 권한이 없습니다.' };
    if (!isUuid(profileId) || !isUuid(operationId) || !validRevision(membershipRevision) || !validRevision(accessRevision)
      || (managerRole !== null && !isAssignableManagerRole(managerRole))) return { error: '매니저와 부여할 역할을 확인해주세요.' };
    return await writeManagerMutation('admin_change_operator_role', { p_profile_id: profileId, p_manager_role: managerRole, p_expected_revision: membershipRevision, p_expected_access_revision: accessRevision, p_operation_id: operationId }, accessRevision);
  } catch (error) { unstable_rethrow(error); return uncertainResult(); }
}

export async function transferOperatorOwnerAction(profileId: string, ownerRevision: number, targetRevision: number, accessRevision: number, operationId: string): Promise<OperatorMutationResult> {
  try {
    // A completed transfer demotes the old owner to primary. The DB permits its
    // exact receipt replay, while requiring transfer authority for a new write.
    if (!await requireAdminActionAccess(OPERATOR_DIRECTORY_PATH, { adminOnly: true, capability: 'operators.manage' })) return { error: '매니저 관리 권한이 없습니다.' };
    if (!isUuid(profileId) || !isUuid(operationId) || !validRevision(ownerRevision) || !validRevision(targetRevision) || !validRevision(accessRevision)) return { error: '승계 대상과 현재 매니저 정보를 확인해주세요.' };
    return await writeManagerMutation('admin_transfer_operator_owner', { p_profile_id: profileId, p_expected_owner_revision: ownerRevision, p_expected_target_revision: targetRevision, p_expected_access_revision: accessRevision, p_operation_id: operationId }, accessRevision);
  } catch (error) { unstable_rethrow(error); return uncertainResult(); }
}

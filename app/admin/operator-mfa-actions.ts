'use server';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  OPERATOR_MFA_POLICY_PATH, operatorMfaError, parseOperatorMfaPolicyReceipt, parseOperatorMfaResetReceipt,
  type OperatorMfaPolicyReceipt, type OperatorMfaResetReceipt,
} from '@/lib/admin/mfa';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { isUuid } from '@/lib/uuid';

export type OperatorMfaPolicyResult = { receipt: OperatorMfaPolicyReceipt } | { error: string; uncertain?: boolean };
export type OperatorMfaResetResult = { receipt: OperatorMfaResetReceipt & { factorsDeleted: number } } | { error: string; uncertain?: boolean };

const KNOWN_REJECTIONS = ['42501', '28000', '22023', 'PT409', '23505'];

/** 운영자 2단계 인증 요구 스위치를 켜거나 끈다. 같은 요청 ID는 같은 결과를 다시 읽는다(DB가 켜는 조건을 판정한다). */
export async function saveOperatorMfaPolicyAction(required: unknown, expectedRevision: unknown, operationId: unknown): Promise<OperatorMfaPolicyResult> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_MFA_POLICY_PATH, { capability: 'operators.manage', adminOnly: true })) {
      return { error: operatorMfaError('42501') };
    }
    if (typeof required !== 'boolean' || typeof expectedRevision !== 'number' || !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 1 || !isUuid(operationId)) return { error: operatorMfaError('22023') };
    const { data, error } = await (await createClient()).rpc('admin_save_operator_mfa_policy', {
      p_required: required, p_expected_revision: expectedRevision, p_operation_id: operationId,
    });
    if (error) {
      return KNOWN_REJECTIONS.includes(error.code ?? '') ? { error: operatorMfaError(error.code, error.message) } : { error: operatorMfaError(), uncertain: true };
    }
    const receipt = parseOperatorMfaPolicyReceipt(data);
    if (!receipt || receipt.required !== required) return { error: operatorMfaError(), uncertain: true };
    revalidatePath(OPERATOR_MFA_POLICY_PATH);
    return { receipt };
  } catch (error) { unstable_rethrow(error); return { error: operatorMfaError(), uncertain: true }; }
}

/**
 * 기기를 잃은 운영자의 2단계 인증 초기화(통합 매니저, 전환 전에는 admin). DB가 권한을 판정하고 대상의 로그인 세션을 끊고
 * 감사 기록을 남긴 뒤에만 Supabase Auth admin API로 인증 앱 등록을 지우고, 같은 요청 ID로 한 번 더 불러 그 사이 생긴 세션을 끊는다.
 * 실패하면 같은 요청 ID로 다시 부른다 — DB는 같은 기록을 돌려주며 세션을 다시 끊고, 남은 등록만 다시 지운다.
 */
export async function resetOperatorMfaAction(profileId: unknown, operationId: unknown): Promise<OperatorMfaResetResult> {
  try {
    if (!await requireAdminActionAccess(OPERATOR_MFA_POLICY_PATH, { capability: 'operators.manage', adminOnly: true })) {
      return { error: operatorMfaError('42501') };
    }
    if (!isUuid(profileId) || !isUuid(operationId)) return { error: operatorMfaError('22023') };
    const { data, error } = await (await createClient()).rpc('admin_reset_operator_mfa', { p_profile_id: profileId, p_operation_id: operationId });
    if (error) {
      return KNOWN_REJECTIONS.includes(error.code ?? '') ? { error: operatorMfaError(error.code, error.message) } : { error: operatorMfaError(), uncertain: true };
    }
    const receipt = parseOperatorMfaResetReceipt(data);
    if (!receipt || receipt.profileId !== profileId) return { error: operatorMfaError(), uncertain: true };

    const admin = createServiceClient().auth.admin.mfa;
    const listed = await admin.listFactors({ userId: profileId });
    if (listed.error) return { error: '세션은 끊었지만 인증 앱 등록을 읽지 못했습니다. 같은 요청으로 다시 시도해 주세요.', uncertain: true };
    let factorsDeleted = 0;
    for (const factor of listed.data.factors) {
      const removed = await admin.deleteFactor({ id: factor.id, userId: profileId });
      if (removed.error) return { error: '세션은 끊었지만 인증 앱 등록을 모두 지우지 못했습니다. 같은 요청으로 다시 시도해 주세요.', uncertain: true };
      factorsDeleted += 1;
    }
    /* 같은 요청 ID로 한 번 더 부르면 DB가 같은 기록을 돌려주며 세션을 다시 끊는다 — 첫 호출과 삭제 사이에 만든 세션까지 지운다. */
    const sealed = await (await createClient()).rpc('admin_reset_operator_mfa', { p_profile_id: profileId, p_operation_id: operationId });
    if (sealed.error) return { error: '인증 앱 등록은 지웠지만 마지막 세션 정리를 확인하지 못했습니다. 같은 요청으로 다시 시도해 주세요.', uncertain: true };
    revalidatePath(OPERATOR_MFA_POLICY_PATH);
    return { receipt: { ...receipt, factorsDeleted } };
  } catch (error) { unstable_rethrow(error); return { error: operatorMfaError(), uncertain: true }; }
}

'use server';

import { revalidatePath } from 'next/cache';
import type { AccountDeletionBlocker } from '@/lib/account-deletion';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import {
  memberWithdrawalErasedSummary,
  memberWithdrawalRpcError,
  normalizeMemberWithdrawalForm,
  parseMemberWithdrawalOutcome,
} from '@/lib/admin/member-withdrawal';
import { banWithdrawnMemberSignin, getMemberWithdrawalStatus } from '@/lib/admin/member-withdrawal.server';
import { normalizeAdminMemberDetailForm } from '@/lib/admin/members';
import { createClient } from '@/lib/supabase/server';

export interface MemberWithdrawalActionState {
  errors?: Record<string, string>;
  message?: string;
  /** 진행 중 의무가 남아 처리하지 않았을 때 그 목록. */
  blockers?: AccountDeletionBlocker[];
}

const SIGNIN_BLOCK_FAILED = '정지·삭제는 끝났지만 재로그인 차단을 적용하지 못했습니다. 아래 \'재로그인 차단 다시 적용\'을 눌러주세요.';

function revalidateMemberViews(profileId: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/community/members');
  revalidatePath(`/admin/customers/${profileId}`);
}

/** Auth 관리 API로 재로그인을 막고 DB가 auth.users를 직접 읽어 확인·기록하게 한다. 둘 다 성공해야 true다. */
async function applySigninBlock(supabase: Awaited<ReturnType<typeof createClient>>, profileId: string): Promise<boolean> {
  if (!await banWithdrawnMemberSignin(profileId)) return false;
  const { error } = await supabase.rpc('admin_confirm_member_withdrawal_signin_block', { target_profile_id: profileId });
  return !error;
}

/**
 * 1:1 문의로 받은 탈퇴 요청을 처리한다. DB가 한 트랜잭션으로 진행 중 의무 확인 → 정지·개인정보 삭제·세션 종료·감사를 하고,
 * 처리된 뒤에만 재로그인 차단을 건다. 다시 눌러도 처음 처리 기록을 돌려주고 빠진 재로그인 차단만 다시 건다.
 */
export async function processMemberWithdrawalAction(
  _state: MemberWithdrawalActionState,
  formData: FormData,
): Promise<MemberWithdrawalActionState> {
  if (!await requireAdminActionAccess('/admin/community/members', { capability: 'platform.manage' })) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  const input = normalizeMemberWithdrawalForm(formData);
  if (!input.ok) return { errors: input.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_process_member_withdrawal', {
    target_profile_id: input.value.profileId,
    target_inquiry_reference: input.value.inquiryReference,
    target_note: input.value.note,
  });
  if (error) return { errors: { form: memberWithdrawalRpcError(error.message) } };
  const outcome = parseMemberWithdrawalOutcome(data);
  if (!outcome) return { errors: { form: '처리 결과를 확인하지 못했습니다. 화면을 새로고침해 상태를 확인해주세요.' } };
  if (outcome.status === 'blocked') {
    return { blockers: outcome.blockers, errors: { form: '진행 중인 거래·운영 권한이 남아 있어 처리하지 않았습니다. 아래 항목을 먼저 끝내주세요.' } };
  }

  const blocked = outcome.withdrawal.signinBlocked || await applySigninBlock(supabase, input.value.profileId);
  revalidateMemberViews(input.value.profileId);
  const done = outcome.status === 'processed'
    ? `탈퇴 요청(문의 #${outcome.withdrawal.inquiryReference})을 처리했습니다 — ${memberWithdrawalErasedSummary(outcome.erased, outcome.revokedSessions)}.`
    : `이미 탈퇴 처리한 회원입니다(문의 #${outcome.withdrawal.inquiryReference}).`;
  return blocked ? { message: done } : { message: done, errors: { form: SIGNIN_BLOCK_FAILED } };
}

/** 처리 뒤 재로그인 차단만 실패했을 때 다시 건다. 처리 기록이 있는 회원에게만 건다. */
export async function retryMemberWithdrawalSigninBlockAction(
  _state: MemberWithdrawalActionState,
  formData: FormData,
): Promise<MemberWithdrawalActionState> {
  if (!await requireAdminActionAccess('/admin/community/members', { capability: 'platform.manage' })) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  const input = normalizeAdminMemberDetailForm(formData);
  if (!input.ok) return { errors: input.errors };

  const status = await getMemberWithdrawalStatus(input.value.profileId);
  if (!status) return { errors: { form: '탈퇴 처리 상태를 확인하지 못했습니다. 다시 시도해주세요.' } };
  if (!status.processed) return { errors: { form: '탈퇴 요청을 처리한 회원이 아닙니다.' } };
  if (!status.signinBlocked) {
    const supabase = await createClient();
    if (!await applySigninBlock(supabase, input.value.profileId)) {
      return { errors: { form: '재로그인 차단을 적용하지 못했습니다. 잠시 뒤 다시 시도해주세요.' } };
    }
  }
  revalidateMemberViews(input.value.profileId);
  return { message: '재로그인 차단을 적용했습니다.' };
}

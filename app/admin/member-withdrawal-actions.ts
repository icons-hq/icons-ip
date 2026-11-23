'use server';

import { revalidatePath } from 'next/cache';
import type { AccountDeletionBlocker } from '@/lib/account-deletion';
import { requireAdminActionAccess } from '@/lib/admin/action-access.server';
import { KAKAO_UNLINK_QUEUE_PATH } from '@/lib/admin/kakao-unlink-withdrawal';
import {
  memberWithdrawalBasisLabel,
  memberWithdrawalErasedSummary,
  memberWithdrawalRpcError,
  normalizeKakaoUnlinkWithdrawalForm,
  normalizeMemberWithdrawalForm,
  parseInquiryReference,
  parseMemberWithdrawalInquiry,
  parseMemberWithdrawalOutcome,
  type MemberWithdrawalInquiry,
  type MemberWithdrawalOutcome,
} from '@/lib/admin/member-withdrawal';
import { banWithdrawnMemberSignin, eraseWithdrawnMemberAvatar, getMemberWithdrawalStatus } from '@/lib/admin/member-withdrawal.server';
import { normalizeAdminMemberDetailForm } from '@/lib/admin/members';
import { createClient } from '@/lib/supabase/server';
import { isUuid } from '@/lib/uuid';

export interface MemberWithdrawalActionState {
  errors?: Record<string, string>;
  message?: string;
  /** 진행 중 의무가 남아 처리하지 않았을 때 그 목록. */
  blockers?: AccountDeletionBlocker[];
}

const SIGNIN_BLOCK_FAILED = '정지·삭제는 끝났지만 재로그인 차단을 적용하지 못했습니다. 아래 \'재로그인 차단 다시 적용\'을 눌러주세요.';
const AVATAR_ERASE_FAILED = '정지·삭제는 끝났지만 프로필 사진 파일을 지우지 못했습니다. 아래 \'프로필 사진 삭제 다시 적용\'을 눌러주세요.';

function revalidateMemberViews(profileId: string) {
  revalidatePath('/admin');
  revalidatePath('/admin/community/members');
  revalidatePath(KAKAO_UNLINK_QUEUE_PATH);
  revalidatePath(`/admin/customers/${profileId}`);
}

/** Auth 관리 API로 재로그인을 막고 DB가 auth.users를 직접 읽어 확인·기록하게 한다. 둘 다 성공해야 true다. */
async function applySigninBlock(supabase: Awaited<ReturnType<typeof createClient>>, profileId: string): Promise<boolean> {
  if (!await banWithdrawnMemberSignin(profileId)) return false;
  const { error } = await supabase.rpc('admin_confirm_member_withdrawal_signin_block', { target_profile_id: profileId });
  return !error;
}

export type MemberWithdrawalInquiryPreview = { ok: true; inquiry: MemberWithdrawalInquiry } | { ok: false; error: string };

/**
 * 처리 직전 확인창이 보여줄 문의 요약(유형·제목·작성일). 그 회원이 쓴 문의가 아니면 처리 전에 멈춘다.
 * 읽기만 하고, 같은 판정을 처리 RPC가 다시 한다.
 */
export async function previewMemberWithdrawalInquiryAction(
  profileIdValue: unknown,
  inquiryReferenceValue: unknown,
): Promise<MemberWithdrawalInquiryPreview> {
  if (!await requireAdminActionAccess('/admin/community/members', { capability: 'platform.manage' })) {
    return { ok: false, error: '관리자 권한이 필요합니다.' };
  }
  const profileId = typeof profileIdValue === 'string' ? profileIdValue.trim().toLowerCase() : '';
  const reference = typeof inquiryReferenceValue === 'string' ? parseInquiryReference(inquiryReferenceValue) : null;
  if (!isUuid(profileId)) return { ok: false, error: '회원을 찾을 수 없습니다.' };
  if (reference === null) return { ok: false, error: '탈퇴를 요청한 1:1 문의 번호(숫자)를 입력해주세요.' };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_member_withdrawal_inquiry', {
    target_profile_id: profileId, target_inquiry_reference: reference,
  });
  if (error) return { ok: false, error: memberWithdrawalRpcError(error.message) };
  const inquiry = parseMemberWithdrawalInquiry(data);
  if (inquiry === null) return { ok: false, error: memberWithdrawalRpcError('member_withdrawal_inquiry_not_found') };
  if (!inquiry) return { ok: false, error: '문의를 확인하지 못했습니다. 다시 시도해주세요.' };
  return { ok: true, inquiry };
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
  return finishWithdrawal(supabase, input.value.profileId, parseMemberWithdrawalOutcome(data));
}

/**
 * 처리 RPC 결과를 화면 상태로 바꾼다(문의·카카오 알림 공통). 처리됐으면 재로그인 차단을 걸고 회원 화면들을 다시 그린다.
 * 진행 중 의무가 남았으면 아무것도 바뀌지 않았으므로 남은 의무만 돌려준다.
 */
async function finishWithdrawal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  outcome: MemberWithdrawalOutcome | null,
): Promise<MemberWithdrawalActionState> {
  if (!outcome) return { errors: { form: '처리 결과를 확인하지 못했습니다. 화면을 새로고침해 상태를 확인해주세요.' } };
  if (outcome.status === 'blocked') {
    return { blockers: outcome.blockers, errors: { form: '진행 중인 거래·운영 권한이 남아 있어 처리하지 않았습니다. 아래 항목을 먼저 끝내주세요.' } };
  }

  const blocked = outcome.withdrawal.signinBlocked || await applySigninBlock(supabase, profileId);
  /* 프로필 사진 파일은 DB가 지울 수 없어 처리 뒤 앱 서버가 지운다. 실패해도 처리는 끝났으므로 다시 적용으로 재시도한다. */
  const avatarErased = !outcome.withdrawal.avatarErasePending || await eraseWithdrawnMemberAvatar(supabase, profileId);
  revalidateMemberViews(profileId);
  const basis = memberWithdrawalBasisLabel(outcome.withdrawal);
  const done = outcome.status === 'processed'
    ? `탈퇴 요청(${basis})을 처리했습니다 — ${memberWithdrawalErasedSummary(outcome.erased, outcome.revokedSessions)}.`
    : `이미 탈퇴 처리한 회원입니다(${basis}).`;
  if (!blocked) return { message: done, errors: { form: SIGNIN_BLOCK_FAILED } };
  return avatarErased ? { message: done } : { message: done, errors: { form: AVATAR_ERASE_FAILED } };
}

/**
 * 카카오로만 가입한 회원의 카카오계정 탈퇴 알림을 근거로 탈퇴를 처리한다(2026-11-19 결정). DB가 그 회원이 지금 탈퇴 검토 대기에 있고
 * 마지막 해제가 카카오계정이 없어진 사유인지 다시 확인한다 — 연결만 끊은 회원은 거절되고 1:1 문의 경로로 처리한다.
 * 처리 범위는 문의 탈퇴와 같고 카카오 로그인 연결 삭제를 더한다. 처리 뒤 재로그인 차단은 문의 탈퇴와 같다.
 */
export async function processKakaoUnlinkWithdrawalAction(
  _state: MemberWithdrawalActionState,
  formData: FormData,
): Promise<MemberWithdrawalActionState> {
  if (!await requireAdminActionAccess('/admin/community/members', { capability: 'platform.manage' })) {
    return { errors: { form: '관리자 권한이 필요합니다.' } };
  }
  const input = normalizeKakaoUnlinkWithdrawalForm(formData);
  if (!input.ok) return { errors: input.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_process_kakao_unlink_withdrawal', {
    target_profile_id: input.value.profileId,
    target_note: input.value.note,
  });
  if (error) return { errors: { form: memberWithdrawalRpcError(error.message, 'kakao_unlink') } };
  return finishWithdrawal(supabase, input.value.profileId, parseMemberWithdrawalOutcome(data));
}

/** 처리 뒤 재로그인 차단이나 프로필 사진 삭제만 실패했을 때 다시 한다. 처리 기록이 있는 회원에게만 건다. */
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
  const supabase = await createClient();
  if (!status.signinBlocked && !await applySigninBlock(supabase, input.value.profileId)) {
    return { errors: { form: '재로그인 차단을 적용하지 못했습니다. 잠시 뒤 다시 시도해주세요.' } };
  }
  if (status.avatarErasePending && !await eraseWithdrawnMemberAvatar(supabase, input.value.profileId)) {
    revalidateMemberViews(input.value.profileId);
    return { errors: { form: '프로필 사진 파일을 지우지 못했습니다. 잠시 뒤 다시 시도해주세요.' } };
  }
  revalidateMemberViews(input.value.profileId);
  const avatar = status.avatarErasePending === true;
  if (status.signinBlocked && avatar) return { message: '프로필 사진 삭제를 적용했습니다.' };
  return { message: avatar ? '재로그인 차단과 프로필 사진 삭제를 적용했습니다.' : '재로그인 차단을 적용했습니다.' };
}

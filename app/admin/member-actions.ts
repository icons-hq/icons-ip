'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  normalizeAdminMemberDetailForm,
  normalizeAdminMemberLoyaltyForm,
  normalizeAdminMemberSearchForm,
  normalizeAdminMemberSuspensionForm,
  type AdminMemberDetail,
  type AdminMemberSummary,
} from '@/lib/admin/members';
import { getAdminMemberDetail, getAdminMemberSummaries } from '@/lib/admin/members.server';
import { getCurrentAdminAuthState } from '@/lib/auth/admin';
import { createClient } from '@/lib/supabase/server';

export interface AdminMemberSearchActionState {
  members: AdminMemberSummary[];
  query: string;
  errors?: Record<string, string>;
}

export interface AdminMemberDetailActionState {
  member: AdminMemberDetail | null;
  errors?: Record<string, string>;
}

export interface AdminMemberMutationActionState {
  errors?: Record<string, string>;
  message?: string;
}

async function requireStaffAction(): Promise<AdminMemberMutationActionState | null> {
  const auth = await getCurrentAdminAuthState();
  if (!auth.isConfigured || !auth.user) redirect(`/login?next=${encodeURIComponent('/admin')}`);
  if (!auth.isStaff) return { errors: { form: '관리자 권한이 필요합니다.' } };
  return null;
}

export async function searchAdminMembersAction(
  state: AdminMemberSearchActionState,
  formData: FormData,
): Promise<AdminMemberSearchActionState> {
  const authError = await requireStaffAction();
  if (authError) return { members: [], query: state.query, errors: authError.errors };

  const result = normalizeAdminMemberSearchForm(formData);
  if (!result.ok) return { members: [], query: state.query, errors: result.errors };

  try {
    const members = await getAdminMemberSummaries(result.value.query);
    return { members, query: result.value.query };
  } catch {
    return {
      members: [],
      query: result.value.query,
      errors: { form: '회원을 검색하지 못했습니다. 다시 시도해주세요.' },
    };
  }
}

export async function loadAdminMemberDetailAction(
  state: AdminMemberDetailActionState,
  formData: FormData,
): Promise<AdminMemberDetailActionState> {
  const authError = await requireStaffAction();
  if (authError) return { member: null, errors: authError.errors };

  const result = normalizeAdminMemberDetailForm(formData);
  if (!result.ok) return { member: null, errors: result.errors };

  try {
    const member = await getAdminMemberDetail(result.value.profileId);
    return member
      ? { member }
      : { member: null, errors: { form: '회원을 찾을 수 없습니다.' } };
  } catch {
    return { member: null, errors: { form: '회원 상세를 불러오지 못했습니다. 다시 시도해주세요.' } };
  }
}

function suspensionRpcError(message: string): string {
  if (message.includes('cannot_suspend_self') || message.includes('cannot_suspend_admin')) {
    return '본인 또는 admin 계정은 정지할 수 없습니다.';
  }
  if (message.includes('cannot_unsuspend_self') || message.includes('cannot_unsuspend_admin')) {
    return '본인 또는 admin 계정은 정지 해제할 수 없습니다.';
  }
  if (message.includes('profile_not_found')) return '회원을 찾을 수 없습니다.';
  if (message.includes('forbidden') || message.includes('account_suspended')) {
    return '이 계정을 제재할 권한이 없습니다.';
  }
  return '회원 제재 상태를 변경하지 못했습니다. 최신 상태를 확인한 뒤 다시 시도해주세요.';
}

export async function suspendAdminMemberAction(
  _state: AdminMemberMutationActionState,
  formData: FormData,
): Promise<AdminMemberMutationActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminMemberSuspensionForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_suspend_user', {
    target_profile_id: result.value.profileId,
    target_reason: result.value.reason,
  });
  if (error) return { errors: { form: suspensionRpcError(error.message) } };

  revalidatePath('/admin');
  return { message: '회원을 정지했습니다.' };
}

export async function unsuspendAdminMemberAction(
  _state: AdminMemberMutationActionState,
  formData: FormData,
): Promise<AdminMemberMutationActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminMemberDetailForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_unsuspend_user', {
    target_profile_id: result.value.profileId,
  });
  if (error) return { errors: { form: suspensionRpcError(error.message) } };

  revalidatePath('/admin');
  return { message: '회원 정지를 해제했습니다.' };
}


/* 회원 등급 수동 보정 (S7 #329). 감사 이력(loyalty_grade_events·audit_log)은
   admin_adjust_loyalty_grade RPC 가 남기고, 승급이면 등급 혜택 쿠폰까지 같은
   경로로 발급된다. */
export async function adjustMemberLoyaltyAction(
  _state: AdminMemberMutationActionState,
  formData: FormData,
): Promise<AdminMemberMutationActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminMemberLoyaltyForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { error } = await supabase.rpc('admin_adjust_loyalty_grade', {
    p_user_id: result.value.profileId,
    p_grade: result.value.grade,
    p_note: result.value.note,
  });
  if (error) {
    return { errors: { form: '등급을 보정하지 못했습니다. 다시 시도해주세요.' } };
  }

  revalidatePath('/admin');
  return { message: `등급을 ${result.value.grade.toUpperCase()} 로 보정했습니다. 상세 보기를 다시 열면 반영된 값이 보입니다.` };
}

/* 결제 트리거가 삼킨 재산정 실패를 사람 손으로 따라잡는 복구 경로. */
export async function recalculateMemberLoyaltyAction(
  _state: AdminMemberMutationActionState,
  formData: FormData,
): Promise<AdminMemberMutationActionState> {
  const authError = await requireStaffAction();
  if (authError) return authError;

  const result = normalizeAdminMemberDetailForm(formData);
  if (!result.ok) return { errors: result.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('admin_recalculate_loyalty_grade', {
    p_user_id: result.value.profileId,
  });
  if (error) {
    return { errors: { form: '등급을 재산정하지 못했습니다. 다시 시도해주세요.' } };
  }

  revalidatePath('/admin');
  const grade = typeof data === 'string' ? data.toUpperCase() : null;
  return { message: grade ? `재산정 결과 ${grade} 등급입니다.` : '재산정을 실행했습니다.' };
}

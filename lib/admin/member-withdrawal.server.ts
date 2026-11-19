import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient, getServiceRoleConfig } from '@/lib/supabase/service';
import { parseMemberWithdrawalStatus, WITHDRAWN_MEMBER_BAN_DURATION, type MemberWithdrawalStatus } from './member-withdrawal';

/** 고객 상세가 읽는 탈퇴 처리 상태. 읽지 못하면 null — 화면은 처리 동작을 그리지 않는다. */
export async function getMemberWithdrawalStatus(profileId: string): Promise<MemberWithdrawalStatus | null> {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_member_withdrawal_status', { target_profile_id: profileId });
  return error ? null : parseMemberWithdrawalStatus(data);
}

/**
 * 탈퇴 처리한 회원의 재로그인을 막는다(Supabase Auth 관리 API ban — 로그인·토큰 갱신 거절).
 * DB가 처리 기록을 남긴 뒤에만 부른다. 관리 API에는 사용자 id로 세션을 끊는 호출이 없어 세션 삭제는 DB RPC가 한다.
 * 결과는 `admin_confirm_member_withdrawal_signin_block`이 auth.users를 직접 읽어 확인한다 — 여기서는 성공 여부만 돌려준다.
 */
export async function banWithdrawnMemberSignin(
  profileId: string,
  service?: Pick<ReturnType<typeof createServiceClient>, 'auth'>,
): Promise<boolean> {
  if (!service && !getServiceRoleConfig().isConfigured) return false;
  try {
    const client = service ?? createServiceClient();
    const { error } = await client.auth.admin.updateUserById(profileId, { ban_duration: WITHDRAWN_MEMBER_BAN_DURATION });
    return !error;
  } catch {
    return false;
  }
}

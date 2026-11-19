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

type AvatarEraseClient = Pick<Awaited<ReturnType<typeof createClient>>, 'rpc'>;

/**
 * 탈퇴 처리한 회원의 프로필 사진 Storage 객체를 지운다. 지울 경로는 DB 처리 기록이 갖고(`admin_member_withdrawal_avatar_path`),
 * 객체는 Storage API로만 지울 수 있어(SQL 직접 삭제는 DB가 막는다) 앱 서버가 service role로 지운다. 지운 뒤
 * `admin_confirm_member_withdrawal_avatar_erased`가 storage.objects에서 사라졌는지 직접 읽어 확인·기록한다.
 * 지울 사진이 없으면 true다. 성공 여부만 돌려주고 실패는 다시 적용으로 재시도한다(Storage 삭제는 없는 객체도 성공이다).
 */
export async function eraseWithdrawnMemberAvatar(
  supabase: AvatarEraseClient,
  profileId: string,
  service?: { storage: { from: (bucket: string) => { remove: (paths: string[]) => PromiseLike<{ error: unknown }> } } },
): Promise<boolean> {
  const { data: path, error } = await supabase.rpc('admin_member_withdrawal_avatar_path', { target_profile_id: profileId });
  if (error) return false;
  if (path === null) return true;
  if (typeof path !== 'string' || !path.startsWith(`${profileId}/profile/`)) return false;
  if (!service && !getServiceRoleConfig().isConfigured) return false;
  try {
    const removed = await (service ?? createServiceClient()).storage.from('user-uploads').remove([path]);
    if (removed.error) return false;
  } catch {
    return false;
  }
  const { error: confirmError } = await supabase.rpc('admin_confirm_member_withdrawal_avatar_erased', { target_profile_id: profileId });
  return !confirmError;
}

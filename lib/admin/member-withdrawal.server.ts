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
type AvatarStorage = {
  storage: { from: (bucket: string) => {
    list: (path: string, options?: { limit?: number }) => PromiseLike<{ data: { name: string; id?: string | null }[] | null; error: unknown }>;
    remove: (paths: string[]) => PromiseLike<{ error: unknown }>;
  } };
};

/* 접두 하나에 보통 한두 개뿐이다(현재 사진·정리 실패한 이전 파일·후보). 비정상으로 많아도 무한히 돌지 않도록 회차를 제한한다. */
const AVATAR_LIST_LIMIT = 100;
const AVATAR_ERASE_MAX_ROUNDS = 20;

/**
 * 탈퇴 처리한 회원의 프로필 사진 Storage 객체를 지운다. 대상은 그 회원의 `<id>/profile/` 접두 아래 전부다 — 현재 사진뿐 아니라
 * 사진 교체 때 정리에 실패한 이전 파일과 업로드만 하고 저장하지 않은 후보도 포함한다. 접두는 DB가 처리 기록에서 정해
 * (`admin_member_withdrawal_avatar_prefix`) 앱은 버킷(user-uploads)·접두를 고정으로만 쓴다. 객체는 Storage API로만 지울 수 있어(SQL
 * 직접 삭제는 DB가 막는다) 앱 서버가 service role로 지우고, `admin_confirm_member_withdrawal_avatar_erased`가 storage.objects에
 * 그 접두 객체가 0개인지 직접 읽어 확인·기록한다. 지울 사진이 없으면 true다. 성공 여부만 돌려주고 실패는 다시 적용으로 재시도한다.
 */
export async function eraseWithdrawnMemberAvatar(
  supabase: AvatarEraseClient,
  profileId: string,
  service?: AvatarStorage,
): Promise<boolean> {
  const { data: prefix, error } = await supabase.rpc('admin_member_withdrawal_avatar_prefix', { target_profile_id: profileId });
  if (error) return false;
  if (prefix === null) return true;
  if (prefix !== `${profileId}/profile/`) return false;
  if (!service && !getServiceRoleConfig().isConfigured) return false;
  try {
    const bucket = (service ?? (createServiceClient() as unknown as AvatarStorage)).storage.from('user-uploads');
    const directory = prefix.slice(0, -1);
    for (let round = 0; round < AVATAR_ERASE_MAX_ROUNDS; round += 1) {
      const listed = await bucket.list(directory, { limit: AVATAR_LIST_LIMIT });
      if (listed.error) return false;
      const names = (listed.data ?? []).filter((entry) => entry.id !== null && entry.id !== undefined).map((entry) => entry.name);
      if (names.length === 0) break;
      if (names.some((name) => name.includes('/'))) return false;
      const removed = await bucket.remove(names.map((name) => `${prefix}${name}`));
      if (removed.error) return false;
      if (names.length < AVATAR_LIST_LIMIT) break;
    }
  } catch {
    return false;
  }
  const { error: confirmError } = await supabase.rpc('admin_confirm_member_withdrawal_avatar_erased', { target_profile_id: profileId });
  return !confirmError;
}

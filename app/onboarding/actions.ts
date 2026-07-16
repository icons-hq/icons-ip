'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { safeNextPath } from '@/lib/auth/onboarding';
import { buildRecommendedIpFollowChanges, uniqueSelectedIpIds } from '@/lib/ip-follow';
import { normalizeProfileNickname } from '@/lib/profile';
import { updateProfileIdentity } from '@/lib/profile.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

export interface OnboardingActionState {
  errors?: {
    nickname?: string;
    birthDate?: string;
    terms?: string;
    privacy?: string;
    form?: string;
  };
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

function isFutureDate(value: string) {
  const birthDate = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(birthDate.getTime())) return true;

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  return birthDate > todayUtc;
}

async function filterExistingRecommendedIpIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recommendedIpIds: string[],
) {
  if (!recommendedIpIds.length) return [];

  const { data, error } = await supabase
    .from('ips')
    .select('id')
    .in('id', recommendedIpIds);

  if (error) {
    throw new Error(`Failed to validate recommended IPs: ${error.message}`);
  }

  return uniqueSelectedIpIds(recommendedIpIds, new Set(((data ?? []) as { id: string }[]).map((row) => row.id)));
}

async function getFollowedRecommendedIpIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  recommendedIpIds: string[],
) {
  if (!recommendedIpIds.length) return [];

  const { data, error } = await supabase
    .from('ip_follows')
    .select('ip_id')
    .eq('user_id', userId)
    .in('ip_id', recommendedIpIds);

  if (error) {
    throw new Error(`Failed to load followed recommendations: ${error.message}`);
  }

  return uniqueSelectedIpIds(((data ?? []) as { ip_id: string }[]).map((row) => row.ip_id), new Set(recommendedIpIds));
}

export async function completeOnboardingAction(
  _state: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const nicknameResult = normalizeProfileNickname(formData.get('nickname'));
  const nickname = nicknameResult.ok ? nicknameResult.value : '';
  const birthDate = readString(formData, 'birthDate');
  const next = safeNextPath(formData.get('next'));
  const terms = formData.get('terms') === 'on';
  const privacy = formData.get('privacy') === 'on';
  const marketing = formData.get('marketing') === 'on';
  const selectedIpIds = uniqueSelectedIpIds(formData.getAll('followIpIds'));
  const recommendedIpIds = uniqueSelectedIpIds(formData.getAll('recommendedIpIds'));
  const errors: NonNullable<OnboardingActionState['errors']> = {};

  if (!nicknameResult.ok) errors.nickname = nicknameResult.error;
  if (!birthDate || isFutureDate(birthDate)) errors.birthDate = '생년월일을 확인해주세요.';
  if (!terms) errors.terms = '필수 약관에 동의해주세요.';
  if (!privacy) errors.privacy = '개인정보 처리방침에 동의해주세요.';

  if (Object.keys(errors).length) return { errors };

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 온보딩을 완료할 수 있습니다.' } };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;

  if (userError || !user) return { errors: { form: '로그인이 필요합니다.' } };

  let existingRecommendedIpIds: string[];
  let followedRecommendedIpIds: string[];
  try {
    existingRecommendedIpIds = await filterExistingRecommendedIpIds(supabase, recommendedIpIds);
    followedRecommendedIpIds = await getFollowedRecommendedIpIds(supabase, user.id, existingRecommendedIpIds);
  } catch {
    return { errors: { form: '관심 IP를 확인하지 못했습니다. 다시 시도해주세요.' } };
  }

  const followChanges = buildRecommendedIpFollowChanges({
    followedIpIds: followedRecommendedIpIds,
    recommendedIpIds: existingRecommendedIpIds,
    selectedIpIds,
  });

  const identityResult = await updateProfileIdentity({
    userId: user.id,
    nickname,
    avatarPath: null,
    replaceAvatar: false,
  });

  if (!identityResult.ok && identityResult.errorCode === '23505') {
    return { errors: { nickname: '이미 사용 중인 닉네임입니다.' } };
  }
  if (!identityResult.ok) {
    return { errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  const { error } = await supabase
    .from('profiles')
    .update({
      birth_date: birthDate,
      consents: { terms, privacy, marketing },
    })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) return { errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' } };

  for (const ipId of followChanges.toFollow) {
    const { error: followError } = await supabase.rpc('follow_ip', { target_ip_id: ipId });
    if (followError) return { errors: { form: '관심 IP를 저장하지 못했습니다. 다시 시도해주세요.' } };
    revalidatePath(`/ip/${ipId}`);
  }

  for (const ipId of followChanges.toUnfollow) {
    const { error: unfollowError } = await supabase.rpc('unfollow_ip', { target_ip_id: ipId });
    if (unfollowError) return { errors: { form: '관심 IP를 저장하지 못했습니다. 다시 시도해주세요.' } };
    revalidatePath(`/ip/${ipId}`);
  }

  const { error: completeError } = await supabase
    .from('profiles')
    .update({ onboarded_at: new Date().toISOString() })
    .eq('id', user.id)
    .select('id')
    .single();

  if (completeError) return { errors: { form: '온보딩 완료 상태를 저장하지 못했습니다. 다시 시도해주세요.' } };

  revalidatePath('/');
  revalidatePath('/ip');

  redirect(next);
}

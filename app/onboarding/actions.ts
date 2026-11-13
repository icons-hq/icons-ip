'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { meetsMinimumSignupAge } from '@/lib/age/minimum-age';
import { addressBookOnboardingPath } from '@/lib/address-book';
import { AUTO_NICKNAME_MAX_ATTEMPTS, generateAutoNickname } from '@/lib/auth/nickname';
import { safeNextPath } from '@/lib/auth/onboarding';
import { isDemographicGender, type DemographicGender } from '@/lib/customer-demographics';
import { customerDemographicState, updateCustomerDemographicChoice } from '@/lib/customer-demographics.server';
import { buildRecommendedIpFollowChanges, uniqueSelectedIpIds } from '@/lib/ip-follow';
import { kakaoChannelConfig } from '@/lib/kakao/channel-config.server';
import { syncKakaoChannelFriendReward } from '@/lib/kakao/channel-reward.server';
import { readMarketingChannelChoices } from '@/lib/marketing-consent';
import { saveMyMarketingConsents } from '@/lib/marketing-consent.server';
import { updateProfileIdentity } from '@/lib/profile.server';
import { phoneVerificationConfig, readMyVerifiedPhone } from '@/lib/sms/phone-verification.server';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { createClient } from '@/lib/supabase/server';

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export interface OnboardingActionState {
  errors?: {
    birthDate?: string;
    terms?: string;
    privacy?: string;
    gender?: string;
    form?: string;
  };
  /**
   * 휴대폰 번호 인증 스위치가 켜졌을 때(1014-005·006): 생년월일·약관 동의(1단계)를 저장했고 이제 휴대폰 번호 인증
   * 단계로 간다. 동의 전에는 번호를 받지 않는다.
   */
  phoneStep?: boolean;
  /** 1단계에서 고른 선택 성별. 성별 동의 저장은 온보딩을 마친 뒤에만 열리므로 인증 단계의 완료 폼이 다시 보낸다. */
  carriedGender?: DemographicGender;
}

function readString(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}

/* 앱 폼과 DB 트리거가 같은 문장을 쓴다. 우회 경로로 막혔을 때만 다른 말이 나오면
 * 이용자는 같은 거절을 두 가지 이유로 읽는다. */
const MINIMUM_AGE_ERROR = '만 14세 이상만 가입할 수 있습니다.';

function readBirthDate(formData: FormData) {
  let year = readString(formData, 'birthYear').trim();
  let month = readString(formData, 'birthMonth').trim();
  let day = readString(formData, 'birthDay').trim();
  const hasGroupedValue = Boolean(year || month || day);

  if (!hasGroupedValue) {
    const legacyValue = readString(formData, 'birthDate').trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(legacyValue);
    if (!legacyValue) return { error: '생년월일을 입력해주세요.', value: '' };
    if (!match) return { error: '실제로 존재하는 생년월일을 입력해주세요.', value: '' };
    [, year, month, day] = match;
  }

  if (!year || !month || !day) {
    return { error: '생년월일에 연도, 월, 일을 모두 입력해주세요.', value: '' };
  }
  if (!/^\d{4}$/.test(year)) {
    return { error: '연도는 4자리로 입력해주세요.', value: '' };
  }
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day)) {
    return { error: '실제로 존재하는 생년월일을 입력해주세요.', value: '' };
  }

  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const value = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const birthDate = new Date(`${value}T00:00:00.000Z`);

  if (
    yearNumber < 1
    || Number.isNaN(birthDate.getTime())
    || birthDate.getUTCFullYear() !== yearNumber
    || birthDate.getUTCMonth() + 1 !== monthNumber
    || birthDate.getUTCDate() !== dayNumber
  ) {
    return { error: '실제로 존재하는 생년월일을 입력해주세요.', value: '' };
  }

  const today = new Date();
  const todayUtc = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  if (birthDate > todayUtc) {
    return { error: '생년월일은 오늘 또는 이전 날짜로 입력해주세요.', value: '' };
  }

  /* v1 가입 기준은 만 14세다(ADR-0009). 여기서 막는 것은 이용자에게 이유를 보여주기
   * 위해서이고, 실제 강제는 profiles 트리거가 한다 — 이 폼을 거치지 않는 쓰기도 있다. */
  if (!meetsMinimumSignupAge(value)) {
    return { error: MINIMUM_AGE_ERROR, value: '' };
  }

  return { value };
}

/* 선택 성별(10/14 회의 S5). 고르지 않으면 아무것도 저장하지 않는다(미선택 유지).
 * 고른 경우에만 별도 수집·이용 동의를 함께 받는다 — 한쪽만 있으면 저장하지 않고 이유를 말한다. */
function readOnboardingGender(formData: FormData): { gender: DemographicGender | null; error?: string } {
  const value = readString(formData, 'gender');
  const consent = formData.get('genderConsent') === 'on';
  if (!value) return consent ? { gender: null, error: '동의하려면 성별을 선택해주세요.' } : { gender: null };
  if (!isDemographicGender(value)) return { gender: null, error: '성별을 다시 선택해주세요.' };
  if (!consent) return { gender: null, error: '성별을 저장하려면 수집·이용에 동의해주세요.' };
  return { gender: value };
}

/* 성별은 기존 선택 동의 경로(customer_demographic_consent)로 저장한다. 그 경로는 온보딩을 마친
 * 회원에게만 열리므로 완료 직후 같은 액션에서 부른다. 선택 항목이라 실패해도 가입을 되돌리지
 * 않는다 — 설정 화면이 현재 선택을 보여 주고 다시 저장할 수 있다. */
async function saveOnboardingGender(gender: DemographicGender) {
  try {
    const state = await customerDemographicState();
    if (!state || (state.choice === 'accepted' && state.gender === gender)) return;
    await updateCustomerDemographicChoice('accepted', gender, state);
  } catch {
    // 선택 동의 저장 실패는 온보딩 완료를 막지 않는다.
  }
}

/*
 * 가입 간소화(10/14 회의 1014-004): 온보딩은 닉네임을 묻지 않는다. 닉네임이 없는 계정이면 자동 닉네임을
 * 만들어 기존 프로필 저장 경로(service_update_profile_identity)로 저장하고, 이미 있으면(다시 온보딩하는
 * 계정·운영자 초대 계정) 그대로 둔다. 닉네임은 설정 화면에서 언제든 바꿀 수 있다.
 * 자동 닉네임이 다른 회원과 겹치면(unique 23505) 새 값으로 다시 시도한다.
 */
async function ensureProfileNickname(
  supabase: SupabaseServerClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('profiles')
    .select('nickname')
    .eq('id', userId)
    .maybeSingle<{ nickname: string | null }>();
  if (error) return { ok: false, error: '프로필을 확인하지 못했습니다. 다시 시도해주세요.' };
  if (data?.nickname?.trim()) return { ok: true };

  for (let attempt = 0; attempt < AUTO_NICKNAME_MAX_ATTEMPTS; attempt += 1) {
    const result = await updateProfileIdentity({
      userId,
      nickname: generateAutoNickname(),
      avatarPath: null,
      replaceAvatar: false,
    });
    if (result.ok) return { ok: true };
    if (result.errorCode !== '23505') break;
  }
  return { ok: false, error: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' };
}

async function filterExistingRecommendedIpIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  recommendedIpIds: string[],
) {
  if (!recommendedIpIds.length) return [];

  const { data, error } = await supabase
    .from('ips')
    .select('id')
    .is('archived_at', null)
    .not('published_at', 'is', null)
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
  const birthDateResult = readBirthDate(formData);
  const birthDate = birthDateResult.value;
  const next = safeNextPath(formData.get('next'));
  const terms = formData.get('terms') === 'on';
  const privacy = formData.get('privacy') === 'on';
  const marketingChoices = readMarketingChannelChoices(formData, { kakaoChannelOn: kakaoChannelConfig() !== null });
  const genderResult = readOnboardingGender(formData);
  const selectedIpIds = uniqueSelectedIpIds(formData.getAll('followIpIds'));
  const recommendedIpIds = uniqueSelectedIpIds(formData.getAll('recommendedIpIds'));
  const errors: NonNullable<OnboardingActionState['errors']> = {};

  if (birthDateResult.error) errors.birthDate = birthDateResult.error;
  if (!terms) errors.terms = '필수 약관에 동의해주세요.';
  if (!privacy) errors.privacy = '개인정보 처리방침에 동의해주세요.';
  if (genderResult.error) errors.gender = genderResult.error;

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

  const nicknameResult = await ensureProfileNickname(supabase, user.id);
  if (!nicknameResult.ok) return { errors: { form: nicknameResult.error } };

  const { error } = await supabase
    .from('profiles')
    .update({
      birth_date: birthDate,
      /* consents.marketing은 채널별 수신 동의 원장의 파생값이라 여기서 쓰지 않는다 — 아래 RPC가
         원장과 함께 바꾸고, 키가 빠진 이 덮어쓰기에는 DB 트리거가 이전 값을 그대로 둔다(S4). */
      consents: { terms, privacy },
    })
    .eq('id', user.id)
    .select('id')
    .single();

  if (error) {
    /* 트리거가 막은 경우다. 폼 검증과 같은 필드·같은 문장으로 되돌려 준다. */
    if (error.message.includes('minimum_age_required')) {
      return { errors: { birthDate: MINIMUM_AGE_ERROR } };
    }
    return { errors: { form: '프로필을 저장하지 못했습니다. 다시 시도해주세요.' } };
  }

  const marketingResult = await saveMyMarketingConsents(supabase, marketingChoices, 'onboarding');
  if (!marketingResult.ok) return { errors: { form: '마케팅 정보 수신 동의를 저장하지 못했습니다. 다시 시도해주세요.' } };

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

  /* 휴대폰 번호 인증(1014-005·006)은 스위치가 켜졌을 때만 온보딩 2단계다. 생년월일·약관 동의를 먼저 저장한 뒤
     (위) 인증 단계로 보낸다 — 동의·만 14세 확인 전에는 번호를 받지 않는다. 이미 인증한 계정은 바로 마친다.
     스위치가 꺼져 있으면 읽지도 않는다. */
  if (phoneVerificationConfig()) {
    const verifiedPhone = await readMyVerifiedPhone(supabase);
    if (!verifiedPhone?.verified) {
      revalidatePath('/onboarding');
      return { phoneStep: true, ...(genderResult.gender ? { carriedGender: genderResult.gender } : {}) };
    }
  }

  return completeOnboarding(supabase, user.id, { alreadyOnboarded: false, gender: genderResult.gender, next });
}

/*
 * 온보딩 완료 처리. 1단계만으로 끝나는 경우(스위치 OFF·이미 인증한 번호)와 휴대폰 인증 단계의 [ICONS 시작하기]가 같이 쓴다.
 * 이미 온보딩을 마친 계정(번호를 다른 계정에 옮겨 가 다시 인증한 회원)은 완료 시각을 바꾸지 않고 원래 가려던 곳으로 보낸다.
 */
async function completeOnboarding(
  supabase: SupabaseServerClient,
  userId: string,
  options: { alreadyOnboarded: boolean; gender: DemographicGender | null; next: string },
): Promise<OnboardingActionState> {
  if (!options.alreadyOnboarded) {
    const { error: completeError } = await supabase
      .from('profiles')
      .update({ onboarded_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id')
      .single();

    if (completeError) return { errors: { form: '온보딩 완료 상태를 저장하지 못했습니다. 다시 시도해주세요.' } };
  }
  if (options.gender) await saveOnboardingGender(options.gender);
  /* 카카오톡 채널 친구 추가 쿠폰(1014-014, 스위치 OFF 기본)은 온보딩을 마친 회원만 받는다. 카카오 로그인 동의 화면에서
     채널을 추가하고 막 가입한 회원은 여기서 처음 대상이 된다. 응답 뒤에 확인하고, 실패해도 온보딩은 끝난다. */
  if (kakaoChannelConfig()) {
    after(async () => {
      await syncKakaoChannelFriendReward({ userId, via: 'onboarding' });
    });
  }

  revalidatePath('/');
  revalidatePath('/ip');

  /* 온보딩을 마치면 배송지 등록 안내(건너뛸 수 있음)를 한 번 거쳐 원래 가려던 곳으로 간다(L7 · 10/14 S3).
     안내 화면은 이미 주소록이 있거나 읽지 못하면 바로 next 로 보낸다 — 가입·주문을 막지 않는다. */
  redirect(options.alreadyOnboarded ? options.next : addressBookOnboardingPath(options.next));
}

/*
 * 휴대폰 번호 인증 단계의 [ICONS 시작하기](1014-005·006, 스위치 ON). 1단계(생년월일·약관 동의)를 저장했고 번호를
 * 인증했을 때만 온보딩을 마친다. 다른 계정이 번호를 옮겨 가 다시 인증한 회원도 이 버튼으로 하던 일로 돌아간다.
 */
export async function finishOnboardingAction(
  _state: OnboardingActionState,
  formData: FormData,
): Promise<OnboardingActionState> {
  const next = safeNextPath(formData.get('next'));
  const carried = readOnboardingGender(formData);
  const carriedGender = carried.error ? null : carried.gender;

  const { isConfigured } = getSupabaseConfig();
  if (!isConfigured) return { errors: { form: 'Supabase 환경변수를 설정한 뒤 온보딩을 완료할 수 있습니다.' } };

  const supabase = await createClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  const user = userData.user;
  if (userError || !user) return { errors: { form: '로그인이 필요합니다.' } };

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('birth_date,consents,onboarded_at')
    .eq('id', user.id)
    .maybeSingle<{ birth_date: string | null; consents: { terms?: boolean | null; privacy?: boolean | null } | null; onboarded_at: string | null }>();
  if (profileError) return { errors: { form: '프로필을 확인하지 못했습니다. 다시 시도해주세요.' } };
  if (!profile?.birth_date || profile.consents?.terms !== true || profile.consents?.privacy !== true) {
    return { errors: { form: '생년월일과 약관 동의를 먼저 저장해주세요. 화면을 새로고침한 뒤 다시 시도해주세요.' } };
  }

  if (phoneVerificationConfig()) {
    const verifiedPhone = await readMyVerifiedPhone(supabase);
    if (!verifiedPhone?.verified) {
      return {
        phoneStep: true,
        ...(carriedGender ? { carriedGender } : {}),
        errors: { form: '휴대폰 번호 인증을 먼저 마쳐주세요.' },
      };
    }
  }

  return completeOnboarding(supabase, user.id, { alreadyOnboarded: Boolean(profile.onboarded_at), gender: carriedGender, next });
}

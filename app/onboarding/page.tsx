import { redirect } from 'next/navigation';
import { Onboarding } from '@/components/screens/Onboarding';
import { isUnusableLoginEmail } from '@/lib/auth/email-change';
import { emailChangeConfig } from '@/lib/auth/email-change.server';
import { isOnboarded, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { kakaoChannelConfig } from '@/lib/kakao/channel-config.server';
import { MARKETING_CHANNELS, MARKETING_CHANNELS_WITH_KAKAO, marketingChannelChoices, marketingKakaoVisible } from '@/lib/marketing-consent';
import { readMyMarketingConsentState } from '@/lib/marketing-consent.server';
import { phoneVerificationConfig, phoneVerificationView, readMyVerifiedPhone } from '@/lib/sms/phone-verification.server';
import { createClient } from '@/lib/supabase/server';

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const next = safeNextPath(firstParam(params.next));
  const auth = await getCurrentAuthState();

  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent(`/onboarding?next=${encodeURIComponent(next)}`)}`);
  }

  if (auth.user && isOnboarded(auth.profile, auth.user.email)) redirect(next);

  /* 휴대폰 번호 인증은 스위치가 켜졌을 때만 읽는다 — 꺼져 있으면 DB도 화면도 예전과 같다(1014-005·006). */
  const phoneConfig = auth.user ? phoneVerificationConfig() : null;
  const [marketingConsent, verifiedPhone] = await Promise.all([
    auth.user ? readMyMarketingConsentState() : Promise.resolve(null),
    phoneConfig ? createClient().then(readMyVerifiedPhone) : Promise.resolve(null),
  ]);
  /* 카카오톡 수신 동의 줄은 카카오톡 채널 스위치가 켜졌거나 이미 동의한 회원에게만 그린다(1014-010). */
  const withKakao = marketingKakaoVisible(kakaoChannelConfig() !== null, marketingConsent);
  /* 로그인 이메일이 쓸 수 없는 주소(Apple 이메일 가리기 릴레이·빈 값)면 다른 이메일로 바꾸는 조각을 연다(2026-11-17). */
  const loginEmail = auth.user?.email?.trim() ?? '';
  /* 이메일이 없는 계정은 바꾸기 전에 온보딩을 마칠 수 없다 — 메일 설정이 없어 바꿀 수 없으면 그 사실을 알린다. */
  const emailChangeOpen = Boolean(auth.user) && isUnusableLoginEmail(loginEmail) && emailChangeConfig() !== null;
  const emailChange = auth.user && isUnusableLoginEmail(loginEmail) && (emailChangeOpen || !loginEmail)
    ? { currentEmail: loginEmail, required: !loginEmail, ...(emailChangeOpen ? {} : { unavailable: true }) }
    : undefined;

  return (
    <Onboarding
      birthDate={auth.profile?.birth_date ?? ''}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      emailChange={emailChange}
      genderEligible={!auth.profile || auth.profile.role === 'user'}
      initialMarketing={marketingChannelChoices(marketingConsent, { withKakao })}
      isConfigured={auth.isConfigured}
      marketingChannels={withKakao ? MARKETING_CHANNELS_WITH_KAKAO : MARKETING_CHANNELS}
      next={next}
      /* 스위치가 켜졌고 1단계(생년월일·약관 동의)를 이미 저장했으면 휴대폰 인증 단계부터 연다. */
      phoneStep={Boolean(phoneConfig) && Boolean(loginEmail) && Boolean(auth.profile?.birth_date)
        && auth.profile?.consents?.terms === true && auth.profile?.consents?.privacy === true}
      phoneVerification={phoneConfig ? phoneVerificationView(phoneConfig, verifiedPhone) : undefined}
    />
  );
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Settings } from '@/components/screens/Settings';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getAccountDeletionPresentation } from '@/lib/account-deletion.server';
import { UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION } from '@/lib/account-deletion';
import { getProfileAvatarPresentation } from '@/lib/profile-avatar.server';
import { readMyMarketingConsentState } from '@/lib/marketing-consent.server';
import { kakaoChannelConfig } from '@/lib/kakao/channel-config.server';
import { MARKETING_CHANNELS, MARKETING_CHANNELS_WITH_KAKAO, marketingKakaoVisible } from '@/lib/marketing-consent';
import { phoneVerificationConfig, phoneVerificationView, readMyVerifiedPhone } from '@/lib/sms/phone-verification.server';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: '설정 — ICONS',
  description: '프로필을 편집하고 계정 정보와 마케팅 정보 수신 동의를 관리하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();

  if (auth.isConfigured && !auth.user) {
    redirect(`/login?next=${encodeURIComponent('/settings')}`);
  }

  if (auth.user && !isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath('/settings'));
  }

  const nickname = auth.profile?.nickname ?? '';
  /* 휴대폰 번호 인증은 스위치가 켜졌을 때만 읽는다 — 꺼져 있으면 설정 화면은 예전과 같다(1014-005·006). */
  const phoneConfig = auth.isConfigured && auth.user ? phoneVerificationConfig() : null;
  const [avatar, accountDeletion, marketingConsent, verifiedPhone] = await Promise.all([
    getProfileAvatarPresentation({
      avatarPath: auth.profile?.avatar_path ?? null,
      nickname,
    }),
    auth.isConfigured
      ? getAccountDeletionPresentation()
      : UNAVAILABLE_ACCOUNT_DELETION_PRESENTATION,
    auth.isConfigured && auth.user ? readMyMarketingConsentState() : Promise.resolve(null),
    phoneConfig ? createClient().then(readMyVerifiedPhone) : Promise.resolve(null),
  ]);

  /* 카카오톡 수신 동의 줄은 카카오톡 채널 스위치가 켜졌거나 이미 동의한 회원에게만 그린다(1014-010). */
  const withKakao = marketingKakaoVisible(kakaoChannelConfig() !== null, marketingConsent);

  return (
    <Settings
      accountDeletion={accountDeletion}
      accountDeletionRequestKey={crypto.randomUUID()}
      avatarInitial={avatar.avatarInitial}
      avatarUrl={avatar.avatarUrl}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      marketingConsent={marketingConsent}
      marketingConsentUnavailable={auth.isConfigured && Boolean(auth.user) && marketingConsent === null}
      marketingChannels={withKakao ? MARKETING_CHANNELS_WITH_KAKAO : MARKETING_CHANNELS}
      isConfigured={auth.isConfigured}
      nickname={nickname}
      phoneVerification={phoneConfig ? phoneVerificationView(phoneConfig, verifiedPhone) : undefined}
    />
  );
}

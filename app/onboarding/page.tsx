import { redirect } from 'next/navigation';
import { Onboarding } from '@/components/screens/Onboarding';
import { isOnboarded, safeNextPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getFollowedIpIdsForUser } from '@/lib/ip-follow.server';
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
  const [catalog, followedIpIds, marketingConsent, verifiedPhone] = await Promise.all([
    getCatalogSnapshot(),
    auth.user ? getFollowedIpIdsForUser(auth.user.id) : Promise.resolve(new Set<string>()),
    auth.user ? readMyMarketingConsentState() : Promise.resolve(null),
    phoneConfig ? createClient().then(readMyVerifiedPhone) : Promise.resolve(null),
  ]);
  /* 카카오톡 수신 동의 줄은 카카오톡 채널 스위치가 켜졌거나 이미 동의한 회원에게만 그린다(1014-010). */
  const withKakao = marketingKakaoVisible(kakaoChannelConfig() !== null, marketingConsent);
  const recommendedIps = catalog.ips.slice(0, 5).map((ip) => ({
    bg: ip.bg,
    color: ip.v.color,
    fans: ip.fans,
    id: ip.id,
    sub: ip.sub,
    tagline: ip.tagline,
    title: ip.title,
  }));

  return (
    <Onboarding
      birthDate={auth.profile?.birth_date ?? ''}
      email={auth.profile?.email ?? auth.user?.email ?? ''}
      followedIpIds={[...followedIpIds]}
      genderEligible={!auth.profile || auth.profile.role === 'user'}
      initialMarketing={marketingChannelChoices(marketingConsent, { withKakao })}
      isConfigured={auth.isConfigured}
      marketingChannels={withKakao ? MARKETING_CHANNELS_WITH_KAKAO : MARKETING_CHANNELS}
      next={next}
      phoneVerification={phoneConfig ? phoneVerificationView(phoneConfig, verifiedPhone) : undefined}
      recommendedIps={recommendedIps}
    />
  );
}

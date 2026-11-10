import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { AdultVerification } from '@/components/screens/AdultVerification';
import { ADULT_AGE_YEARS } from '@/lib/age/adult-age';
import { kstCalendarDate } from '@/lib/age/minimum-age';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { adultVerificationReturnPath } from '@/lib/identity/adult-verification.server';
import { ADULT_VERIFICATION_PATH, adultVerificationHref } from '@/lib/identity/adult-verification-routes';
import { loadMyAdultVerification } from '@/lib/identity/adult-verification-status.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';

export const metadata: Metadata = {
  title: '성인 인증 — ICONS',
  description: '19금 굿즈를 보고 구매하기 위한 휴대폰 본인확인 성인 인증 상태를 확인합니다.',
  robots: { index: false, follow: false },
};

/* 성인 인증은 계정에 붙는 증거라 로그인·온보딩을 마친 회원만 연다. 돌아갈 경로(next)는
   서버가 같은 사이트 화면 경로로 좁힌 값만 화면에 넘긴다. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const requestedNext = typeof params.next === 'string' ? params.next : null;
  const next = adultVerificationReturnPath(requestedNext ?? ADULT_VERIFICATION_PATH);
  const selfHref = adultVerificationHref(requestedNext ? next : null);

  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(selfHref)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(selfHref));

  const status = await loadMyAdultVerification();

  return (
    <AdultVerification
      eligibleBirthYear={kstCalendarDate(new Date()).year - ADULT_AGE_YEARS}
      enabled={adultVerificationEnabledFor(auth.user.id)}
      next={next}
      status={status}
    />
  );
}

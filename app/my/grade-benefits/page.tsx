import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyGradeBenefits } from '@/components/screens/MyGradeBenefits';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadLoyaltyBenefitsPage } from '@/lib/loyalty-benefits.server';
import { hrefFor } from '@/lib/routes';

export const metadata: Metadata = {
  title: '회원 등급 혜택 — ICONS',
  description: '회원 등급별 기준과 등급 혜택 쿠폰·적립 혜택을 확인하세요.',
  robots: { index: false, follow: false },
};

/* 회원 등급 혜택(L6 · MY-05)은 내 등급과 함께 읽는 개인 화면이다 — 진입에 로그인이 필요하다.
   등급별 혜택 RPC 도 로그인 회원에게만 열려 있다(get_loyalty_grade_benefits, authenticated 전용). */
export default async function Page() {
  const path = hrefFor('gradeBenefits');
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(path));

  const { benefits, standing } = await loadLoyaltyBenefitsPage();
  return <MyGradeBenefits benefits={benefits} standing={standing} />;
}

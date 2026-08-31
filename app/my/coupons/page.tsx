import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyCoupons } from '@/components/screens/MyCoupons';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadMyCoupons } from '@/lib/coupons.server';

export const metadata: Metadata = {
  title: '쿠폰함 — ICONS',
  description: '보유한 쿠폰과 사용·만료 내역을 확인합니다.',
  robots: { index: false, follow: false },
};

/* 쿠폰은 개인 보유물이라 공개 브라우징 대상이 아니다 — 진입에 로그인이 필요하다.
   로그인 없이 열면 빈 화면이 "쿠폰이 없다"는 거짓말이 된다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/coupons')}`);

  const coupons = await loadMyCoupons();

  return <MyCoupons coupons={coupons} />;
}

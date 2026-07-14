import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Orders } from '@/components/screens/Orders';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadOrders } from '@/lib/orders.server';

export const metadata: Metadata = {
  title: '주문 내역 — ICONS',
  description: 'ICONS 굿즈 주문과 배송 상태를 확인하세요.',
};

export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/orders')}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/orders'));

  const orders = await loadOrders(auth.user.id);
  return <Orders orders={orders} />;
}

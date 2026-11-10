import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GiftNew } from '@/components/screens/gifts/GiftNew';
import { getCurrentAuthState } from '@/lib/auth/server';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { giftsAvailable } from '@/lib/gifts.server';
import { getCatalogSnapshot } from '@/lib/catalog';
export const metadata: Metadata = { title: '선물 준비 — ICONS' };
export default async function Page() {
  const auth = await getCurrentAuthState(); if (!auth.user) redirect('/login?next=%2Fgifts%2Fnew');
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath('/gifts/new'));
  const [available, catalog] = await Promise.all([giftsAvailable(), getCatalogSnapshot()]);
  return <GiftNew actorId={auth.user.id} goods={catalog.goods} available={available} />;
}

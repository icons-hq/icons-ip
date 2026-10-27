import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyAddresses } from '@/components/screens/MyAddresses';
import { loadMyAddressBook } from '@/lib/address-book.server';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { hrefFor } from '@/lib/routes';

export const metadata: Metadata = {
  title: '배송지 관리 — ICONS',
  description: '주문서에서 불러올 배송지를 등록하고 기본 배송지를 정하세요.',
  robots: { index: false, follow: false },
};

/* 주소록(L7 · MY-11)은 개인 정보라 공개 브라우징 대상이 아니다 — 진입에 로그인·온보딩이 필요하다.
   주소록은 본인 RLS 로만 읽힌다(address_book_entries_select_own). */
export default async function Page() {
  const path = hrefFor('addresses');
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) redirect(onboardingPath(path));

  const entries = await loadMyAddressBook(auth.user.id);
  return <MyAddresses entries={entries} />;
}

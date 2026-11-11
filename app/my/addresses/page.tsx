import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { MyAddresses, MyAddressesNotOpen } from '@/components/screens/MyAddresses';
import { addressBookOpenFor } from '@/lib/address-book';
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
  /* 처리방침 주소록 개정 시행일 전에는 여는 날만 안내한다(staff/admin 은 미리보기로 쓴다). 주소록을 읽지도 않는다. */
  if (!addressBookOpenFor(auth)) return <MyAddressesNotOpen />;

  const entries = await loadMyAddressBook(auth.user.id);
  return <MyAddresses entries={entries} />;
}

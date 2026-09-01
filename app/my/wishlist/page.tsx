import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wishlist } from '@/components/screens/Wishlist';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getWishlistEntries } from '@/lib/wishlist.server';

export const metadata: Metadata = {
  title: '위시리스트 — ICONS',
  description: '찜해 둔 굿즈를 한곳에 모아 봅니다.',
  robots: { index: false, follow: false },
};

/* 위시는 개인 기록이라 공개 브라우징 대상이 아니다 — 진입 자체에 로그인이 필요하다.
   목록 자체는 RLS 가 본인 행만 주지만, 로그인 없이 열면 빈 화면이 "찜한 게 없다"는
   거짓말이 된다.

   찜 항목과 카탈로그는 서로를 기다릴 이유가 없어 함께 읽는다. 조인은 화면이 한다 —
   판매 종료 행 처리를 페이지와 화면 두 곳에 두면 한쪽만 고쳐진다. */
export default async function Page() {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent('/my/wishlist')}`);

  const [entries, catalog] = await Promise.all([getWishlistEntries(), getCatalogSnapshot()]);

  return <Wishlist catalog={catalog} entries={entries} />;
}

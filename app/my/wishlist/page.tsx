import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Wishlist } from '@/components/screens/Wishlist';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadMyFollowedIpIds } from '@/lib/my-follows.server';
import { getWishlistEntries } from '@/lib/wishlist.server';
import { followedIpList, wishlistLines, wishlistTab, wishlistTabHref } from '@/lib/wishlist-lines';

export const metadata: Metadata = {
  title: '위시리스트 — ICONS',
  description: '찜해 둔 굿즈와 팔로우한 IP를 한곳에 모아 봅니다.',
  robots: { index: false, follow: false },
};

/* 위시는 개인 기록이라 공개 브라우징 대상이 아니다 — 진입 자체에 로그인이 필요하다.
   목록 자체는 RLS 가 본인 행만 주지만, 로그인 없이 열면 빈 화면이 "찜한 게 없다"는
   거짓말이 된다. 로그인 뒤에는 보던 탭(?tab=ip)으로 돌아온다.

   찜 항목·카탈로그·팔로우는 서로를 기다릴 이유가 없어 함께 읽는다. 조인은 lib/wishlist-lines 한 곳이
   한다 — 판매 종료 줄 처리를 둘로 나누지 않고, 카탈로그 전체를 클라이언트로 내려보내지도 않는다. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const tab = wishlistTab((await searchParams).tab);
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(wishlistTabHref(tab))}`);

  const [entries, catalog, followedIpIds] = await Promise.all([
    getWishlistEntries(),
    getCatalogSnapshot(),
    loadMyFollowedIpIds(auth.user.id),
  ]);

  return (
    <Wishlist
      followedIps={followedIpList(followedIpIds, catalog.ips)}
      lines={wishlistLines(entries, catalog)}
      tab={tab}
      viewerId={auth.user.id}
    />
  );
}

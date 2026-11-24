import 'server-only';

import { getCurrentAuthState } from '@/lib/auth/server';
import type { CampaignLandingSnapshot } from '@/lib/campaigns.server';
import { loadCoinOverview, type CoinOverview } from '@/lib/coins.server';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

/* 캠페인 랜딩을 그릴 때 라우트가 준비하는 값 한 벌 — `/events/[eventId]`와 `/popups/[id]`가 같은 랜딩을 쓰므로 한 곳에 둔다.
 *
 * 공개 브라우징이다. 로그인 여부는 참여 패널을 로그인 CTA 로 바꾸는 데만 쓰고, 비로그인도 본문은 그대로 읽는다. */

export interface CampaignLandingRouteProps {
  campaign: CampaignLandingSnapshot;
  coin: CoinOverview | null;
  signedIn: boolean;
  wishlist: ListingWishlist | null;
}

export async function loadCampaignLandingProps(campaign: CampaignLandingSnapshot): Promise<CampaignLandingRouteProps> {
  const hasGoods = campaign.resolvedSections.some((section) => section.type === 'goods' && section.goods.length > 0);
  const [auth, wishlist] = await Promise.all([
    getCurrentAuthState(),
    /* 굿즈 진열 카드의 목록 하트(LFS 패리티 2차 L4b · CL-01) — 진열이 있을 때만 회원의 위시 ID 를 한 번 읽는다.
       이 라우트는 이미 로그인 상태를 읽는 동적 렌더라 렌더 방식이 바뀌지 않는다. 던지지 않는다. */
    hasGoods ? loadListingWishlist() : Promise.resolve(null),
  ]);
  const signedIn = Boolean(auth.user);
  const coin = signedIn ? await loadCoinOverview() : null;

  return {
    campaign,
    coin,
    signedIn,
    wishlist,
  };
}

import 'server-only';

import { cache } from 'react';
import { getCurrentAuthState } from '@/lib/auth/server';
import type { CampaignLandingSnapshot } from '@/lib/campaigns.server';
import { readCardRewardsEnabled } from '@/lib/card-rewards/gate.server';
import { loadCoinOverview, type CoinOverview } from '@/lib/coins.server';
import type { ListingWishlist } from '@/lib/listing-wishlist';
import { loadListingWishlist } from '@/lib/wishlist-ids.server';

/* 캠페인 랜딩을 그릴 때 라우트가 준비하는 값 한 벌 — `/events/[eventId]`와 `/popups/[id]`가 같은 랜딩을 쓰므로 한 곳에 둔다.
 *
 * 공개 브라우징이다. 로그인 여부는 참여 패널을 로그인 CTA 로 바꾸는 데만 쓰고, 비로그인도 본문은 그대로 읽는다. */

/* /packs 와 같은 관례 — 게이트 값은 요청당 한 번만 읽는다. */
const getCardRewardsEnabled = cache(readCardRewardsEnabled);

/* 교환 폼의 멱등 키는 블록마다 따로다.
 *
 * 한 페이지에 교환 블록이 여러 개일 수 있고, 키를 공유하면 첫 교환이 성립한 뒤
 * 다른 상품을 제출했을 때 RPC 가 같은 키를 보고 already_exchanged 로 답한다 —
 * 두 번째 교환은 일어나지 않았는데 화면은 성공으로 그린다. 섹션 인덱스로 키를
 * 나눠 두면 각 블록이 자기 재제출만 막는다. */
function exchangeOperationIdsFor(sections: readonly { type: string }[]): Record<number, string> {
  const ids: Record<number, string> = {};
  sections.forEach((section, index) => {
    if (section.type === 'exchange') ids[index] = crypto.randomUUID();
  });
  return ids;
}

export interface CampaignLandingRouteProps {
  campaign: CampaignLandingSnapshot;
  cardRewardsEnabled: boolean;
  coin: CoinOverview | null;
  exchangeOperationIds: Record<number, string>;
  signedIn: boolean;
  wishlist: ListingWishlist | null;
}

export async function loadCampaignLandingProps(campaign: CampaignLandingSnapshot): Promise<CampaignLandingRouteProps> {
  const hasGoods = campaign.resolvedSections.some((section) => section.type === 'goods' && section.goods.length > 0);
  const [auth, cardRewardsEnabled, wishlist] = await Promise.all([
    getCurrentAuthState(),
    /* 전역 카드 리워드 게이트. /packs·게임·마이 메뉴가 게이트 OFF 에서 표면을
       감추는 것과 같은 규율이다 — 교환 CTA 만 남으면 누를 수 있는데 서버가
       거절하는 버튼이 된다. RPC 의 card_rewards_disabled 는 백스톱으로 남는다. */
    getCardRewardsEnabled(),
    /* 굿즈 진열 카드의 목록 하트(LFS 패리티 2차 L4b · CL-01) — 진열이 있을 때만 회원의 위시 ID 를 한 번 읽는다.
       이 라우트는 이미 로그인 상태를 읽는 동적 렌더라 렌더 방식이 바뀌지 않는다. 던지지 않는다. */
    hasGoods ? loadListingWishlist() : Promise.resolve(null),
  ]);
  const signedIn = Boolean(auth.user);
  const coin = signedIn ? await loadCoinOverview() : null;

  return {
    campaign,
    cardRewardsEnabled,
    coin,
    exchangeOperationIds: exchangeOperationIdsFor(campaign.resolvedSections),
    signedIn,
    wishlist,
  };
}

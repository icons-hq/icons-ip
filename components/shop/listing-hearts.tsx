import type { ReactNode } from 'react';
import { listingWishSet, type ListingWishlist } from '@/lib/listing-wishlist';
import { ListingWishHeart } from './ListingWishHeart';

export type ListingHeartFor = (good: { id: string; name: string }) => ReactNode | undefined;

const NO_HEART: ListingHeartFor = () => undefined;

/*
 * 상품 카드 action 슬롯에 꽂을 목록 하트 (LFS 패리티 2차 L4b · CL-01, 12 LD-4).
 *
 * PDP 선반·캠페인 랜딩·쇼핑스토리 카드가 L4 의 공용 하트(`ListingWishHeart`)를 그대로 쓴다. 화면이 받은 위시 ID
 * 집합을 한 번만 집합으로 바꿔 두고, 카드마다 그 굿즈의 초기 상태로 하트를 만든다(N+1 없음). 하트는 카드 링크 밖의
 * 형제 슬롯에 놓인다 — 링크 안에 버튼을 넣지 않는 L4 배치 규칙을 ProductCard 가 지킨다.
 *
 * 위시 상태를 받지 않은 자리(어드민 미리보기·mock 실행)는 하트를 그리지 않는다 — 저장할 곳이 없거나 저장하면 안 된다.
 */
export function listingHeartsFor(wishlist: ListingWishlist | null | undefined): ListingHeartFor {
  if (!wishlist) return NO_HEART;
  const wished = listingWishSet(wishlist);
  return function listingHeart(good) {
    return <ListingWishHeart goodId={good.id} initialWished={wished.has(good.id)} label={good.name} viewerId={wishlist.viewerId} />;
  };
}

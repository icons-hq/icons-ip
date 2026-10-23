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

/*
 * 화면이 스스로 로그인 계정을 따라가며 내용을 바꾸는 자리(관심 굿즈 선반)에 넘길 위시 상태.
 *
 * 하트의 초기 상태와 확정 저장소의 회원은 서버 렌더 때 판정한 회원(`wishlist.viewerId`)이다. 선반이 다른 탭의 로그아웃·로그인을
 * 관측해 새 계정의 목록으로 바뀌었는데 하트만 이전 회원 것으로 남으면 한 선반 안에서 두 계정이 섞인다 — 이전 회원의 찜 여부가
 * 새 회원 화면에 드러나고, 누르면 액션은 새 세션으로 실행되는데 확인값은 이전 회원 열쇠로 적힌다. 그래서 지금 그리는 목록의
 * 주인이 서버가 판정한 회원(게스트는 null 끼리)과 같을 때만 그 위시 상태를 돌려주고, 다르거나 주인이 아직 정해지지 않았으면
 * null 을 돌려줘 하트를 그리지 않는다. 새 회원의 위시 상태는 새로 받는 화면(새로고침·이동)이 다시 내려 준다.
 */
export function wishlistForOwner(
  wishlist: ListingWishlist | null | undefined,
  ownerId: string | null | undefined,
): ListingWishlist | null {
  if (!wishlist || ownerId === undefined) return null;
  return wishlist.viewerId === ownerId ? wishlist : null;
}

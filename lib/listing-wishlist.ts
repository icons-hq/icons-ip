/* 목록 화면이 한 번 내려받는 위시 상태 (LFS 패리티 2차 L4 · CL-01, 12 LD-4).
 *
 * 굿즈샵·검색·온라인 팝업·홈의 모든 상품 카드와 리스트 행에 하트가 선다. 카드마다 서버에
 * 묻지 않도록 목록 페이지가 로그인 회원의 위시 굿즈 ID 집합을 한 번 읽어 내려 주고(N+1 금지),
 * 카드는 이 집합으로 초기 상태만 정한다. 서버 전용 로더는 `lib/wishlist-ids.server.ts`다.
 *
 * 값이 null 이면 위시를 저장할 곳이 없는 실행(= Supabase 미설정 mock 모드)이라 하트를 그리지 않는다.
 * 어드민 미리보기처럼 실제로 저장하면 안 되는 자리도 null 을 넘겨 하트를 감춘다. */

export interface ListingWishlist {
  /** 서버가 판정한 로그인 회원 ID. null 이면 게스트라 하트를 누르는 순간 로그인 벽으로 보낸다.
      하트의 세션 확정 저장소가 이 값으로 회원을 가른다(`components/shop/wishlist-heart-store.ts`) —
      같은 탭에서 로그아웃·다른 회원 로그인이 이어져도 이전 회원의 하트가 남지 않는다.
      응답은 그 회원 자신의 동적 렌더에만 실린다(쿠키를 읽는 화면이라 공유 캐시에 남지 않는다). */
  viewerId: string | null;
  /** 회원이 위시리스트에 담은 굿즈 ID. 게스트는 빈 배열이다. */
  goodIds: string[];
}

const EMPTY: ReadonlySet<string> = new Set();

/** 카드마다 배열을 훑지 않도록 화면이 한 번만 집합으로 바꿔 쓴다. */
export function listingWishSet(wishlist: ListingWishlist | null | undefined): ReadonlySet<string> {
  return wishlist?.viewerId && wishlist.goodIds.length ? new Set(wishlist.goodIds) : EMPTY;
}

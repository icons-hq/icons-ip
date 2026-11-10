import { ProductInterestShelf } from '@/components/shop/ProductInterestShelf';
import type { ListingWishlist } from '@/lib/listing-wishlist';
/* 관심 굿즈 카드의 목록 하트 초기 상태(L4b · CL-01)는 라우트가 한 번 읽어 내려 준다. */
export function ProductInterests({ wishlist }: { wishlist?: ListingWishlist | null } = {}) {
  return <main className="wc-root"><div className="wc-container wc-product-interests-page"><h1>관심 굿즈</h1><ProductInterestShelf standalone wishlist={wishlist} /></div></main>;
}

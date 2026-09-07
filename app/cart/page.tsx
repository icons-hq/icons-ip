import { Cart } from '@/components/screens/Cart';
import { loadCartGoodIds } from '@/lib/cart.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { getStorefrontGoodsByIds, getStorefrontIpsByIds } from '@/lib/storefront.server';

/* 담긴 상품만 읽는다(규모 후속). 전량을 읽으면 1,000번째 뒤의 상품을 담은 사람에게는
   그 줄이 「판매 종료」로 보이고 결제가 막힌다 — 재고도 가격도 멀쩡한데.

   서버가 미리 담아 줄 수 있는 것은 로그인 사용자의 저장된 장바구니까지다. 비회원 장바구니는
   브라우저에만 있어 화면이 열린 뒤 모자란 id 를 채운다. */
export default async function Page() {
  const [goodIds, couponState] = await Promise.all([loadCartGoodIds(), loadCartCouponState()]);
  const goods = await getStorefrontGoodsByIds(goodIds);
  const ips = await getStorefrontIpsByIds(goods.map((good) => good.ip));

  return <Cart catalog={{ goods, ips, answeredIds: goodIds }} couponState={couponState} />;
}

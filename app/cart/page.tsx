import { Cart } from '@/components/screens/Cart';
import { getCatalogSnapshot } from '@/lib/catalog';
import { loadCartCouponState } from '@/lib/coupons.server';

export default async function Page() {
  const [catalog, couponState] = await Promise.all([
    getCatalogSnapshot(),
    loadCartCouponState(),
  ]);

  return <Cart catalog={{ goods: catalog.goods, ips: catalog.ips }} couponState={couponState} />;
}

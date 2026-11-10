import { Cart } from '@/components/screens/Cart';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import { giftsAvailable } from '@/lib/gifts.server';

export default async function Page() {
  const [catalog, couponState, transactionMode, giftAvailable] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods })),
    loadCartCouponState(),
    loadGoodsTransactionRuntimeMode(),
    giftsAvailable(),
  ]);

  return <Cart catalog={{ goods: catalog.goods, ips: catalog.ips }} couponState={couponState} transactionMode={transactionMode} giftAvailable={giftAvailable} />;
}

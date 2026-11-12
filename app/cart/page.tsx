import { Cart } from '@/components/screens/Cart';
import { getCatalogSnapshot } from '@/lib/catalog';
import { getAdultGoodsAccess } from '@/lib/adult-goods-access.server';
import { loadCartCouponState } from '@/lib/coupons.server';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';
import { giftsAvailable } from '@/lib/gifts.server';

export default async function Page({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  /* 결제 없이 끝난 장바구니 주문의 '다시 결제하기'가 그 주문의 줄을 장바구니에서 찾지 못했다(QA1 S-D2-15). */
  const retryEmpty = (await searchParams)?.retry === 'empty';
  const [catalog, couponState, transactionMode, giftAvailable] = await Promise.all([
    getAdultGoodsAccess().then(adultGoods => getCatalogSnapshot({ adultGoods })),
    loadCartCouponState(),
    loadGoodsTransactionRuntimeMode(),
    giftsAvailable(),
  ]);

  return <Cart catalog={{ goods: catalog.goods, ips: catalog.ips }} couponState={couponState} transactionMode={transactionMode} giftAvailable={giftAvailable} retryEmpty={retryEmpty} />;
}

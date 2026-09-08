import { CouponScreen } from '@/components/admin/screens/CouponScreen';
import { couponSearchArgs, normalizeCouponSearch } from '@/lib/admin/coupon-search';
import { searchAdminCoupons } from '@/lib/admin/coupons.server';
import { getAdminGoodOptions } from '@/lib/admin/catalog-list.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesCouponsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/sales/coupons');

  /*
   * 목록을 조회로 바꿨다 (현업 슬라이스 4).
   *
   * 전에는 쿠폰 전량을 한 번에 읽었다 — PostgREST 는 1000행에서 **말없이** 잘라내므로,
   * 쿠폰이 그만큼 쌓이면 목록에 없는 쿠폰이 생기고 같은 프로모션이 두 번 발행된다.
   */
  const search = normalizeCouponSearch(await searchParams);
  const [page, goodOptions] = await Promise.all([
    searchAdminCoupons(couponSearchArgs(search)),
    getAdminGoodOptions(),
  ]);

  return (
    <CouponScreen
      goodOptions={goodOptions}
      records={page.records}
      search={search}
      total={page.total}
    />
  );
}

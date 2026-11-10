import { CouponCombinationPanel } from '@/components/admin/CouponCombinationPanel';
import { CouponScreen } from '@/components/admin/screens/CouponScreen';
import { getAdminCouponListData } from '@/lib/admin/coupons.server';
import { adminCouponListHref, normalizeAdminCouponFilters } from '@/lib/admin/coupons';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesCouponsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess('/admin/sales/coupons');
  const params = await searchParams;
  const filters = normalizeAdminCouponFilters(params);
  const data = await getAdminCouponListData(filters);

  return <><CouponCombinationPanel accountId={auth.user.id} /><CouponScreen data={data} key={adminCouponListHref(data.filters)} /></>;
}

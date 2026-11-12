import { CouponCombinationPanel } from '@/components/admin/CouponCombinationPanel';
import { CouponScreen } from '@/components/admin/screens/CouponScreen';
import { getAdminCouponListData } from '@/lib/admin/coupons.server';
import { ADMIN_COUPON_SAVED_PARAM, adminCouponListHref, normalizeAdminCouponFilters } from '@/lib/admin/coupons';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesCouponsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess('/admin/sales/coupons');
  const params = await searchParams;
  const filters = normalizeAdminCouponFilters(params);
  const data = await getAdminCouponListData(filters);

  /* 등록 화면에서 처음 저장하고 옮겨 왔으면(saved=1) 수정 화면 맨 위에 저장 결과를 보인다. 표시는 화면이 주소에서 지운다. */
  return <><CouponCombinationPanel accountId={auth.user.id} /><CouponScreen data={data} justSaved={params[ADMIN_COUPON_SAVED_PARAM] === '1'} key={adminCouponListHref(data.filters)} /></>;
}

import { CouponScreen } from '@/components/admin/screens/CouponScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminCouponFilters } from '@/lib/admin/coupons';
import { getAdminCouponListData } from '@/lib/admin/coupons.server';
import { CONFIGURABLE_GRADES, type ConfigurableGrade } from '@/lib/loyalty-policy';
export default async function NewCouponPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess('/admin/sales/coupons/new');
  const query = await searchParams;
  const filters = normalizeAdminCouponFilters({ ...query, couponCode: query.copy });
  const initialGrade = typeof query.grade === 'string' && CONFIGURABLE_GRADES.includes(query.grade as ConfigurableGrade)
    ? query.grade as ConfigurableGrade : undefined;
  return <CouponScreen mode="create" initialGrade={initialGrade} data={await getAdminCouponListData(filters)} />;
}

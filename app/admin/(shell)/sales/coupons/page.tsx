import { CouponScreen } from '@/components/admin/screens/CouponScreen';
import { getAdminCouponRecords } from '@/lib/admin/coupons.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

export default async function AdminSalesCouponsPage() {
  await requireAdminScreenAccess('/admin/sales/coupons');

  const records = await getAdminCouponRecords();

  return <CouponScreen records={records} />;
}

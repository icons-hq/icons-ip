import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_AFTER_SALES_TEMPLATES_PATH } from '@/lib/goods-after-sales';
import { GoodsAfterSalesTemplatesScreen } from '@/components/admin/screens/GoodsAfterSalesTemplatesScreen';

export default async function Page() {
  await requireAdminScreenAccess(GOODS_AFTER_SALES_TEMPLATES_PATH);
  return <GoodsAfterSalesTemplatesScreen />;
}

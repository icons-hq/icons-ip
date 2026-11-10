import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_EVENT_TEMPLATES_PATH } from '@/lib/goods-benefits';
import { GoodsEventTemplatesScreen } from '@/components/admin/screens/GoodsEventTemplatesScreen';

export default async function Page() {
  await requireAdminScreenAccess(GOODS_EVENT_TEMPLATES_PATH);
  return <GoodsEventTemplatesScreen />;
}

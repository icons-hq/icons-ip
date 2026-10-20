import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { GOODS_SIZE_TEMPLATES_PATH } from '@/lib/goods-size-chart';
import { GoodsSizeTemplatesScreen } from '@/components/admin/screens/GoodsSizeTemplatesScreen';

export default async function Page() {
  const auth = await requireAdminScreenAccess(GOODS_SIZE_TEMPLATES_PATH, { capability: 'catalog.manage' });
  return <GoodsSizeTemplatesScreen accountId={auth.user.id} />;
}

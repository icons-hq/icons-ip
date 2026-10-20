import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminCategoryWorkspace } from '@/lib/admin/category.server';
import { GOODS_ATTRIBUTES_PATH } from '@/lib/admin/goods-attributes';
import { GoodsAttributeSchemaScreen } from '@/components/admin/screens/GoodsAttributeSchemaScreen';
export default async function Page() {
  await requireAdminScreenAccess(GOODS_ATTRIBUTES_PATH, { adminOnly: true });
  const data = await loadAdminCategoryWorkspace();
  return <GoodsAttributeSchemaScreen categories={data.categories} />;
}

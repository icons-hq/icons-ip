import { CategoryScreen } from '@/components/admin/screens/CategoryScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminCategoryWorkspace } from '@/lib/admin/category.server';
import { CATEGORY_PATH } from '@/lib/admin/category';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';

export default async function Page() {
  await requireAdminScreenAccess(CATEGORY_PATH);
  const data = await loadAdminCategoryWorkspace();
  return <CategoryScreen data={data} legacyTypes={[...GOOD_TYPES]} />;
}

import { hasAdminCapability } from '@/lib/admin/access';
import { CategoryScreen } from '@/components/admin/screens/CategoryScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminCategoryWorkspace } from '@/lib/admin/category.server';
import { CATEGORY_PATH } from '@/lib/admin/category';
import { GOOD_TYPES } from '@/lib/goods-taxonomy';

export default async function Page() {
  const auth = await requireAdminScreenAccess(CATEGORY_PATH);
  const canManagePlatform = hasAdminCapability(auth, 'platform.manage');
  const data = await loadAdminCategoryWorkspace(canManagePlatform);
  return <CategoryScreen data={data} legacyTypes={canManagePlatform ? [...GOOD_TYPES] : []} canManagePlatform={canManagePlatform} />;
}

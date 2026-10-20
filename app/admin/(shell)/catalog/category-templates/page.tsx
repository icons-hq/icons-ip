import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CATEGORY_TEMPLATES_PATH } from '@/lib/admin/category-templates';
import { loadCategoryTemplateTree } from '@/lib/admin/category-templates.server';
import { CategoryTemplatesScreen } from '@/components/admin/screens/CategoryTemplatesScreen';

export default async function Page() {
  await requireAdminScreenAccess(CATEGORY_TEMPLATES_PATH);
  return <CategoryTemplatesScreen categories={await loadCategoryTemplateTree()} />;
}

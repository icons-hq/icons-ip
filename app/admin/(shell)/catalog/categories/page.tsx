import { CategoryConsole } from '@/components/admin/catalog/CategoryConsole';
import {
  ADMIN_CATEGORY_NEW_RECORD,
  normalizeAdminCategoryFilters,
} from '@/lib/admin/categories';
import { getAdminCategories, getAdminCategoryGoods } from '@/lib/admin/categories.server';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';

/* 분류 관리 — 목록(트리)과 편집(`?selected=`)은 같은 라우트의 두 얼굴이다(카탈로그 콘솔 문법). */
export default async function AdminCatalogCategoriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/catalog/categories');
  const filters = normalizeAdminCategoryFilters(await searchParams);
  const creating = filters.selected === ADMIN_CATEGORY_NEW_RECORD;

  const categories = await getAdminCategories({ includeArchived: filters.archived });
  const record = !creating && filters.selected
    ? categories.find((category) => category.id === filters.selected) ?? null
    : null;
  const categoryGoods = record ? await getAdminCategoryGoods(record.id) : [];

  return (
    <CategoryConsole
      categories={categories}
      categoryGoods={categoryGoods}
      filters={filters}
      selected={creating ? 'new' : record}
    />
  );
}

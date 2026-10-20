import { DetailPresentationScreen } from '@/components/admin/screens/DetailPresentationScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminDetailPresentation } from '@/lib/admin/product-detail-presentation.server';
import { loadAdminCurationTargets } from '@/lib/admin/curation-targets.server';
import { loadAdminCategoryWorkspace } from '@/lib/admin/category.server';
import { PRODUCT_DETAIL_PRESENTATION_PATH } from '@/lib/product-detail-presentation';
export default async function AdminDetailPresentationPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> } = {}) {
  await requireAdminScreenAccess(PRODUCT_DETAIL_PRESENTATION_PATH, { capability: 'store.manage' });
  const [snapshot, targets, category, params] = await Promise.all([loadAdminDetailPresentation(), loadAdminCurationTargets(), loadAdminCategoryWorkspace(false), searchParams]);
  return <DetailPresentationScreen snapshot={snapshot} section={params?.tab === 'modules' ? 'modules' : params?.tab === 'otherComposition' ? 'otherComposition' : 'banner'}
    goods={targets.goods.map(good => ({ ...good, archived: Boolean(good.archivedAt) }))}
    categories={category.categories.map(item => ({ id: item.id, title: `${'　'.repeat(item.depth - 1)}${item.name}`, archived: Boolean(item.archivedAt) }))} />;
}

import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isUuid } from '@/lib/uuid';
import { GOODS_RELATIONS_PATH, goodsRelationDraft, goodsRelationHref, normalizeGoodsRelationFilters, relationDefaultTitle } from '@/lib/admin/goods-relations';
import { loadGoodsRelation, loadGoodsRelations } from '@/lib/admin/goods-relations.server';
import { GoodsRelationsScreen } from '@/components/admin/screens/GoodsRelationsScreen';
import { GoodsRelationEditor } from '@/components/admin/screens/GoodsRelationEditor';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(GOODS_RELATIONS_PATH);
  const params = await searchParams; const filters = normalizeGoodsRelationFilters(params); const backHref = goodsRelationHref(filters);
  if (params.create === '1') redirect(`${backHref}&create=${randomUUID()}`);
  const id = typeof params.edit === 'string' ? params.edit : typeof params.create === 'string' ? params.create : null;
  if (id) {
    if (!isUuid(id)) notFound();
    const saved = await loadGoodsRelation(id);
    if (params.edit && !saved) notFound();
    // Keep the successful action feedback while revalidation refreshes props.
    // An explicit latest-version link changes reload and remounts the form.
    const reloadKey = typeof params.reload === 'string' ? params.reload.slice(0, 20) : '';
    return <GoodsRelationEditor key={`${id}:${reloadKey}`} initial={saved ? goodsRelationDraft(saved) : {
      id, revision: 0, kind: 'together', title: relationDefaultTitle('together'), representativeGoodId: '', enabled: false, startsAt: '', endsAt: '', goods: [],
    }} backHref={backHref} />;
  }
  return <GoodsRelationsScreen data={await loadGoodsRelations(filters)} />;
}

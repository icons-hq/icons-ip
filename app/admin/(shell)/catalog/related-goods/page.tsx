import { randomUUID } from 'node:crypto';
import { notFound, redirect } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isUuid } from '@/lib/uuid';
import { GOODS_RELATIONS_PATH, goodsRelationDraft, goodsRelationHref, normalizeGoodsRelationFilters, relationDefaultTitle } from '@/lib/admin/goods-relations';
import { loadGoodsRelation, loadGoodsRelations } from '@/lib/admin/goods-relations.server';
import { GoodsRelationsScreen } from '@/components/admin/screens/GoodsRelationsScreen';
import { GoodsRelationEditor } from '@/components/admin/screens/GoodsRelationEditor';
import { getAdultGoodsVisibility } from '@/lib/adult-goods-access.server';
import { adultVerificationEnabledFor } from '@/lib/identity/kcp-cert-config';

/**
 * 판매 제한(19금) 상품이 지금 모든 고객에게 숨겨져 있는가. 성인 인증을 아직 전체 고객에게 열지 않았거나
 * 기능 공개 관리에서 '모든 고객에게 숨김'을 골랐을 때다. 보는 운영자 본인의 성인 인증과는 상관없다.
 * 설정을 읽지 못하면 숨기지 않은 것으로 본다(화면은 '성인 인증 고객에게만'으로 적는다).
 */
async function adultGoodsHiddenFromEveryone() {
  return !adultVerificationEnabledFor(null) || (await getAdultGoodsVisibility())?.enabled === false;
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(GOODS_RELATIONS_PATH);
  const params = await searchParams; const filters = normalizeGoodsRelationFilters(params); const backHref = goodsRelationHref(filters);
  if (params.create === '1') redirect(`${backHref}&create=${randomUUID()}`);
  const id = typeof params.edit === 'string' ? params.edit : typeof params.create === 'string' ? params.create : null;
  if (id) {
    if (!isUuid(id)) notFound();
    const [saved, adultGoodsHidden] = await Promise.all([loadGoodsRelation(id), adultGoodsHiddenFromEveryone()]);
    if (params.edit && !saved) notFound();
    // Keep the successful action feedback while revalidation refreshes props.
    // An explicit latest-version link changes reload and remounts the form.
    const reloadKey = typeof params.reload === 'string' ? params.reload.slice(0, 20) : '';
    return <GoodsRelationEditor key={`${id}:${reloadKey}`} initial={saved ? goodsRelationDraft(saved) : {
      id, revision: 0, kind: 'together', title: relationDefaultTitle('together'), representativeGoodId: '', enabled: false, startsAt: '', endsAt: '', goods: [],
    }} backHref={backHref} adultGoodsHidden={adultGoodsHidden} />;
  }
  const [data, adultGoodsHidden] = await Promise.all([loadGoodsRelations(filters), adultGoodsHiddenFromEveryone()]);
  return <GoodsRelationsScreen data={data} adultGoodsHidden={adultGoodsHidden} />;
}

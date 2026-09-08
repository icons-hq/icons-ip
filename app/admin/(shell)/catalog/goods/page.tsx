import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import { GoodsListScreen } from '@/components/admin/screens/GoodsListScreen';
import { AdminPageHeader } from '@/components/admin/console/AdminKit';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminGoodsList, loadAdminGoodEditor } from '@/lib/admin/goods-list.server';
import { GOODS_LIST_PATH, goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';

export default async function AdminCatalogGoodsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(GOODS_LIST_PATH);
  const params = await searchParams;
  const filters = normalizeGoodsListFilters(params);
  const creating = params.create === '1';
  const goodId = typeof params.goodId === 'string' ? params.goodId : '';
  if (!creating && !goodId) return <GoodsListScreen data={await loadAdminGoodsList(filters)} />;
  if (!creating && !/^[a-z0-9][a-z0-9-]*$/.test(goodId)) notFound();

  const editor = creating ? await loadAdminGoodEditor() : await loadAdminGoodEditor(goodId);
  const selected = creating ? null : editor.records.goods.find((good) => good.id === goodId);
  if (!creating && !selected) notFound();
  const initialIpId = creating && editor.records.ips.some((ip) => ip.id === filters.ipId && !ip.archivedAt)
    ? filters.ipId : undefined;
  const listHref = goodsListHref(filters);
  const business = creating ? await getBusinessInfo() : null;
  return <section className="wc-admin-kit">
    <Link href={listHref}>← {ADMIN_VOCABULARY.goods} 목록으로</Link>
    <AdminPageHeader title={selected?.name ?? `${ADMIN_VOCABULARY.goods} 등록`} description={selected?.id} />
    <GoodScreen key={selected?.id ?? `create-${initialIpId ?? 'any'}`}
      accountId={auth.user.id} origins={editor.origins} noticeDefaults={business ? { asManager: business.companyName, asContact: business.phone || business.email } : undefined}
      adjustmentId={randomUUID()} catalogIps={editor.catalogIps} ips={editor.records.ips}
      records={selected ? [selected] : []} variants={editor.variants}
      initialIpId={initialIpId} initialSelectedId={selected?.id} hideRecordList listHref={listHref} />
  </section>;
}

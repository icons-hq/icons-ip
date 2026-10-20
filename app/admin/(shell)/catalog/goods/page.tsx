import { GoodsGroupCommonEditor } from '@/components/admin/GoodsGroupCommonEditor';
import { loadGoodsGroupCommon } from '@/lib/admin/goods-group-common.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { isUuid } from '@/lib/uuid';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { loadGoodShippingRegionSummaries } from '@/lib/admin/good-shipping-summary.server';
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
import { loadAdminShippingRegionExpiry } from '@/lib/admin/shipping-regions.server';

export default async function AdminCatalogGoodsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await requireAdminScreenAccess(GOODS_LIST_PATH);
  const params = await searchParams;
  const filters = normalizeGoodsListFilters(params);
  const creating = params.create === '1';
  const groupCommon = params.groupCommon;
  if (groupCommon !== undefined && (typeof groupCommon !== 'string' || !isUuid(groupCommon) || creating)) notFound();
  const goodId = typeof params.goodId === 'string' ? params.goodId : '';
  if (groupCommon && !goodId) notFound();
  if (!creating && !goodId) {
    const client = await createClient();
    const [data, shippingRegionExpiry, currentSession] = await Promise.all([loadAdminGoodsList(filters), loadAdminShippingRegionExpiry(), client.auth.getSession()]);
    const sessionId = currentSession.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(currentSession.data.session.access_token) : null;
    return <GoodsListScreen data={data} shippingRegionExpiry={shippingRegionExpiry} canIssueMarketingLinks={hasAdminCapability(auth, 'catalog.manage')} bulkIdentity={sessionId ? { actorId: auth.user.id, sessionId } : undefined} />;
  }
  if (!creating && !/^[a-z0-9][a-z0-9-]*$/.test(goodId)) notFound();

  if (groupCommon && !hasAdminCapability(auth, 'catalog.manage')) notFound();
  const editor = creating ? await loadAdminGoodEditor() : await loadAdminGoodEditor(goodId);
  if (groupCommon) {
    const client = await createClient();
    const [snapshot, session] = await Promise.all([loadGoodsGroupCommon(groupCommon), client.auth.getSession()]);
    if (!snapshot || snapshot.group.commonGoodId !== goodId) notFound();
    const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
    return <GoodsGroupCommonEditor key={`${groupCommon}:${auth.user.id}:${sessionId}`} snapshot={snapshot} actorId={auth.user.id} sessionId={sessionId} categories={editor.categories} ips={editor.records.ips} />;
  }
  const regionSummaries = await loadGoodShippingRegionSummaries(editor.origins);
  const selected = creating ? null : editor.records.goods.find((good) => good.id === goodId);
  if (!creating && !selected) notFound();
  const initialIpId = creating && editor.records.ips.some((ip) => ip.id === filters.ipId && !ip.archivedAt)
    ? filters.ipId : undefined;
  const listHref = goodsListHref(filters);
  const business = creating ? await getBusinessInfo() : null;
  return <section className="wc-admin-kit wc-admin-kit__screen">
    <Link href={listHref}>← {ADMIN_VOCABULARY.goods} 목록으로</Link>
    <AdminPageHeader title={selected?.name ?? `${ADMIN_VOCABULARY.goods} 등록`} description={selected?.id} />
    {selected && hasAdminCapability(auth, 'catalog.manage') ? <p><Link href={`/admin/catalog/goods/media?goodId=${encodeURIComponent(selected.id)}`}>동영상·숏클립 관리</Link></p> : null}
    <GoodScreen
      ownership={editor.ownership}
      accountId={auth.user.id} cloneOperationId={randomUUID()} canManageCosts={canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true })} canReadOrders={hasAdminCapability(auth, 'sales.read')} canManageSales={hasAdminCapability(auth, 'sales.manage')} canSearchErp={hasAdminCapability(auth, 'platform.manage')} categories={editor.categories} shippingNoticeOptions={editor.shippingNoticeOptions} origins={editor.origins} noticeDefaults={business ? { asManager: business.companyName, asContact: business.phone || business.email } : undefined}
      adjustmentId={randomUUID()} catalogIps={editor.catalogIps} ips={editor.records.ips}
      records={selected ? [selected] : []} variants={editor.variants} readiness={editor.readiness} regionSummaries={regionSummaries}
      initialIpId={initialIpId} initialSelectedId={selected?.id} hideRecordList listHref={listHref} />
  </section>;
}

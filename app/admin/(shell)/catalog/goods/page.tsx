import { GoodsGroupCommonEditor } from '@/components/admin/GoodsGroupCommonEditor';
import { CategoryTemplatesAvailableProvider } from '@/components/admin/CategoryTemplatesAvailability';
import { loadGoodsGroupCommon } from '@/lib/admin/goods-group-common.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { isUuid } from '@/lib/uuid';
import { canAccessAdminScreen, hasAdminCapability } from '@/lib/admin/access';
import { loadGoodShippingRegionSummaries } from '@/lib/admin/good-shipping-summary.server';
import { loadAdminPaymentTestGood } from '@/lib/admin-payment-test.server';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { GoodScreen } from '@/components/admin/screens/GoodScreen';
import { GoodsListScreen } from '@/components/admin/screens/GoodsListScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminGoodsList, loadAdminGoodEditor } from '@/lib/admin/goods-list.server';
import { GOODS_LIST_PATH, goodsListHref, normalizeGoodsListFilters } from '@/lib/admin/goods-list';
import { getBusinessInfo } from '@/lib/legal/business-info.server';
import { loadAdminShippingRegionExpiry } from '@/lib/admin/shipping-regions.server';
import { loadGoodsTransactionRuntimeMode } from '@/lib/checkout-transaction.server';

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
    const [data, shippingRegionExpiry, currentSession, testGood] = await Promise.all([
      loadAdminGoodsList(filters), loadAdminShippingRegionExpiry(), client.auth.getSession(),
      auth.role === 'admin' ? loadAdminPaymentTestGood() : null,
    ]);
    const sessionId = currentSession.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(currentSession.data.session.access_token) : null;
    return <GoodsListScreen canTestPayment={Boolean(testGood)} data={data} shippingRegionExpiry={shippingRegionExpiry} canIssueMarketingLinks={hasAdminCapability(auth, 'catalog.manage')} bulkIdentity={sessionId ? { actorId: auth.user.id, sessionId } : undefined} />;
  }
  if (!creating && !/^[a-z0-9][a-z0-9-]*$/.test(goodId)) notFound();

  if (groupCommon && !hasAdminCapability(auth, 'catalog.manage')) notFound();
  const editor = creating ? await loadAdminGoodEditor() : await loadAdminGoodEditor(goodId);
  if (groupCommon) {
    const client = await createClient();
    const [snapshot, session] = await Promise.all([loadGoodsGroupCommon(groupCommon), client.auth.getSession()]);
    if (!snapshot || snapshot.group.commonGoodId !== goodId) notFound();
    const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
    return <CategoryTemplatesAvailableProvider available={editor.hasCategoryTemplates}>
      <GoodsGroupCommonEditor key={`${groupCommon}:${auth.user.id}:${sessionId}`} snapshot={snapshot} actorId={auth.user.id} sessionId={sessionId} categories={editor.categories} ips={editor.records.ips} />
    </CategoryTemplatesAvailableProvider>;
  }
  /* 쇼핑몰의 주문 설정이 꺼져 있으면 DB가 택배 외 수령 방식·주문 후 제작 저장을 거절한다. 화면이 고르기 전에 막도록 미리 읽는다(화면 규칙 5).
     읽지 못했으면('unavailable') 막지 않는다 — 그때는 저장 오류 문구가 할 일을 말한다. */
  const [regionSummaries, transactionRuntime] = await Promise.all([loadGoodShippingRegionSummaries(editor.origins), loadGoodsTransactionRuntimeMode()]);
  const selected = creating ? null : editor.records.goods.find((good) => good.id === goodId);
  if (!creating && !selected) notFound();
  const initialIpId = creating && editor.records.ips.some((ip) => ip.id === filters.ipId && !ip.archivedAt)
    ? filters.ipId : undefined;
  const listHref = goodsListHref(filters);
  const business = creating ? await getBusinessInfo() : null;
  return <section className="flex min-w-0 flex-col gap-4" data-admin-screen="good-editor">
    <CategoryTemplatesAvailableProvider available={editor.hasCategoryTemplates}><GoodScreen
      ownership={editor.ownership}
      accountId={auth.user.id} cloneOperationId={randomUUID()} canManageCosts={canAccessAdminScreen(auth, null, { capability: 'platform.manage', adminOnly: true })} canReadOrders={hasAdminCapability(auth, 'sales.read')} canManageSales={hasAdminCapability(auth, 'sales.manage')} canSearchErp={hasAdminCapability(auth, 'catalog.manage')} canOpenIp={hasAdminCapability(auth, 'platform.manage')} canManageMedia={hasAdminCapability(auth, 'catalog.manage')} categories={editor.categories} shippingNoticeOptions={editor.shippingNoticeOptions} origins={editor.origins} returnAddresses={editor.returnAddresses} noticeDefaults={business ? { asManager: business.companyName, asContact: business.phone || business.email } : undefined}
      adjustmentId={randomUUID()} catalogIps={editor.catalogIps} ips={editor.records.ips}
      records={selected ? [selected] : []} variants={editor.variants} readiness={editor.readiness} regionSummaries={regionSummaries}
      initialIpId={initialIpId} initialSelectedId={selected?.id} hideRecordList listHref={listHref} transactionRuntimeOff={transactionRuntime === 'legacy'} /></CategoryTemplatesAvailableProvider>
  </section>;
}

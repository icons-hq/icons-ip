import { SettledScreen } from '@/components/admin/screens/SettledScreen';
import { OrderPreviewPopup } from '@/components/admin/screens/OrderPreviewPopup';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminOrderPreviewId } from '@/lib/admin/order-preview';
import { loadAdminOrderPreview } from '@/lib/admin/order-preview.server';
import { adminSettledHref, normalizeAdminSettledFilters } from '@/lib/admin/settled';
import { getAdminSettledOrders } from '@/lib/admin/settled.server';
import { isSettledExportId } from '@/lib/admin/settled-export';

export default async function AdminSalesSettledPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* 게이트가 로더보다 먼저다 — layout redirect는 page 로더를 막지 못한다. */
  const auth = await requireAdminScreenAccess('/admin/sales/settled');
  const query = await searchParams;
  const filters = normalizeAdminSettledFilters(query);
  /* S36-075: 주문번호를 누르면 `?orderId=`로 같은 목록 위에 주문 상세 팝업을 연다. */
  const previewId = adminOrderPreviewId(query.orderId);

  const [data, preview] = await Promise.all([getAdminSettledOrders(filters), previewId ? loadAdminOrderPreview(auth, previewId) : Promise.resolve(null)]);

  const receiptId = typeof query.exportReceipt === 'string' && isSettledExportId(query.exportReceipt) ? query.exportReceipt : undefined;
  return <>
    <SettledScreen data={data} exportRequestId={crypto.randomUUID()} exportReceiptId={receiptId} />
    {previewId && preview ? <OrderPreviewPopup key={previewId} actorId={auth.user.id} backLabel="거래확정 목록" closeHref={adminSettledHref(filters)} orderId={previewId} preview={preview} /> : null}
  </>;
}

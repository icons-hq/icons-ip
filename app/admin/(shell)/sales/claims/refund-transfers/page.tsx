import { redirect } from 'next/navigation';
import { RefundTransfersScreen } from '@/components/admin/screens/RefundTransfersScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadRefundTransfers } from '@/lib/admin/refund-transfers.server';
import { REFUND_TRANSFERS_PATH, refundTransferPageNumber, refundTransfersHref } from '@/lib/admin/refund-transfers';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(REFUND_TRANSFERS_PATH, { capability: 'sales.manage', adminOnly: true });
  const page = refundTransferPageNumber((await searchParams).page);
  const data = await loadRefundTransfers(page);
  const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize));
  if (page > lastPage) redirect(refundTransfersHref(lastPage));
  return <RefundTransfersScreen data={data} />;
}

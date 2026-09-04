import { ReceiptsConsole } from '@/components/admin/screens/ReceiptsConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminReceiptsConsoleData } from '@/lib/admin/receipts.server';

/* 증빙 — 현금영수증(의무발행)과 세금계산서 신청. */
export default async function AdminReceiptsPage() {
  await requireAdminScreenAccess('/admin/sales/receipts');
  const data = await getAdminReceiptsConsoleData();
  return <ReceiptsConsole data={data} />;
}

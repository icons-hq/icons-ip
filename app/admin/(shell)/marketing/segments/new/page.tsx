import { notFound } from 'next/navigation';
import { CustomerSegmentEditorScreen } from '@/components/admin/screens/CustomerSegmentEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CUSTOMER_SEGMENTS_PATH } from '@/lib/admin/customer-segments';
import { loadCustomerSegment } from '@/lib/admin/customer-segments.server';
import { isUuid } from '@/lib/uuid';
export default async function NewCustomerSegmentPage({ searchParams }: { searchParams?: Promise<Record<string,string|string[]|undefined>> } = {}) {
  await requireAdminScreenAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' });
  const params = await searchParams ?? {}, copyId = Array.isArray(params.copy) ? params.copy[0] : params.copy;
  if (copyId && !isUuid(copyId)) notFound();
  const detail = copyId ? await loadCustomerSegment(copyId) : null;
  if (copyId && !detail) notFound();
  return <CustomerSegmentEditorScreen key={copyId ?? 'new'} detail={detail} copy={!!copyId} />;
}

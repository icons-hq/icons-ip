import { notFound } from 'next/navigation';
import { CustomerSegmentEditorScreen } from '@/components/admin/screens/CustomerSegmentEditorScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { CUSTOMER_SEGMENTS_PATH } from '@/lib/admin/customer-segments';
import { loadCustomerSegment } from '@/lib/admin/customer-segments.server';
import { isUuid } from '@/lib/uuid';
export default async function CustomerSegmentDetailPage({ params }: { params: Promise<{ segmentId: string }> }) {
  await requireAdminScreenAccess(CUSTOMER_SEGMENTS_PATH, { capability: 'marketing.manage' });
  const { segmentId } = await params; if (!isUuid(segmentId)) notFound();
  const detail = await loadCustomerSegment(segmentId); if (!detail) notFound();
  return <CustomerSegmentEditorScreen key={`${segmentId}:${detail.segment.revision}`} detail={detail} />;
}

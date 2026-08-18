import { notFound } from 'next/navigation';
import { InquiryDetailScreen } from '@/components/admin/screens/InquiryDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminInquiryBackHref } from '@/lib/admin/inquiries';
import { loadAdminInquiryDetail } from '@/lib/admin/inquiries.server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminCsInquiryDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/cs/inquiries/[inquiryId]'>) {
  await requireAdminScreenAccess('/admin/cs/inquiries');

  const { inquiryId: raw } = await params;
  const inquiryId = raw.toLowerCase();
  if (!UUID_PATTERN.test(inquiryId)) notFound();

  const query = await searchParams;
  const detail = await loadAdminInquiryDetail(inquiryId);
  if (!detail) notFound();

  return (
    <InquiryDetailScreen backHref={adminInquiryBackHref(query.back)} detail={detail} />
  );
}

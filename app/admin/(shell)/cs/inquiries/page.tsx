import { InquiryQueueScreen } from '@/components/admin/screens/InquiryQueueScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminInquiryFilters } from '@/lib/admin/inquiries';
import { getAdminInquiryConsoleData } from '@/lib/admin/inquiries.server';

export default async function AdminCsInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 문의 조회를 막지 못한다.
   */
  await requireAdminScreenAccess('/admin/cs/inquiries');
  const query = await searchParams;

  const data = await getAdminInquiryConsoleData(normalizeAdminInquiryFilters(query));

  return <InquiryQueueScreen data={data} />;
}

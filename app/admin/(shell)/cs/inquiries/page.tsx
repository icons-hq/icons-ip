import { hasAdminCapability } from '@/lib/admin/access';
import { AdminOpenInquiryBadge } from '@/components/admin/AdminOpenInquiryBadge';
import { InquiryQueueScreen } from '@/components/admin/screens/InquiryQueueScreen';
import { InquiryDetailScreen } from '@/components/admin/screens/InquiryDetailScreen';
import { InquiryPreviewWorkspace } from '@/components/admin/screens/CustomerServiceDialog';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminInquiryHref, normalizeAdminInquiryFilters } from '@/lib/admin/inquiries';
import { getAdminInquiryConsoleData, getAdminInquiryNavigation, loadAdminInquiryDetail } from '@/lib/admin/inquiries.server';

export default async function AdminCsInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
   * 게이트를 로더보다 먼저 부른다. layout에도 같은 게이트가 있지만 Next.js는
   * layout과 page를 병렬로 렌더하므로 layout의 redirect가 문의 조회를 막지 못한다.
   */
  const auth = await requireAdminScreenAccess('/admin/cs/inquiries');
  const access = { canReadOrders: hasAdminCapability(auth, 'sales.read'), canManageSales: hasAdminCapability(auth, 'sales.manage') };
  const canViewCustomer = hasAdminCapability(auth, 'platform.manage');
  const query = await searchParams;

  const filters = normalizeAdminInquiryFilters(query);
  const inquiryId = typeof query.inquiryId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query.inquiryId)
    ? query.inquiryId.toLowerCase() : null;
  const [data, detail] = await Promise.all([
    getAdminInquiryConsoleData(filters),
    inquiryId ? loadAdminInquiryDetail(inquiryId, access) : Promise.resolve(null),
  ]);
  const closeHref = adminInquiryHref(filters);
  const navigation = detail ? await getAdminInquiryNavigation(detail.inquiry.id, data, 'preview') : undefined;

  return <>
    <AdminOpenInquiryBadge count={data.counts.open} />
    <InquiryQueueScreen data={data} />
    <InquiryPreviewWorkspace closeHref={closeHref} selected={Boolean(inquiryId)}>
      {detail ? <InquiryDetailScreen embedded key={`${auth.user.id}:${detail.inquiry.id}`} accountId={auth.user.id} navigation={navigation} backHref={closeHref} detail={detail} {...access} canViewCustomer={canViewCustomer} /> : inquiryId ? <p role="alert">문의를 찾을 수 없습니다. 삭제되었거나 접근 권한이 변경되었을 수 있습니다.</p> : null}
    </InquiryPreviewWorkspace>
  </>;
}

import { hasAdminCapability } from '@/lib/admin/access';
import { notFound } from 'next/navigation';
import { AdminOpenInquiryBadge } from '@/components/admin/AdminOpenInquiryBadge';
import { InquiryDetailScreen } from '@/components/admin/screens/InquiryDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { adminInquiryBackFilters, adminInquiryBackHref } from '@/lib/admin/inquiries';
import { getAdminInquiryConsoleData, getAdminInquiryNavigation, loadAdminInquiryDetail } from '@/lib/admin/inquiries.server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function AdminCsInquiryDetailPage({
  params,
  searchParams,
}: PageProps<'/admin/cs/inquiries/[inquiryId]'>) {
  const auth = await requireAdminScreenAccess('/admin/cs/inquiries');
  const access = { canReadOrders: hasAdminCapability(auth, 'sales.read'), canManageSales: hasAdminCapability(auth, 'sales.manage') };
  const canViewCustomer = hasAdminCapability(auth, 'platform.manage');

  const { inquiryId: raw } = await params;
  const inquiryId = raw.toLowerCase();
  if (!UUID_PATTERN.test(inquiryId)) notFound();

  const query = await searchParams;
  const [detail, data] = await Promise.all([
    loadAdminInquiryDetail(inquiryId, access),
    getAdminInquiryConsoleData(adminInquiryBackFilters(query.back)),
  ]);
  if (!detail) notFound();
  const navigation = await getAdminInquiryNavigation(inquiryId, data, 'detail');

  /* 이 문의와 별개인 전체 미답변 수라 제목 위가 아니라 머리 줄 오른쪽에 둔다. */
  return <InquiryDetailScreen key={`${auth.user.id}:${inquiryId}`} accountId={auth.user.id} navigation={navigation} backHref={adminInquiryBackHref(query.back)} detail={detail} {...access} canViewCustomer={canViewCustomer} pendingBadge={<AdminOpenInquiryBadge count={data.counts.open} />} />;
}

import { canAccessAdminScreen } from '@/lib/admin/access';
import { notFound } from 'next/navigation';
import { CustomerDetailScreen } from '@/components/admin/screens/CustomerDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isCustomerId, normalizeCustomerDetailFilters } from '@/lib/admin/customer-detail';
import { getAdminCustomerDetail } from '@/lib/admin/customer-detail.server';
import { notePiiAccess } from '@/lib/admin/pii-access-log.server';

export default async function AdminCustomerDetailPage({ params, searchParams }: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await params;
  const auth = await requireAdminScreenAccess(`/admin/customers/${userId}`);
  if (!isCustomerId(userId)) notFound();
  const filters = normalizeCustomerDetailFilters(await searchParams);
  const detail = await getAdminCustomerDetail(userId, filters);
  if (!detail) notFound();
  /* 전체 이메일·동의·정지 사유·주문·문의를 보여 주는 화면 — 개인정보 접속기록을 남긴다(실패해도 화면은 연다). */
  await notePiiAccess({ actorId: auth.user.id, action: 'view', surface: 'customer.detail', path: `/admin/customers/${userId}`,
    subjectKind: 'member', subjectIds: [userId], detail: { tab: filters.tab, page: filters.page } });
  return <CustomerDetailScreen detail={detail} canManageCredits={canAccessAdminScreen(auth, null, { capability: 'marketing.manage', adminOnly: true })} actor={{ id: auth.user.id, role: auth.role ?? 'staff' }} noteOperationId={crypto.randomUUID()} />;
}

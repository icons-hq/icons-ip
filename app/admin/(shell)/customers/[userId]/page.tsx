import { canAccessAdminScreen } from '@/lib/admin/access';
import { notFound } from 'next/navigation';
import { CustomerDetailScreen } from '@/components/admin/screens/CustomerDetailScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { isCustomerId, normalizeCustomerDetailFilters } from '@/lib/admin/customer-detail';
import { getAdminCustomerDetail } from '@/lib/admin/customer-detail.server';

export default async function AdminCustomerDetailPage({ params, searchParams }: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { userId } = await params;
  const auth = await requireAdminScreenAccess(`/admin/customers/${userId}`);
  if (!isCustomerId(userId)) notFound();
  const detail = await getAdminCustomerDetail(userId, normalizeCustomerDetailFilters(await searchParams));
  if (!detail) notFound();
  return <CustomerDetailScreen detail={detail} canManageCredits={canAccessAdminScreen(auth, null, { capability: 'marketing.manage', adminOnly: true })} actor={{ id: auth.user.id, role: auth.role ?? 'staff' }} noteOperationId={crypto.randomUUID()} />;
}

import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeAdminSubscriptionFilters } from '@/lib/admin/subscriptions';
import { loadAdminSubscriptions } from '@/lib/admin/subscriptions.server';
import { AdminSubscriptionsScreen } from '@/components/admin/screens/AdminSubscriptionsScreen';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess('/admin/sales/subscriptions', { capability: 'sales.read' });
  const filters = normalizeAdminSubscriptionFilters(await searchParams), data = await loadAdminSubscriptions(auth.user.id, filters);
  return <AdminSubscriptionsScreen data={data} />;
}

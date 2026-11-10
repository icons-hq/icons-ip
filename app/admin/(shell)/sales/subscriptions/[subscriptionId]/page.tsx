import { notFound } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { hasAdminCapability } from '@/lib/admin/access';
import { loadAdminSubscription } from '@/lib/admin/subscriptions.server';
import { isUuid } from '@/lib/uuid';
import { AdminSubscriptionDetailScreen } from '@/components/admin/screens/AdminSubscriptionDetailScreen';
export const maxDuration = 90;
export default async function Page({ params, searchParams }: { params: Promise<{ subscriptionId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const auth = await requireAdminScreenAccess('/admin/sales/subscriptions', { capability: 'sales.read' });
  const { subscriptionId } = await params; if (!isUuid(subscriptionId)) notFound();
  const query = await searchParams, before = typeof query.before === 'string' && /^[1-9][0-9]{0,8}$/.test(query.before) ? Number(query.before) : undefined;
  const data = await loadAdminSubscription(auth.user.id, subscriptionId, before);
  return <AdminSubscriptionDetailScreen actorId={auth.user.id} data={data} canManage={hasAdminCapability(auth, 'sales.manage')} older={before !== undefined} />;
}

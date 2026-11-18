import { SystemHealthScreen } from '@/components/admin/screens/SystemHealthScreen';
import { hasAdminCapability } from '@/lib/admin/access';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { SYSTEM_HEALTH_PATH } from '@/lib/admin/system-health';
import { loadSystemHealth, loadUnresolvedPaymentAttempts } from '@/lib/admin/system-health.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(SYSTEM_HEALTH_PATH);
  const canReconcile = hasAdminCapability(auth, 'sales.manage');
  const [health, payments] = await Promise.all([
    loadSystemHealth(),
    canReconcile ? loadUnresolvedPaymentAttempts(50) : Promise.resolve(undefined),
  ]);
  return <SystemHealthScreen canReconcile={canReconcile} health={health} payments={payments} />;
}

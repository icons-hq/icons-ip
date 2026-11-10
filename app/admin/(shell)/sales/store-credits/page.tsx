import { StoreCreditConsoleScreen } from '@/components/admin/screens/StoreCreditConsoleScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeStoreCreditConsoleFilters } from '@/lib/admin/store-credit-console';
import { getStoreCreditConsole } from '@/lib/admin/store-credit-console.server';
import { loadAdminStoreCreditPolicy } from '@/lib/admin/store-credits.server';
export default async function StoreCreditConsolePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess('/admin/sales/store-credits', { adminOnly: true });
  const filters = normalizeStoreCreditConsoleFilters(await searchParams);
  const [data, policy] = await Promise.all([getStoreCreditConsole(filters), loadAdminStoreCreditPolicy()]);
  return <StoreCreditConsoleScreen data={data} policy={policy} />;
}

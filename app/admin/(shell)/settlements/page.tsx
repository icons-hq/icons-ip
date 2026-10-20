import { loadSettlementAccounts } from '@/lib/settlements/accounts.server';
import { settlementAccountKey } from '@/lib/settlements/accounts';
import { PgSettlementScreen } from '@/components/admin/screens/PgSettlementScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizePgSettlementFilters, PG_SETTLEMENT_PATH } from '@/lib/settlements/console';
import { loadPgSettlementReport, pgSettlementConnectionState } from '@/lib/settlements/report.server';

// Each Server Action reads one provider page with its documented >=60s timeout.
export const maxDuration = 90;
export default async function AdminPgSettlementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(PG_SETTLEMENT_PATH, { capability: 'sales.manage', adminOnly: true });
  const normalized = normalizePgSettlementFilters(await searchParams);const accounts = await loadSettlementAccounts();
  const defaultAccount = accounts?.find(account => account.mode === normalized.mode);
  // A first ordinary import registers its opaque identity. On refresh, resolve
  // the initial connection marker to that saved account so its result is visible.
  const currentAccount = normalized.account === 'current' ? accounts?.find(account => account.integration === 'toss_payment' && account.mode === normalized.mode) : null;
  const filters = { ...normalized, account: currentAccount ? settlementAccountKey(currentAccount) : normalized.account ?? (defaultAccount ? settlementAccountKey(defaultAccount) : null) };
  const report = await loadPgSettlementReport(filters);
  return <PgSettlementScreen filters={filters} report={report} connection={await pgSettlementConnectionState(filters.account)} accounts={accounts ?? []} operationId={crypto.randomUUID()} />;
}

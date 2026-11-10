import { StatsSalesHourlyControls, StatsSalesHourlyScreen } from '@/components/admin/screens/StatsSalesHourlyScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ADMIN_SALES_HOURLY_PATH, normalizeAdminSalesHourlyFilters, SalesHourlyReadError, type AdminSalesHourlyReport } from '@/lib/admin/stats-hourly';
import { getAdminSalesHourlyReport } from '@/lib/admin/stats-hourly.server';

export default async function AdminSalesHourlyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminScreenAccess(ADMIN_SALES_HOURLY_PATH);
  const filters = normalizeAdminSalesHourlyFilters(await searchParams);
  if (filters.error) return <div className="flex min-w-0 flex-col gap-4"><StatsSalesHourlyControls filters={filters} error={filters.error} /></div>;
  let report: AdminSalesHourlyReport | null = null;
  let errorMessage: string | undefined;
  try {
    report = await getAdminSalesHourlyReport(filters);
  } catch (error) {
    if (!(error instanceof SalesHourlyReadError) || error.code !== 'invalid_filters') throw error;
    errorMessage = error.message;
  }
  if (!report) return <div className="flex min-w-0 flex-col gap-4"><StatsSalesHourlyControls filters={filters} error={errorMessage} /></div>;
  return <StatsSalesHourlyScreen filters={filters} report={report} />;
}

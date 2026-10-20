import { BenefitReportControls, BenefitReportScreen } from '@/components/admin/screens/BenefitReportScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { BENEFIT_REPORT_PATH, normalizeBenefitReportFilters } from '@/lib/admin/benefit-report';
import { getBenefitIssuances, getBenefitReport } from '@/lib/admin/benefit-report.server';
import { adminStatsPreviousFilters } from '@/lib/admin/stats';
import { canAccessAdminScreen } from '@/lib/admin/access';

export default async function AdminBenefitReportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const actor = await requireAdminScreenAccess(BENEFIT_REPORT_PATH);
  const filters = normalizeBenefitReportFilters(await searchParams);
  const admin = canAccessAdminScreen(actor, null, { capability: 'marketing.manage', adminOnly: true });
  if (filters.rangeError) return <section className="admin-benefits-console wc-admin-kit"><BenefitReportControls filters={filters} admin={admin} /><p role="alert">{filters.rangeError}</p></section>;
  const now = new Date();
  const [data, comparison, issuances] = await Promise.all([
    getBenefitReport(filters, now),
    filters.compare ? getBenefitReport({ ...filters, ...adminStatsPreviousFilters(filters, now), page: 1 }, now) : null,
    filters.detail === 'issuances' ? getBenefitIssuances(filters, now) : null,
  ]);
  return <BenefitReportScreen data={data} comparison={comparison} issuances={issuances} filters={filters} admin={admin} now={now} />;
}

import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { trafficFilters } from '@/lib/admin/store-analytics';
import { getNoticeTrafficReport, getTrafficReport } from '@/lib/admin/store-analytics.server';
import { StatsTrafficScreen } from '@/components/admin/screens/StatsTrafficScreen';
export default async function TrafficPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 await requireAdminScreenAccess('/admin/stats/traffic');
 const filters=trafficFilters(await searchParams);
 const [report,noticeReport]=filters.error?[null,null]:await Promise.all([getTrafficReport(filters),getNoticeTrafficReport(filters)]);
 return <StatsTrafficScreen filters={filters} noticeReport={noticeReport} report={report} />;
}

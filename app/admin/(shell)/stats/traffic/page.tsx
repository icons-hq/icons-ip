import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { trafficFilters } from '@/lib/admin/store-analytics';
import { getTrafficReport } from '@/lib/admin/store-analytics.server';
import { StatsTrafficScreen } from '@/components/admin/screens/StatsTrafficScreen';
export default async function TrafficPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
 await requireAdminScreenAccess('/admin/stats/traffic');
 const filters=trafficFilters(await searchParams);return <StatsTrafficScreen filters={filters} report={filters.error?null:await getTrafficReport(filters)} />;
}

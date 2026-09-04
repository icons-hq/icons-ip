import { StatsAnalysisScreen } from '@/components/admin/screens/StatsAnalysisScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { normalizeStatsAnalysisFilters } from '@/lib/admin/stats-analysis';
import { getStatsAnalysisData } from '@/lib/admin/stats-analysis.server';

/* 판매 분석 — 언제·누가·어디서·무엇이를 같은 모집단으로 본다(D-6). */
export default async function AdminStatsAnalysisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdminScreenAccess('/admin/stats/analysis');
  const data = await getStatsAnalysisData(normalizeStatsAnalysisFilters(await searchParams));
  return <StatsAnalysisScreen data={data} />;
}

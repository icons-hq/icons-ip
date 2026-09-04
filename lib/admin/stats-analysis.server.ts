import 'server-only';

import { getAdminIpOptions } from '@/lib/admin/catalog-list.server';
import { kstDay } from '@/lib/admin/kst';
import { createClient } from '@/lib/supabase/server';
import type {
  StatsAnalysisData,
  StatsAnalysisFilters,
  StatsBreakdownRow,
  StatsProductRow,
  StatsTimeseriesRow,
} from './stats-analysis';

/**
 * 분석 로더 (D-6).
 *
 * 집계는 전부 DB 가 끝낸다. 앱에서 다시 합산하면 PostgREST 1,000행 절단과 KST 경계 차이로
 * 화면마다 다른 숫자가 나온다 — 기존 통계 로더가 같은 이유로 그렇게 돼 있다.
 */

interface TimeseriesPayload {
  rows: StatsTimeseriesRow[] | null;
  compare: StatsTimeseriesRow[] | null;
  refreshedAt: string;
}

/** 기간 경계. 끝은 「지금」이 아니라 다음 KST 자정이다 — 오늘 버킷이 반쯤 잘려 보이지 않게. */
function range(days: number, now: Date) {
  const dayMs = 86_400_000;
  const todayKst = kstDay(now);
  const startKst = kstDay(new Date(now.getTime() - (days - 1) * dayMs));
  return {
    from: new Date(`${startKst}T00:00:00+09:00`).toISOString(),
    to: new Date(Date.parse(`${todayKst}T00:00:00+09:00`) + dayMs).toISOString(),
  };
}

export async function getStatsAnalysisData(
  filters: StatsAnalysisFilters,
  now: Date = new Date(),
): Promise<StatsAnalysisData> {
  const supabase = await createClient();
  const { from, to } = range(filters.days, now);
  const ipId = filters.ipId || null;

  const [timeseries, breakdown, products, ipOptions] = await Promise.all([
    supabase.rpc('admin_stats_timeseries', {
      p_compare: filters.compare,
      p_from: from,
      p_ip_id: ipId,
      p_to: to,
      p_unit: filters.unit,
    }),
    supabase.rpc('admin_stats_breakdown', {
      p_axis: filters.axis,
      p_from: from,
      p_ip_id: ipId,
      p_to: to,
    }),
    supabase.rpc('admin_stats_products', {
      p_from: from,
      p_ip_id: ipId,
      p_limit: 20,
      p_rank: filters.rank,
      p_to: to,
    }),
    getAdminIpOptions(),
  ]);

  if (timeseries.error) throw new Error(`Failed to load stats timeseries: ${timeseries.error.message}`);
  if (breakdown.error) throw new Error(`Failed to load stats breakdown: ${breakdown.error.message}`);
  if (products.error) throw new Error(`Failed to load stats products: ${products.error.message}`);

  const series = timeseries.data as TimeseriesPayload;
  return {
    filters,
    rows: series?.rows ?? [],
    compare: series?.compare ?? null,
    breakdown: ((breakdown.data as { rows?: StatsBreakdownRow[] })?.rows ?? []),
    products: ((products.data as { rows?: StatsProductRow[] })?.rows ?? []),
    refreshedAt: series?.refreshedAt ?? new Date().toISOString(),
    ipOptions: ipOptions.map((ip) => ({ id: ip.id, title: ip.title })),
  };
}

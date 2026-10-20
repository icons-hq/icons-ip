import type { AdminSalesHourlyReport } from './stats-hourly';

export function salesHourlyFixture(completedHours = 7): AdminSalesHourlyReport {
  const date = '2026-10-14'; const comparisonDate = '2026-10-07';
  const totals = [0, 0, 0, 0];
  const hours = Array.from({ length: 24 }, (_, hour) => {
    const observed = hour < completedHours;
    const values = hour === 0 ? [1, 1000, 2, 1500] : hour === 6 ? [2, 3000, 1, 800] : [0, 0, 0, 0];
    if (observed) for (let i = 0; i < 4; i++) totals[i] += values[i];
    return { hour, orderCount: observed ? values[0] : null, revenue: observed ? values[1] : null,
      comparisonOrderCount: observed ? values[2] : null, comparisonRevenue: observed ? values[3] : null,
      cumulativeOrderCount: observed ? totals[0] : null, cumulativeRevenue: observed ? totals[1] : null,
      comparisonCumulativeOrderCount: observed ? totals[2] : null, comparisonCumulativeRevenue: observed ? totals[3] : null };
  });
  const cutoff = `${date}T${String(completedHours).padStart(2, '0')}:00:00+09:00`;
  const comparisonCutoff = `${comparisonDate}T${String(completedHours).padStart(2, '0')}:00:00+09:00`;
  return { date, comparisonDate, asOf: `${date}T07:31:45+09:00`, cutoff, comparisonCutoff, completedHours, ipId: '',
    lastHourFrom: new Date(Date.parse(cutoff) - 3600000).toISOString(), comparisonLastHourFrom: new Date(Date.parse(comparisonCutoff) - 3600000).toISOString(),
    summary: { current: completedHours ? { orderCount: totals[0], revenue: totals[1] } : null, comparison: completedHours ? { orderCount: totals[2], revenue: totals[3] } : null }, hours,
    todayGoods: completedHours ? [{ rank: 1, goodId: 'hourly-good-1', name: '주문 당시 상품명', ipId: 'hourly-ip', qty: 4, revenue: 6000, comparisonQty: 5, comparisonRevenue: 7500 }] : [],
    lastHourGoods: [{ rank: 1, goodId: 'hourly-good-2', name: '직전 1시간 상품', ipId: 'hourly-ip', qty: 1, revenue: 800, comparisonQty: 0, comparisonRevenue: 0 }],
  };
}

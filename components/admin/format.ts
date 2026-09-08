import type { AdminMetricWindow } from '@/lib/admin/insights.server';

/* 운영 화면의 금액은 자릿수를 줄이지 않는다(PM 2026-09-08 「엑셀처럼」). 「₩6만」은 6만 원인지
 * 6만 4천 원인지 말해 주지 않아 대사가 안 된다 — 대시보드·주문 목록·차트 눈금 모두 전체 숫자다. */
export function formatKrw(value: number) {
  return `₩${value.toLocaleString('ko-KR')}`;
}

export type MetricChangeType = 'positive' | 'negative' | 'neutral';

export function metricChange(metric: AdminMetricWindow): { change: string; changeType: MetricChangeType } {
  if (!metric.previous) {
    return { change: '—', changeType: 'neutral' };
  }
  const pct = ((metric.current - metric.previous) / metric.previous) * 100;
  if (Math.abs(pct) < 0.05) return { change: '0%', changeType: 'neutral' };
  const rounded = Math.abs(pct) >= 100 ? Math.round(pct) : Number(pct.toFixed(1));
  return {
    change: `${pct > 0 ? '+' : ''}${rounded}%`,
    changeType: pct > 0 ? 'positive' : 'negative',
  };
}

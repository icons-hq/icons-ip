import type { AdminMetricWindow } from '@/lib/admin/insights.server';

export function formatKrw(value: number) {
  if (value >= 100_000_000) {
    const eok = value / 100_000_000;
    return `₩${eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  }
  if (value >= 10_000) return `₩${Math.round(value / 10_000).toLocaleString('ko-KR')}만`;
  return `₩${value.toLocaleString('ko-KR')}`;
}

/**
 * 주문·결제·환불 대조용 금액. 통계 축약 표기(`만`·`억`)와 달리 원 단위를
 * 보존해야 하므로 목록·상세에서만 사용한다.
 */
export function formatKrwExact(value: number) {
  const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
  return `₩${integer.toLocaleString('ko-KR')}`;
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

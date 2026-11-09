import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/admin/kit/ui/card';
import type { MetricChangeType } from './format';
import { StatsChangeBadge, type StatsChangeDirection } from './StatsSummary';

const CHANGE_DIRECTION: Record<MetricChangeType, StatsChangeDirection> = { positive: 'up', negative: 'down', neutral: 'flat' };

/** 직전 기간 대비 증감 배지(홈 지표 공통). */
export function MetricChangeBadge({ change, changeType, title }: { change: string; changeType: MetricChangeType; title?: string }) {
  return <StatsChangeBadge direction={CHANGE_DIRECTION[changeType]} title={title}>{change}</StatsChangeBadge>;
}

/*
 * 지표 카드(템플릿 대시보드의 SectionCards 모양, ADR-0028). 숫자는 foreground, 증감은 화살표와 부호가 있는
 * 의미색 배지로 읽는다(ADR-0029) — 색만으로 오르내림을 구분하지 않는다.
 */
export function MetricCard({
  change,
  changeType,
  label,
  value,
  comparisonDays = 30,
}: {
  change: string;
  changeType: MetricChangeType;
  label: string;
  value: string;
  comparisonDays?: number;
}) {
  return (
    <Card className="min-w-0" data-admin-metric="">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl leading-tight font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</CardTitle>
        <CardAction>
          <MetricChangeBadge change={change} changeType={changeType} title={`이전 ${comparisonDays}일 대비`} />
        </CardAction>
      </CardHeader>
    </Card>
  );
}

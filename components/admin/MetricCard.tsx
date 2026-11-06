import { Minus, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/admin/kit/ui/card';
import type { MetricChangeType } from './format';

const CHANGE_ICONS = { positive: TrendingUp, negative: TrendingDown, neutral: Minus } as const;

/*
 * 지표 카드(템플릿 대시보드의 SectionCards 모양, ADR-0028). 숫자는 foreground, 증감은 아이콘과 부호가 있는
 * 외곽선 배지로 읽는다 — 색만으로 오르내림을 구분하지 않는다.
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
  const ChangeIcon = CHANGE_ICONS[changeType];
  return (
    <Card className="min-w-0" data-admin-metric="">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl leading-tight font-semibold tabular-nums [overflow-wrap:anywhere]">{value}</CardTitle>
        <CardAction>
          <Badge title={`이전 ${comparisonDays}일 대비`} variant="outline">
            <ChangeIcon aria-hidden="true" />
            {change}
          </Badge>
        </CardAction>
      </CardHeader>
    </Card>
  );
}

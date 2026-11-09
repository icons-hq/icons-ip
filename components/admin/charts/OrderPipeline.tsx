import type { AdminPipelineStage } from '@/lib/admin/insights.server';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { ADMIN_VOCABULARY } from '@/lib/admin/vocabulary';
import { statusTone, type AdminTone } from '@/lib/admin/status-tone';
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/admin/kit/ui/card';

/* 주문 파이프라인 카드(kit Card, ADR-0028). 막대는 상태 배지와 같은 의미색이다(ADR-0029) — 같은 주문 상태는 어느 화면에서나 같은 색이고, 옆의 상태 이름·건수가 글자로 함께 말한다. */
const STAGE_BAR_CLASS: Record<AdminTone, string> = {
  neutral: 'bg-muted-foreground/50',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-destructive',
};

export function OrderPipeline({ stages }: { stages: AdminPipelineStage[] }) {
  const total = stages.reduce((sum, stage) => sum + stage.count, 0);

  return (
    <Card data-admin-widget="order-pipeline">
      <CardHeader>
        <h3 className="text-base leading-snug font-medium text-foreground">주문 파이프라인</h3>
        <CardDescription>{ADMIN_VOCABULARY.goods} 주문 상태 분포 · 전체 기간</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {stages.map((stage) => {
          const pct = total ? Math.round((stage.count / total) * 100) : 0;
          return (
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-3" key={stage.status}>
              <span className="text-sm text-muted-foreground">{ADMIN_ORDER_STATUS_LABELS[stage.status]}</span>
              <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className={`h-full rounded-full ${STAGE_BAR_CLASS[statusTone('order', stage.status)]}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="flex items-baseline gap-2 text-sm tabular-nums">
                <span className="text-muted-foreground">{stage.count.toLocaleString('ko-KR')}건</span>
                <span className="w-10 text-right font-medium">{pct}%</span>
              </span>
            </div>
          );
        })}
      </CardContent>
      <CardFooter className="justify-between gap-3">
        <span className="text-muted-foreground">전체 주문</span>
        <strong className="font-semibold tabular-nums">{total.toLocaleString('ko-KR')}건</strong>
      </CardFooter>
    </Card>
  );
}

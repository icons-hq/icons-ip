import { Star } from 'lucide-react';
import type { AdminTopIp } from '@/lib/admin/insights.server';
import { Card, CardAction, CardContent, CardDescription, CardHeader } from '@/components/admin/kit/ui/card';
import { formatKrw } from './format';

export function TopIps({ ips }: { ips: AdminTopIp[] }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <h3 className="text-base leading-snug font-medium">IP별 매출 톱 {ips.length || 5}</h3>
        <CardDescription>최근 30일 · 상품 주문 기준</CardDescription>
        <CardAction><Star aria-hidden="true" className="size-4 text-muted-foreground" /></CardAction>
      </CardHeader>
      <CardContent>
        {ips.length ? (
          <ol className="flex flex-col divide-y">
            {ips.map((ip, index) => (
              <li className="flex min-w-0 items-center justify-between gap-4 py-3 first:pt-0 last:pb-0" key={ip.ipId}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`flex size-8 shrink-0 items-center justify-center rounded-lg border text-xs font-medium tabular-nums ${index === 0 ? 'bg-muted font-semibold text-foreground' : 'bg-muted text-muted-foreground'}`}
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <strong className="truncate text-sm font-medium">{ip.title}</strong>
                    <span className="text-xs text-muted-foreground">주문 {ip.orderCount.toLocaleString('ko-KR')}건</span>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{formatKrw(ip.revenue)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">최근 30일 매출 데이터가 없습니다.</p>
        )}
      </CardContent>
    </Card>
  );
}

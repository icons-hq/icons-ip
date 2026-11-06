import type { AdminRecentOrder } from '@/lib/admin/insights.server';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import type { TicketOrderStatus } from '@/lib/ticketing';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/admin/kit/ui/card';
import { formatKrwExact } from './format';

const kstDateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

// 티켓 결제 완료에는 상품 발주·배송 단계가 없다.
const TICKET_ORDER_STATUS_LABELS: Record<TicketOrderStatus, string> = {
  pending: '결제 대기',
  paid: '결제 완료',
  canceled: '취소',
};

/* 최근 주문 카드(kit Card·Badge, ADR-0028). */
export function RecentOrders({ orders }: { orders: AdminRecentOrder[] }) {
  return (
    <Card data-admin-widget="recent-orders">
      <CardHeader>
        <h3 className="text-base leading-snug font-medium text-foreground">최근 주문</h3>
        <CardDescription>상품·티켓 최신 {orders.length ? orders.length : 5}건</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {orders.map((order) => {
          const labels: Readonly<Record<string, string>> = order.kind === 'ticket'
            ? TICKET_ORDER_STATUS_LABELS : ADMIN_ORDER_STATUS_LABELS;
          const status = order.status as AdminOrderStatus | TicketOrderStatus;
          return (
            <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0" key={`${order.kind}-${order.id}`}>
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-foreground">
                  {order.buyerName.charAt(0).toUpperCase()}
                </span>
                <div className="flex min-w-0 flex-col">
                  <strong className="truncate font-medium">@{order.buyerName}</strong>
                  <span className="text-xs text-muted-foreground">
                    {order.kind === 'ticket' ? '티켓' : '상품'} · {kstDateTime.format(new Date(order.createdAt))}
                  </span>
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="font-medium tabular-nums">{formatKrwExact(order.total)}</span>
                <Badge data-status={status} variant={order.status === 'canceled' ? 'outline' : 'secondary'}>
                  {labels[order.status] ?? order.status}
                </Badge>
              </div>
            </div>
          );
        })}
        {!orders.length && (
          <p className="py-6 text-center text-muted-foreground">아직 주문이 없습니다.</p>
        )}
      </CardContent>
    </Card>
  );
}

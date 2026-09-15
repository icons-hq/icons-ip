import type { AdminRecentOrder } from '@/lib/admin/insights.server';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import type { TicketOrderStatus } from '@/lib/ticketing';
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

export function RecentOrders({ orders }: { orders: AdminRecentOrder[] }) {
  return (
    <div className="card col wc-admin-kit wc-admin-kit__card admin-overview-panel">
      <div className="admin-overview-panel__heading">
        <div>
          <h3 className="admin-overview-panel__title">최근 주문</h3>
          <div className="admin-overview-panel__description">상품·티켓 최신 {orders.length ? orders.length : 5}건</div>
        </div>
      </div>
      <div className="admin-overview-list">
        {orders.map((order) => {
          const labels: Readonly<Record<string, string>> = order.kind === 'ticket'
            ? TICKET_ORDER_STATUS_LABELS : ADMIN_ORDER_STATUS_LABELS;
          const status = order.status as AdminOrderStatus | TicketOrderStatus;
          return (
            <div className="admin-overview-list__row" key={`${order.kind}-${order.id}`}>
              <div className="admin-overview-list__identity">
                <span className="mono admin-overview-list__avatar">
                  {order.buyerName.charAt(0).toUpperCase()}
                </span>
                <div className="admin-overview-list__copy">
                  <strong className="admin-overview-list__name">@{order.buyerName}</strong>
                  <span className="admin-overview-list__meta">
                    {order.kind === 'ticket' ? '티켓' : '상품'} · {kstDateTime.format(new Date(order.createdAt))}
                  </span>
                </div>
              </div>
              <div className="admin-overview-list__amount">
                <span className="admin-overview-list__value">{formatKrwExact(order.total)}</span>
                <span className="tag admin-overview-list__status" data-status={status}>
                  {labels[order.status] ?? order.status}
                </span>
              </div>
            </div>
          );
        })}
        {!orders.length && (
          <p className="admin-overview-list__empty muted">아직 주문이 없습니다.</p>
        )}
      </div>
    </div>
  );
}

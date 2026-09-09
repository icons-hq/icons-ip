import type { AdminRecentOrder } from '@/lib/admin/insights.server';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import type { TicketOrderStatus } from '@/lib/ticketing';
import { formatKrw } from './format';

const kstDateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_COLORS: Record<AdminOrderStatus, string> = {
  pending: 'var(--wc-warning)',
  paid: 'var(--wc-success)',
  confirmed: 'var(--wc-info)',
  shipping: 'var(--wc-info)',
  delivered: 'var(--wc-success)',
  done: 'var(--wc-success)',
  canceled: 'var(--wc-ink-tertiary)',
};

// 티켓 결제 완료에는 상품 발주·배송 단계가 없다.
const TICKET_ORDER_STATUS_LABELS: Record<TicketOrderStatus, string> = {
  pending: '결제 대기',
  paid: '결제 완료',
  canceled: '취소',
};

export function RecentOrders({ orders }: { orders: AdminRecentOrder[] }) {
  return (
    <div className="card col wc-admin-kit wc-admin-kit__card" style={{ minWidth: 0 }}>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>최근 주문</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>상품·티켓 최신 {orders.length ? orders.length : 5}건</div>
      </div>
      {orders.map((order) => {
        const labels: Readonly<Record<string, string>> = order.kind === 'ticket'
          ? TICKET_ORDER_STATUS_LABELS : ADMIN_ORDER_STATUS_LABELS;
        const colors: Readonly<Record<string, string>> = STATUS_COLORS;
        return (
          <div className="between" key={`${order.kind}-${order.id}`} style={{ borderTop: '1px solid var(--wc-hairline)', gap: 12, padding: '11px 0' }}>
            <div className="row" style={{ gap: 11, justifyContent: 'flex-start', minWidth: 0 }}>
              <span
                className="mono"
                style={{
                  alignItems: 'center',
                  background: 'var(--wc-surface-grey)',
                  border: '1px solid var(--wc-hairline)',
                  borderRadius: 10,
                  display: 'grid',
                  flex: '0 0 auto',
                  fontSize: 13,
                  fontWeight: 700,
                  height: 36,
                  placeItems: 'center',
                  width: 36,
                }}
              >
                {order.buyerName.charAt(0).toUpperCase()}
              </span>
              <div className="col" style={{ gap: 3, minWidth: 0 }}>
                <strong style={{ fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  @{order.buyerName}
                </strong>
                <span className="faint mono" style={{ fontSize: 11 }}>
                  {order.kind === 'ticket' ? '티켓' : '상품'} · {kstDateTime.format(new Date(order.createdAt))}
                </span>
              </div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{formatKrw(order.total)}</span>
              <span className="tag" style={{ color: colors[order.status] ?? 'var(--wc-ink-tertiary)' }}>{labels[order.status] ?? order.status}</span>
            </div>
          </div>
        );
      })}
      {!orders.length && (
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 2px' }}>아직 주문이 없습니다.</p>
      )}
    </div>
  );
}

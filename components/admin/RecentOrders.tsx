import type { AdminRecentOrder } from '@/lib/admin/insights.server';
import { formatKrw } from './format';

const kstDateTime = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const STATUS_META: Record<string, { label: string; color: string }> = {
  pending: { label: '결제 대기', color: 'var(--amber)' },
  paid: { label: '결제 완료', color: 'var(--mint)' },
  shipping: { label: '배송 중', color: 'var(--cyan)' },
  done: { label: '구매 확정', color: 'var(--mint)' },
  canceled: { label: '취소', color: 'var(--faint)' },
};

export function RecentOrders({ orders }: { orders: AdminRecentOrder[] }) {
  return (
    <div className="card col" style={{ borderRadius: 10, minWidth: 0, padding: 18 }}>
      <div style={{ marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>최근 주문</h2>
        <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>굿즈·티켓 최신 {orders.length ? orders.length : 5}건</div>
      </div>
      {orders.map((order) => {
        const status = STATUS_META[order.status] ?? { label: order.status, color: 'var(--dim)' };
        return (
          <div className="between" key={`${order.kind}-${order.id}`} style={{ borderTop: '1px solid var(--line)', gap: 12, padding: '11px 0' }}>
            <div className="row" style={{ gap: 11, justifyContent: 'flex-start', minWidth: 0 }}>
              <span
                className="mono"
                style={{
                  alignItems: 'center',
                  background: 'rgba(255,255,255,.05)',
                  border: '1px solid var(--line)',
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
                  {order.kind === 'ticket' ? '티켓' : '굿즈'} · {kstDateTime.format(new Date(order.createdAt))}
                </span>
              </div>
            </div>
            <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{formatKrw(order.total)}</span>
              <span className="tag" style={{ color: status.color }}>{status.label}</span>
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

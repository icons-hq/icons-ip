import { Badge } from '@/components/admin/kit/ui/badge';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';

/*
 * 주문 상태 배지(kit Badge, ADR-0028). 의미색은 토큰만 쓴다 — 결제 대기는 주의, 취소는 위험, 나머지는 중립이다.
 * 화면·테스트가 상태를 찾는 자리는 data-order-status다.
 */
const WARNING = 'border-transparent bg-[color-mix(in_oklab,var(--wc-warning)_12%,transparent)] text-[var(--wc-warning)]';

export function OrderStatusBadge({ status, label, title }: { status: AdminOrderStatus; label?: string; title?: string }) {
  return <Badge
    className={status === 'pending' ? WARNING : undefined}
    data-order-status={status}
    title={title}
    variant={status === 'canceled' ? 'destructive' : status === 'done' ? 'outline' : 'secondary'}
  >{label ?? ADMIN_ORDER_STATUS_LABELS[status]}</Badge>;
}

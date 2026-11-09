import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ADMIN_ORDER_STATUS_LABELS, type AdminOrderStatus } from '@/lib/admin/orders';
import { statusTone } from '@/lib/admin/status-tone';

/*
 * 주문 상태 배지. 색은 lib/admin/status-tone이 정한다(ADR-0029).
 * 화면·테스트가 상태를 찾는 자리는 data-order-status다.
 */
export function OrderStatusBadge({ status, label, title }: { status: AdminOrderStatus; label?: string; title?: string }) {
  return <AdminStatusBadge data-order-status={status} title={title} tone={statusTone('order', status)}>{label ?? ADMIN_ORDER_STATUS_LABELS[status]}</AdminStatusBadge>;
}

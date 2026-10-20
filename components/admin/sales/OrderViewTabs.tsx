import Link from 'next/link';
import type { AdminOrderFilters } from '@/lib/admin/orders';
import { orderViewHref, type AdminOrderItemFilters } from '@/lib/admin/order-items';
export function OrderViewTabs({ filters, view }: { filters: AdminOrderFilters | AdminOrderItemFilters; view: 'orders' | 'items' }) {
  return <nav className="admin-console-tabs" aria-label="주문 조회 단위">
    <Link href={orderViewHref(filters, 'orders')} aria-current={view === 'orders' ? 'page' : undefined}>주문별 조회</Link>
    <Link href={orderViewHref(filters, 'items')} aria-current={view === 'items' ? 'page' : undefined}>상품주문별 조회</Link>
  </nav>;
}

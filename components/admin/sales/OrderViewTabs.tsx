import Link from 'next/link';
import type { AdminOrderFilters } from '@/lib/admin/orders';
import { orderViewHref, type AdminOrderItemFilters } from '@/lib/admin/order-items';

/* 조회 단위 전환은 셸의 콘솔 전환과 같은 구분 선택 모양이다(ADR-0028). */
const TAB_CLASS = 'inline-flex h-7 items-center rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm';

export function OrderViewTabs({ filters, view }: { filters: AdminOrderFilters | AdminOrderItemFilters; view: 'orders' | 'items' }) {
  return <nav className="inline-flex w-fit max-w-full flex-wrap rounded-lg bg-muted p-0.5" aria-label="주문 조회 단위">
    <Link className={TAB_CLASS} href={orderViewHref(filters, 'orders')} aria-current={view === 'orders' ? 'page' : undefined}>주문별 조회</Link>
    <Link className={TAB_CLASS} href={orderViewHref(filters, 'items')} aria-current={view === 'items' ? 'page' : undefined}>상품주문별 조회</Link>
  </nav>;
}

import Link from 'next/link';
import { AdminStatusBadge } from '@/components/admin/console/AdminKit';
import type { AdminCustomerRow, CustomerTab } from '@/lib/admin/customer-detail';
import { ADMIN_ORDER_STATUS_LABELS } from '@/lib/admin/orders';
import { ADMIN_INQUIRY_STATUS_LABELS } from '@/lib/inquiries';
import { isOrderClaimType, ORDER_CLAIM_STAGE_LABELS, ORDER_CLAIM_TYPE_LABELS, ORDER_CLAIM_TYPE_SLUGS } from '@/lib/orders/claims';

export const customerDateTime = (value: string) => new Date(value).toLocaleString('ko-KR', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
});
const labels: Partial<Record<CustomerTab, Record<string, string>>> = {
  orders: ADMIN_ORDER_STATUS_LABELS, inquiries: ADMIN_INQUIRY_STATUS_LABELS, claims: ORDER_CLAIM_STAGE_LABELS,
  coupons: { active: '보유', used: '사용 완료', expired: '만료' },
};
const RECORD_LINK_CLASS = 'text-sm font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';
export function CustomerRecordList({ tab, items }: { tab: CustomerTab; items: AdminCustomerRow[] }) {
  if (!items.length) return <p className="py-6 text-center text-sm text-muted-foreground">등록된 이력이 없습니다.</p>;
  return <ul className="flex flex-col divide-y">{items.map((row) => {
    const href = tab === 'orders' ? `/admin/sales/orders/${row.id}`
      : tab === 'inquiries' ? `/admin/cs/inquiries/${row.id}`
        : tab === 'claims' && isOrderClaimType(row.claimType) ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[row.claimType]}/${row.id}` : null;
    const title = tab === 'claims' && isOrderClaimType(row.claimType) ? `${ORDER_CLAIM_TYPE_LABELS[row.claimType]} 요청 · ${row.title || '사유 없음'}` : row.title;
    return <li className="flex min-w-0 flex-col items-start gap-1.5 py-3 text-sm wrap-anywhere first:pt-0 last:pb-0" key={row.id}>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <time className="tabular-nums" dateTime={row.createdAt}>{customerDateTime(row.createdAt)}</time>
        {row.authorName ? <span>{row.authorName}</span> : null}
        {row.status && labels[tab]?.[row.status] ? <AdminStatusBadge>{labels[tab]?.[row.status]}</AdminStatusBadge> : null}
      </div>
      {title ? <strong className="font-medium text-foreground">{title}</strong> : null}
      {row.amount != null ? <span className="tabular-nums">{row.amount.toLocaleString('ko-KR')}원{row.itemCount ? ` · ${row.itemCount}개 품목` : ''}</span> : null}
      {row.body ? <p className="leading-relaxed whitespace-pre-wrap">{row.body}</p> : null}
      {row.code ? <span>쿠폰 코드 · {row.code}</span> : null}
      {row.expiresAt ? <span className="text-muted-foreground">만료 · {customerDateTime(row.expiresAt)}</span> : null}
      {href || (row.orderId && tab !== 'orders') ? <div className="flex flex-wrap gap-x-4 gap-y-1">
        {href ? <Link className={RECORD_LINK_CLASS} href={href}>상세 열기</Link> : null}
        {row.orderId && tab !== 'orders' ? <Link className={RECORD_LINK_CLASS} href={`/admin/sales/orders/${row.orderId}`}>연결 주문 열기</Link> : null}
      </div> : null}
    </li>;
  })}</ul>;
}

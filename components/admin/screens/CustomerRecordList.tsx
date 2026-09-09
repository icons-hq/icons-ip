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
export function CustomerRecordList({ tab, items }: { tab: CustomerTab; items: AdminCustomerRow[] }) {
  if (!items.length) return <p className="admin-customer__empty">등록된 이력이 없습니다.</p>;
  return <ul className="admin-customer__records">{items.map((row) => {
    const href = tab === 'orders' ? `/admin/sales/orders/${row.id}`
      : tab === 'inquiries' ? `/admin/cs/inquiries/${row.id}`
        : tab === 'claims' && isOrderClaimType(row.claimType) ? `/admin/sales/claims/${ORDER_CLAIM_TYPE_SLUGS[row.claimType]}/${row.id}` : null;
    const title = tab === 'claims' && isOrderClaimType(row.claimType) ? `${ORDER_CLAIM_TYPE_LABELS[row.claimType]} 요청 · ${row.title || '사유 없음'}` : row.title;
    return <li key={row.id}>
      <div className="admin-customer__record-meta">
        <time dateTime={row.createdAt}>{customerDateTime(row.createdAt)}</time>
        {row.authorName ? <span>{row.authorName}</span> : null}
        {row.status && labels[tab]?.[row.status] ? <AdminStatusBadge>{labels[tab]?.[row.status]}</AdminStatusBadge> : null}
      </div>
      {title ? <strong>{title}</strong> : null}
      {row.amount != null ? <span>{row.amount.toLocaleString('ko-KR')}원{row.itemCount ? ` · ${row.itemCount}개 품목` : ''}</span> : null}
      {row.body ? <p className="admin-customer__note-body">{row.body}</p> : null}
      {row.code ? <span>쿠폰 코드 · {row.code}</span> : null}
      {row.expiresAt ? <span>만료 · {customerDateTime(row.expiresAt)}</span> : null}
      {href ? <Link href={href}>상세 열기</Link> : null}
      {row.orderId && tab !== 'orders' ? <Link href={`/admin/sales/orders/${row.orderId}`}>연결 주문 열기</Link> : null}
    </li>;
  })}</ul>;
}

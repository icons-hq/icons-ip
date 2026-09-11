import Link from 'next/link';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { CUSTOMER_TABS, CUSTOMER_TAB_LABELS, customerDetailHref, type AdminCustomerDetail } from '@/lib/admin/customer-detail';
import type { AdminMemberRole } from '@/lib/admin/members';
import { isLoyaltyGrade, loyaltyGradeLabel } from '@/lib/loyalty';
import { CustomerLoyaltyControl, CustomerSuspensionControl } from './CustomerAccountControls';
import { CustomerNoteForm } from './CustomerNoteForm';
import { CustomerRecordList, customerDateTime } from './CustomerRecordList';

export function CustomerDetailScreen({ detail, actor, noteOperationId }: {
  detail: AdminCustomerDetail; actor: { id: string; role: AdminMemberRole }; noteOperationId: string;
}) {
  const { customer, counts, tab } = detail;
  return <div className="admin-customer">
    <AdminPageHeader title={customer.nickname} description={`${customer.email} · ${customer.id}`}
      actions={<Link className="admin-customer__link-button" href="/admin/community/members">회원 목록</Link>} />
    <div className="admin-customer__summary">{actor.role === 'admin' && <Link className="admin-customer__link-button" href={`/admin/customers/${encodeURIComponent(customer.id)}/store-credits`}>적립금 잔액·조정</Link>}<AdminStatusBadge>{isLoyaltyGrade(customer.loyaltyGrade) ? loyaltyGradeLabel(customer.loyaltyGrade) : '등급 확인 필요'}</AdminStatusBadge>
      <AdminStatusBadge tone={customer.suspendedAt ? 'danger' : 'neutral'}>{customer.suspendedAt ? '정지' : '이용 중'}</AdminStatusBadge>
      <span>가입 · {customerDateTime(customer.createdAt)}</span>
    </div>
    <nav aria-label="고객 상세 탭" className="admin-customer__tabs">{CUSTOMER_TABS.map((entry) =>
      <Link key={entry} href={customerDetailHref(customer.id, entry)} aria-current={entry === tab ? 'page' : undefined}>
        {CUSTOMER_TAB_LABELS[entry]}{entry !== 'overview' ? <span>{counts[entry].toLocaleString('ko-KR')}</span> : null}
      </Link>)}</nav>
    {tab === 'overview' ? <>
      <div className="admin-customer__overview">
        <AdminSectionCard title="고객 개요"><dl className="admin-customer__facts">
          <div><dt>현재 동의</dt><dd>이용약관 · {customer.consents.terms ? '동의' : '미동의'}<br />개인정보 · {customer.consents.privacy ? '동의' : '미동의'}<br />마케팅 · {customer.consents.marketing ? '동의' : '미동의'}</dd></div>
          <div><dt>상품 주문</dt><dd>{customer.goodsOrderCount.toLocaleString('ko-KR')}건</dd></div>
          <div><dt>티켓 예매</dt><dd>{customer.ticketOrderCount.toLocaleString('ko-KR')}건</dd></div>
          <div><dt>신고</dt><dd>제출 {customer.submittedReportCount}건 · 받은 신고 {customer.receivedReportCount}건</dd></div>
        </dl></AdminSectionCard>
        <CustomerSuspensionControl key={`${customer.id}:${customer.suspendedAt}`} actor={actor} customer={customer} />
      </div>
      <CustomerLoyaltyControl key={`${customer.id}:${customer.loyaltyGrade}`} customer={customer} />
    </> : <AdminSectionCard title={CUSTOMER_TAB_LABELS[tab]}>
      {tab === 'notes' ? <CustomerNoteForm key={customer.id} userId={customer.id} initialOperationId={noteOperationId} /> : null}
      <CustomerRecordList tab={tab} items={detail.items} />
      <ConsolePagination page={detail.page} pageSize={detail.pageSize} total={detail.total}
        hrefForPage={(page) => customerDetailHref(customer.id, tab, page)} />
    </AdminSectionCard>}
  </div>;
}

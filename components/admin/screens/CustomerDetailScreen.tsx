import Link from 'next/link';
import { Coins, Users } from 'lucide-react';
import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { CUSTOMER_TABS, CUSTOMER_TAB_LABELS, customerDetailHref, type AdminCustomerDetail } from '@/lib/admin/customer-detail';
import type { AdminMemberRole } from '@/lib/admin/members';
import { statusTone } from '@/lib/admin/status-tone';
import { isLoyaltyGrade, loyaltyGradeLabel } from '@/lib/loyalty';
import { CustomerLoyaltyControl, CustomerSuspensionControl } from './CustomerAccountControls';
import { CustomerNoteForm } from './CustomerNoteForm';
import { CustomerRecordList, customerDateTime } from './CustomerRecordList';

const FACT_ROW_CLASS = 'grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[6.25rem_minmax(0,1fr)]';

/* 템플릿 룩(ADR-0028): 화면 머리 → 상태 요약 → 탭(밑줄형) → 개요(카드 두 칸) 또는 탭별 이력 카드. */
export function CustomerDetailScreen({ detail, actor, noteOperationId, canManageCredits = false }: {
  detail: AdminCustomerDetail; actor: { id: string; role: AdminMemberRole }; noteOperationId: string; canManageCredits?: boolean;
}) {
  const { customer, counts, tab } = detail;
  return <div className="flex min-w-0 flex-col gap-6 max-sm:gap-4" data-customer-detail="">
    <AdminPageHeader title={customer.nickname} description={`${customer.email} · ${customer.id}`}
      actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/community/members"><Users aria-hidden="true" />회원 목록</Link>} />
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{canManageCredits && <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={`/admin/customers/${encodeURIComponent(customer.id)}/store-credits`}><Coins aria-hidden="true" />적립금 잔액·조정</Link>}<AdminStatusBadge>{isLoyaltyGrade(customer.loyaltyGrade) ? loyaltyGradeLabel(customer.loyaltyGrade) : '등급 확인 필요'}</AdminStatusBadge>
      <AdminStatusBadge tone={statusTone('member', customer.suspendedAt ? 'suspended' : 'active')}>{customer.suspendedAt ? '정지' : '이용 중'}</AdminStatusBadge>
      <span className="tabular-nums">가입 · {customerDateTime(customer.createdAt)}</span>
    </div>
    <nav aria-label="고객 상세 탭" className="flex flex-wrap gap-x-5 gap-y-1 border-b">{CUSTOMER_TABS.map((entry) =>
      <Link className="-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 border-transparent text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-primary-soft-foreground" key={entry} href={customerDetailHref(customer.id, entry)} aria-current={entry === tab ? 'page' : undefined}>
        {CUSTOMER_TAB_LABELS[entry]}{entry !== 'overview' ? <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums">{counts[entry].toLocaleString('ko-KR')}</span> : null}
      </Link>)}</nav>
    {tab === 'overview' ? <>
      <div className="grid items-start gap-6 max-sm:gap-4 lg:grid-cols-2">
        <AdminSectionCard title="고객 개요"><dl className="grid gap-4">
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">현재 동의</dt><dd className="text-sm leading-relaxed wrap-anywhere">이용약관 · {customer.consents.terms ? '동의' : '미동의'}<br />개인정보 · {customer.consents.privacy ? '동의' : '미동의'}<br />마케팅 · {customer.consents.marketing ? '동의' : '미동의'}</dd></div>
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">상품 주문</dt><dd className="text-sm tabular-nums">{customer.goodsOrderCount.toLocaleString('ko-KR')}건</dd></div>
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">티켓 예매</dt><dd className="text-sm tabular-nums">{customer.ticketOrderCount.toLocaleString('ko-KR')}건</dd></div>
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">신고</dt><dd className="text-sm tabular-nums">제출 {customer.submittedReportCount}건 · 받은 신고 {customer.receivedReportCount}건</dd></div>
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

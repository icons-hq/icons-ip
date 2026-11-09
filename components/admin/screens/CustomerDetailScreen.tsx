import Link from 'next/link';
import { Coins, MessageSquare, RotateCcw, ShoppingBag, Ticket, TicketPercent, Users } from 'lucide-react';
import { AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminCountCard } from '@/components/admin/console/AdminCountCard';
import { ConsolePagination } from '@/components/admin/console/ConsolePagination';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { CUSTOMER_TABS, CUSTOMER_TAB_LABELS, customerDetailHref, type AdminCustomerDetail } from '@/lib/admin/customer-detail';
import type { AdminMemberRole } from '@/lib/admin/members';
import { statusTone } from '@/lib/admin/status-tone';
import { isLoyaltyGrade, loyaltyGradeLabel } from '@/lib/loyalty';
import { CustomerIdCopy, CustomerLoyaltyControl, CustomerSuspensionControl } from './CustomerAccountControls';
import { CustomerNoteForm } from './CustomerNoteForm';
import { CustomerRecordList, customerDateTime } from './CustomerRecordList';

const FACT_ROW_CLASS = 'grid grid-cols-[5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[6.25rem_minmax(0,1fr)]';

/** 같은 상태는 같은 색이다 — 미동의는 회색 하나로 두고, 필수·선택의 차이는 글자가 말한다. */
function ConsentRow({ label, agreed, required = false }: { label: string; agreed: boolean; required?: boolean }) {
  return <span className="flex items-center gap-2">{label}<span className="text-xs text-muted-foreground">{required ? '필수' : '선택'}</span><AdminStatusBadge tone={agreed ? 'success' : 'neutral'}>{agreed ? '동의' : '미동의'}</AdminStatusBadge></span>;
}

/* 템플릿 룩(ADR-0028): 고객 머리 카드(누구인지·상태·동작) → 탭(밑줄형) → 개요(건수 카드 + 카드 두 칸) 또는 탭별 이력 카드. 정지·등급 보정은 접어 둔다 — 고객을 보러 들어온 화면이다. */
export function CustomerDetailScreen({ detail, actor, noteOperationId, canManageCredits = false }: {
  detail: AdminCustomerDetail; actor: { id: string; role: AdminMemberRole }; noteOperationId: string; canManageCredits?: boolean;
}) {
  const { customer, counts, tab } = detail;
  return <div className="flex min-w-0 flex-col gap-6 max-sm:gap-4" data-customer-detail="">
    {/* 이 화면의 주인공은 고객이다 — 셸 제목보다 고객 이름이 먼저 읽히게 한 카드에 모은다. */}
    <section aria-label="고객 정보" className="flex flex-wrap items-start justify-between gap-4 rounded-xl border bg-card p-4 text-card-foreground sm:p-5">
      <div className="flex min-w-0 items-center gap-3.5">
        <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full border bg-muted text-lg font-semibold text-foreground">{customer.nickname.slice(0, 1)}</span>
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-xl leading-tight font-semibold text-foreground wrap-anywhere">{customer.nickname}</h2>
            <AdminStatusBadge>{isLoyaltyGrade(customer.loyaltyGrade) ? loyaltyGradeLabel(customer.loyaltyGrade) : '등급 확인 필요'}</AdminStatusBadge>
            <AdminStatusBadge tone={statusTone('member', customer.suspendedAt ? 'suspended' : 'active')}>{customer.suspendedAt ? '정지' : '이용 중'}</AdminStatusBadge></div>
          <p className="text-sm wrap-anywhere">{customer.email}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground tabular-nums"><span>가입 · {customerDateTime(customer.createdAt)}</span><CustomerIdCopy id={customer.id} /></p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {canManageCredits && <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={`/admin/customers/${encodeURIComponent(customer.id)}/store-credits`}><Coins aria-hidden="true" />적립금 잔액·조정</Link>}
        <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/community/members"><Users aria-hidden="true" />회원 목록</Link>
      </div>
    </section>
    <nav aria-label="고객 상세 탭" className="flex flex-wrap gap-x-5 gap-y-1 border-b">{CUSTOMER_TABS.map((entry) =>
      <Link className="-mb-px inline-flex min-h-10 items-center gap-2 border-b-2 border-transparent text-sm text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-primary aria-[current=page]:font-medium aria-[current=page]:text-primary-soft-foreground" key={entry} href={customerDetailHref(customer.id, entry)} aria-current={entry === tab ? 'page' : undefined}>
        {CUSTOMER_TAB_LABELS[entry]}{entry !== 'overview' ? <span className="rounded-full bg-muted px-1.5 text-xs font-normal text-muted-foreground tabular-nums">{counts[entry].toLocaleString('ko-KR')}</span> : null}
      </Link>)}</nav>
    {tab === 'overview' ? <>
      <div aria-label="고객 활동 건수" className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="group">
        <AdminCountCard count={customer.goodsOrderCount} href={customerDetailHref(customer.id, 'orders')} icon={ShoppingBag} label="상품 주문" />
        <AdminCountCard count={customer.ticketOrderCount} icon={Ticket} label="티켓 예매" />
        <AdminCountCard count={counts.inquiries} href={customerDetailHref(customer.id, 'inquiries')} icon={MessageSquare} label={CUSTOMER_TAB_LABELS.inquiries} />
        <AdminCountCard count={counts.claims} href={customerDetailHref(customer.id, 'claims')} icon={RotateCcw} label="취소·반품·교환" />
        <AdminCountCard count={counts.coupons} href={customerDetailHref(customer.id, 'coupons')} icon={TicketPercent} label={CUSTOMER_TAB_LABELS.coupons} />
      </div>
      <div className="grid items-start gap-6 max-sm:gap-4 lg:grid-cols-2">
        <AdminSectionCard title="고객 개요"><dl className="grid gap-4">
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">현재 동의</dt><dd className="flex flex-col gap-1.5 text-sm wrap-anywhere"><ConsentRow agreed={customer.consents.terms} label="이용약관" required /><ConsentRow agreed={customer.consents.privacy} label="개인정보" required /><ConsentRow agreed={customer.consents.marketing} label="마케팅" /></dd></div>
          <div className={FACT_ROW_CLASS}><dt className="text-sm text-muted-foreground">신고</dt><dd className="text-sm tabular-nums">제출 {customer.submittedReportCount}건 · 받은 신고 {customer.receivedReportCount}건</dd></div>
        </dl></AdminSectionCard>
        <div className="flex min-w-0 flex-col gap-6 max-sm:gap-4">
          <CustomerSuspensionControl key={`${customer.id}:${customer.suspendedAt}`} actor={actor} customer={customer} />
          <CustomerLoyaltyControl key={`${customer.id}:${customer.loyaltyGrade}`} customer={customer} />
        </div>
      </div>
    </> : <AdminSectionCard title={CUSTOMER_TAB_LABELS[tab]}>
      {tab === 'notes' ? <CustomerNoteForm key={customer.id} userId={customer.id} initialOperationId={noteOperationId} /> : null}
      <CustomerRecordList tab={tab} items={detail.items} />
      <ConsolePagination page={detail.page} pageSize={detail.pageSize} total={detail.total}
        hrefForPage={(page) => customerDetailHref(customer.id, tab, page)} />
    </AdminSectionCard>}
  </div>;
}

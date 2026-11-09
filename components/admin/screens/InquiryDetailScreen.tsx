import { adminGoodsCopy } from '@/lib/admin/vocabulary';

import { ShipmentDetails } from '@/components/shop/ShipmentDetails';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { InquiryMessageBody } from '@/components/screens/InquiryMessageBody';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { inquiryMessageAuthorLabel } from '@/lib/inquiries';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import {
  ADMIN_INQUIRY_STATUS_LABELS,
  formatInquiryDateTime,
  INQUIRY_CATEGORY_LABELS,
  inquiryReferenceLabel,
  inquirySlaState,
} from '@/lib/inquiries';
import { orderReferenceLabel } from '@/lib/orders';
import { isAdminInquiryOverdue, type AdminInquiryNavigation } from '@/lib/admin/inquiries';
import { InquiryAssignmentPanel, InquiryInternalNotesPanel } from './InquiryWorkspacePanel';
import { InquiryReplyPanel } from './InquiryReplyPanel';
import { InquiryPreviewBackLink } from './CustomerServiceDialog';
import { CustomerHistoryPanel } from './CustomerHistoryPanel';
import { InquiryLiveUpdates } from '@/components/screens/InquiryLiveUpdates';
import { InquirySatisfactionContext } from './InquirySatisfactionContext';
import { INQUIRY_LIVE_CLASS, INQUIRY_SLA_TONE_CLASS } from './cs-kit-classes';

/* 어드민 문의 상세(#253).
 *
 * 왼쪽이 대화, 오른쪽이 컨텍스트다. 컨텍스트 패널이 이 화면의 존재 이유다 — CS가
 * 주문 콘솔과 회원 화면을 오가며 맥락을 모으는 동안 답변은 늦어지고, 늦은 답변은
 * 같은 질문을 한 번 더 만든다.
 *
 * 클레임은 여기서 처리하지 않는다. 문의는 대화이고 클레임은 절차다 — 취소·반품이
 * 필요하면 주문 콘솔로 넘어가는 링크만 둔다.
 *
 * 템플릿 룩(ADR-0028). 배치는 화면 폭이 아니라 이 화면이 놓인 폭(컨테이너)을 본다 — 같은 화면이
 * 독립 상세(셸 본문)와 목록 위 팝업(최대 1024px) 양쪽에 그려진다. */

const ORDER_STATUS_LABELS: Record<string, string> = {
  pending: '결제 대기',
  paid: '신규주문',
  confirmed: '발주확인',
  shipping: '배송중',
  delivered: '배송완료',
  done: '거래확정',
  canceled: '취소',
};

const CLAIM_STATUS_LABELS: Record<string, string> = {
  requested: '승인 대기',
  processing: '결제 취소 중',
  needs_review: '운영 확인 필요',
  completed: '취소 완료',
  rejected: '요청 거절',
};

const PAYMENT_PROVIDER_LABELS: Record<string, string> = {
  toss: '토스페이먼츠',
  nicepay: '나이스페이',
  korpay: 'Korpay',
};

const CONTEXT_LINK_CLASS = `${buttonVariants({ size: 'sm', variant: 'outline' })} self-start`;

function ContextRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 text-right wrap-anywhere">{value}</span>
    </div>
  );
}

function ContextCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-card-foreground">
    <h3 className="text-sm font-medium text-foreground">{title}</h3>
    {children}
  </section>;
}

export function InquiryDetailScreen({
  backHref,
  detail,
  now = new Date(),
  canReadOrders = true,
  canManageSales = true,
  canViewCustomer = true,
  accountId = '',
  navigation,
  embedded = false,
}: {
  backHref: string;
  detail: AdminInquiryDetail;
  now?: Date;
  canReadOrders?: boolean;
  canManageSales?: boolean;
  canViewCustomer?: boolean;
  accountId?: string;
  navigation?: AdminInquiryNavigation;
  embedded?: boolean;
}) {
  const { buyer, inquiry, messages, order, staffOptions, notes } = detail;
  const sla = inquirySlaState(
    { answeredAt: inquiry.answeredAt, createdAt: inquiry.createdAt, status: inquiry.status },
    now,
  );
  const replyPanel = <InquiryReplyPanel
    key={`${accountId}:${inquiry.id}:reply`}
    accountId={accountId}
    category={inquiry.category}
    closed={inquiry.status === 'closed'}
    inquiryId={inquiry.id}
  />;
  const navLink = buttonVariants({ size: 'sm', variant: 'outline' });

  return (
    <div className={`@container/inquiry flex min-w-0 flex-col gap-4 ${INQUIRY_LIVE_CLASS}`} data-inquiry-detail={embedded ? 'embedded' : 'page'}>
      <InquiryLiveUpdates inquiryId={inquiry.id} audience="staff" />
      {/* 목록 조건 밖의 문의(position null)는 이전·다음이 없다 — 눌러지지 않는 줄을 두지 않아 제목이 위로 올라온다. */}
      {navigation && navigation.position !== null ? <nav className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2 text-sm" aria-label="고객문의 상세 이동">
        {navigation.previousHref ? <Link className={navLink} data-slot="button" href={navigation.previousHref} scroll={false}><ChevronLeft aria-hidden="true" />이전 문의</Link> : <Button disabled size="sm" type="button" variant="outline"><ChevronLeft aria-hidden="true" />이전 문의</Button>}
        <span className="text-center text-muted-foreground tabular-nums">{`${navigation.position} / ${navigation.total} · 현재 조회 순서`}</span>
        {navigation.nextHref ? <Link className={navLink} data-slot="button" href={navigation.nextHref} scroll={false}>다음 문의<ChevronRight aria-hidden="true" /></Link> : <Button disabled size="sm" type="button" variant="outline">다음 문의<ChevronRight aria-hidden="true" /></Button>}
      </nav> : null}
      <header className="flex min-w-0 flex-col gap-1.5">
        {/* 팝업(embedded) 안에서는 닫기와 같다 — X·Esc처럼 목록 스크롤을 두고 기록을 바꿔 쓰고, 패널이 기다리는 동안에는 누를 수 없다(R4). */}
        {embedded ? <InquiryPreviewBackLink href={backHref} /> : <Link className="w-fit text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={backHref}>← 문의 목록</Link>}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-medium tabular-nums">{inquiryReferenceLabel(inquiry.reference)}</span>
          <span aria-hidden="true" className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">{adminGoodsCopy(INQUIRY_CATEGORY_LABELS[inquiry.category])}</span>
          <AdminStatusBadge tone={statusTone('inquiry', inquiry.status)}>{ADMIN_INQUIRY_STATUS_LABELS[inquiry.status]}</AdminStatusBadge>
          <span className={INQUIRY_SLA_TONE_CLASS} data-sla-tone={sla.tone}>{sla.label}</span>
        </div>
        <h2 className="text-lg leading-snug font-semibold tracking-tight text-foreground wrap-anywhere">{inquiry.title}</h2>
        {isAdminInquiryOverdue(inquiry, now) ? <AdminStatusBadge data-sla-tone="danger" tone="danger">미답변 24시간 경과</AdminStatusBadge> : null}
        <span className="text-sm text-muted-foreground wrap-anywhere">
          @{inquiry.buyerName}
          {inquiry.buyerEmail ? ` · ${inquiry.buyerEmail}` : ''}
          {' · 접수 '}{formatInquiryDateTime(inquiry.createdAt)}
          {inquiry.assigneeName ? ` · 담당자 @${inquiry.assigneeName}` : ' · 담당자 미배정'}
        </span>
      </header>

      <div className={`grid min-w-0 items-start gap-4 ${embedded ? '@3xl/inquiry:grid-cols-2 @3xl/inquiry:gap-6' : '@4xl/inquiry:grid-cols-[minmax(0,1.6fr)_minmax(16rem,0.9fr)]'}`}>
        <div className="flex min-w-0 flex-col gap-3.5">
          {embedded ? <h3 className="border-b pb-2 text-sm font-medium text-muted-foreground">고객문의 내용 보기</h3> : null}
          <ol className="flex flex-col gap-2.5">
            {messages.map((message) => (
              <li
                className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-3.5 text-card-foreground data-[author=staff]:bg-muted/50 data-[author=system]:border-dashed"
                data-author={message.author}
                key={message.id}
              >
                <span className="text-xs text-muted-foreground tabular-nums">
                  {inquiryMessageAuthorLabel(message.author,message.authorName,`@${inquiry.buyerName}`)}
                  {' · '}
                  {formatInquiryDateTime(message.createdAt)}
                </span>
                <p className="text-sm leading-relaxed whitespace-pre-wrap wrap-anywhere">
                  <InquiryMessageBody body={message.body} automatic={message.author==='system'}/>
                </p>
                {message.imageUrls.length ? (
                  <div className="flex flex-wrap gap-2">
                    {message.imageUrls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`첨부 이미지 ${index + 1}`}
                        className="max-h-50 max-w-full rounded-lg border object-contain"
                        key={url}
                        src={url}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          {/* 답변이 이 화면의 주 작업이다. 내부 메모는 그 아래 참고 칸이다(팝업에서는 답변이 옆 칸에 있다). */}
          {!embedded ? replyPanel : null}

          <InquiryInternalNotesPanel key={`${accountId}:${inquiry.id}:note`} accountId={accountId} inquiryId={inquiry.id} notes={notes} />
        </div>
        {embedded ? <section className="flex min-w-0 flex-col gap-3.5" aria-label="판매자 답변 처리"><h3 className="border-b pb-2 text-sm font-medium text-muted-foreground">판매자 답변 처리</h3>{replyPanel}</section> : null}
        <aside aria-label="문의 컨텍스트" className={`grid min-w-0 content-start gap-3 ${embedded ? '@3xl/inquiry:col-span-2 @3xl/inquiry:grid-cols-2' : ''}`}>
          {canReadOrders ? <ContextCard title="연결 주문">
            {order ? (
              <>
                <ContextRow label="주문번호" value={orderReferenceLabel(order.id, order.orderNumber)} />
                <ContextRow label="주문상태" value={<AdminStatusBadge tone={statusTone('order', order.status)}>{ORDER_STATUS_LABELS[order.status] ?? order.status}</AdminStatusBadge>} />
                <ContextRow label="주문일시" value={formatInquiryDateTime(order.createdAt)} />
                <ContextRow
                  label="상품"
                  value={order.leadItemName
                    ? `${order.leadItemName} · 총 ${order.itemCount}개`
                    : `총 ${order.itemCount}개`}
                />
                <ContextRow label="결제금액" value={`₩${order.total.toLocaleString('ko-KR')}`} />
                {canManageSales ? <ContextRow
                  label="결제"
                  value={order.payment
                    ? `${PAYMENT_PROVIDER_LABELS[order.payment.provider ?? ''] ?? order.payment.provider ?? '확인 필요'} · ${order.payment.status}`
                    : '결제 내역 없음'}
                /> : null}
                <ShipmentDetails admin shipments={order.shipments} />
                {canManageSales ? <div className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">클레임 이력</span>
                  {order.claims.length ? (
                    <ul className="flex flex-col gap-1">
                      {order.claims.map((claim) => (
                        <li className="flex flex-wrap items-center gap-1.5 text-sm" key={`${claim.requestedAt}-${claim.status}`}>
                          <AdminStatusBadge tone={statusTone('claim', claim.status)}>{CLAIM_STATUS_LABELS[claim.status] ?? claim.status}</AdminStatusBadge>
                          <span className="text-muted-foreground tabular-nums">{formatInquiryDateTime(claim.requestedAt)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span className="text-sm">없음</span>
                  )}
                </div> : null}
                {/* 문의에서 클레임이 필요해지면 여기서 넘어간다. 이 화면은 절차를 만들지 않는다. */}
                <Link className={CONTEXT_LINK_CLASS} data-slot="button" href={`/admin/sales/orders/${order.id}`}>
                  주문 콘솔에서 열기
                </Link>
              </>
            ) : (
              <span className="text-sm text-muted-foreground">
                연결된 주문이 없습니다. 주문 관련 문의라면 구매자에게 주문번호를 물어보세요.
              </span>
            )}
          </ContextCard> : null}

          {inquiry.goodId ? (
            <ContextCard title={adminGoodsCopy('연결 굿즈')}>
              <ContextRow label="상품" value={inquiry.goodName ?? inquiry.goodId} />
              <Link className={CONTEXT_LINK_CLASS} data-slot="button" href={`/shop/${inquiry.goodId}`}>{adminGoodsCopy(' 굿즈 상세 보기 ')}</Link>
            </ContextCard>
          ) : null}

          <ContextCard title="구매자">
            <ContextRow label="닉네임" value={`@${inquiry.buyerName}`} />
            <ContextRow label="이메일" value={buyer.email ?? '없음'} />
            {canReadOrders && typeof buyer.orderCount === 'number' ? <ContextRow label="주문 수" value={`${buyer.orderCount.toLocaleString('ko-KR')}건`} /> : null}
            <ContextRow
              label="문의 이력"
              value={`총 ${buyer.inquiryCount}건 · 진행 중 ${buyer.openInquiryCount}건`}
            />
            {buyer.suspendedAt ? (
              <AdminNotice role="alert" tone="danger">정지된 계정입니다 ({formatInquiryDateTime(buyer.suspendedAt)}).</AdminNotice>
            ) : null}
            {canViewCustomer ? <Link className={CONTEXT_LINK_CLASS} data-slot="button" href={`/admin/customers/${buyer.id}`}>
              고객 상세 열기
            </Link> : null}
          </ContextCard>
          <InquiryAssignmentPanel assigneeId={inquiry.assigneeId} assigneeName={inquiry.assigneeName} inquiryId={inquiry.id} staffOptions={staffOptions} />
          <InquirySatisfactionContext result={detail.satisfaction} />
          {canReadOrders ? <CustomerHistoryPanel key={buyer.id} userId={buyer.id} canReadClaims={canManageSales} /> : null}
        </aside>
      </div>
    </div>
  );
}

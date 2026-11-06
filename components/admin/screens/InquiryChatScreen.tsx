import Link from 'next/link';
import { ChevronDown, MessagesSquare, Search } from 'lucide-react';
import { InquiryLiveUpdates } from '@/components/screens/InquiryLiveUpdates';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { ADMIN_INQUIRY_CHAT_PAGE_SIZE, ADMIN_INQUIRY_CHAT_PATH, CHAT_STATUS_OPTIONS, inquiryChatHref, type InquiryChatContext, type InquiryChatData, type InquiryChatFilters } from '@/lib/admin/inquiry-chat';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { formatInquiryDateTime, INQUIRY_CATEGORY_LABELS, inquiryReferenceLabel } from '@/lib/inquiries';
import { orderReferenceLabel } from '@/lib/orders';
import { adminGoodsCopy } from '@/lib/admin/vocabulary';
import { InquiryChatControls } from './InquiryChatControls';
import { InquiryChatConversation } from './InquiryChatConversation';
import { InquiryAssignmentPanel, InquiryInternalNotesPanel } from './InquiryWorkspacePanel';
import { CustomerHistoryPanel } from './CustomerHistoryPanel';
import { InquiryChatTags } from './InquiryChatTags';
import { CHAT_CONTEXT_CARD_CLASS } from './cs-kit-classes';
import type { CustomerHistoryState } from '@/app/admin/customer-actions';

type PurchaseHistory = NonNullable<CustomerHistoryState['history']>;

const TEXT_LINK_CLASS = 'font-medium text-foreground underline underline-offset-4 hover:text-muted-foreground';
const PAGE_LINK_CLASS = buttonVariants({ size: 'xs', variant: 'ghost' });

/* 구매이력(A7, ADR-0020 그대로): sales.read 역할이면 page가 고객 주문 첫 페이지를 미리 읽어
   버튼 없이 바로 보여 준다. 권한이 없으면 카드 자체를 만들지 않는다.
 *
 * 템플릿 룩(ADR-0028). 셸이 몰입 모드로 본문 높이를 정하고, 이 화면은 그 높이를 꽉 채운다(h-full min-h-0).
 * 배치는 이 화면이 놓인 폭(컨테이너)을 본다 — 사이드바를 접고 펴도 같은 기준이다.
 * - 넓을 때(56rem~): 대화 목록 | 대화 | 상담 정보 세 칸. 대화와 상담 정보가 각자 스크롤한다.
 * - 중간(42~56rem): 대화 목록 | (대화 + 아래 상담 정보) — 오른쪽 칸이 함께 스크롤한다.
 * - 좁을 때(~42rem): 한 칸. 대화를 고르면 목록 대신 대화가 화면 높이를 채우고 상담 정보는 그 아래에 온다.
 * 어느 폭에서도 대화 목록은 안에서 스크롤하고 입력창은 대화 아래에 고정된다. */
export function InquiryChatScreen({ accountId, filters, data, detail, chatContext, selected, canReadOrders, canViewCustomer, purchaseHistory, purchaseHistoryError = false }: {
  accountId: string; filters: InquiryChatFilters; data: InquiryChatData; detail: AdminInquiryDetail | null;
  chatContext?: InquiryChatContext | null;
  selected: boolean; canReadOrders: boolean; canViewCustomer: boolean;
  purchaseHistory?: PurchaseHistory | null; purchaseHistoryError?: boolean;
}) {
  const pages = Math.max(1, Math.ceil(data.total / ADMIN_INQUIRY_CHAT_PAGE_SIZE));
  return <section className="@container/chat group/chat flex h-full min-h-0 min-w-0 flex-col bg-background text-sm [&>.inquiry-live:not(:empty)]:border-b [&>.inquiry-live:not(:empty)]:bg-muted/50 [&>.inquiry-live:not(:empty)]:px-3 [&>.inquiry-live:not(:empty)]:py-1" data-selected={selected ? 'true' : 'false'} aria-label="ICONS 실시간 상담">
    <div className="sr-only"><strong>ICONS 고객 상담</strong><span>문의 내용과 답변은 ICONS 고객에게 표시됩니다.</span></div>
    <InquiryLiveUpdates audience="staff" />
    <div className={`flex min-h-0 flex-1 flex-col @max-2xl/chat:group-data-[selected=true]/chat:overflow-y-auto @2xl/chat:grid @2xl/chat:grid-cols-[16rem_minmax(0,1fr)] @2xl/chat:grid-rows-[minmax(0,1fr)] @2xl/chat:overflow-hidden ${detail ? '@4xl/chat:grid-cols-[17.875rem_minmax(0,1fr)_18rem]' : '@4xl/chat:grid-cols-[17.875rem_minmax(0,1fr)]'}`}>
      <aside className="flex min-h-0 min-w-0 flex-1 flex-col bg-background @max-2xl/chat:group-data-[selected=true]/chat:hidden @2xl/chat:border-r" aria-label="대화 목록">
        <form action={ADMIN_INQUIRY_CHAT_PATH} className="flex shrink-0 gap-2 p-3">
          <input type="hidden" name="status" value={filters.status} /><input type="hidden" name="period" value={filters.period} />
          <input type="hidden" name="read" value={filters.read} /><input type="hidden" name="assignee" value={filters.assignee} /><input type="hidden" name="sort" value={filters.sort} />
          <Input type="search" name="query" maxLength={100} defaultValue={filters.query} key={filters.query} aria-label="대화 검색" placeholder="대화내용, 닉네임, 태그 검색" />
          <Button aria-label="대화 검색하기" size="icon" type="submit" variant="outline"><Search aria-hidden="true" /></Button>
        </form>
        <nav className="grid shrink-0 grid-cols-4 border-b" aria-label="상담 상태">{CHAT_STATUS_OPTIONS.map(option => <Link key={option.value} href={inquiryChatHref(filters, { status: option.value, page: 1 })}
          scroll={false} aria-current={filters.status === option.value ? 'page' : undefined}
          className="-mb-px flex min-h-14 flex-col items-center justify-center gap-0.5 border-b-2 border-transparent px-1 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground aria-[current=page]:border-foreground aria-[current=page]:font-medium aria-[current=page]:text-foreground"><span>{option.label}</span><strong className="text-base font-semibold text-foreground tabular-nums">{data.counts[option.value].toLocaleString('ko-KR')}</strong></Link>)}</nav>
        <InquiryChatControls filters={filters} staffOptions={data.staffOptions} />
        <Link className="mx-3 my-2 flex shrink-0 items-center justify-center rounded-lg border bg-muted/50 px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted" href={inquiryChatHref(filters, { read: 'unread', status: 'all', page: 1 })} scroll={false}>안읽은 메시지 {data.unreadMessages.toLocaleString('ko-KR')}개 전체 보기</Link>
        <ul className="min-h-0 flex-1 overflow-y-auto border-t">{data.rows.map(row => <li className="border-b" key={row.id}>
          <Link className="flex items-start gap-2.5 px-3 py-3.5 transition-colors hover:bg-muted/50 aria-[current=page]:bg-muted aria-[current=page]:shadow-[inset_3px_0_var(--primary)]" href={inquiryChatHref(filters, {}, row.id)} scroll={false} aria-current={detail?.inquiry.id === row.id ? 'page' : undefined}>
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border bg-muted text-sm font-semibold text-foreground" aria-hidden="true">{row.buyerName.slice(0, 1)}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1"><div className="flex min-w-0 items-baseline gap-1.5"><strong className="max-w-24 truncate font-medium text-foreground">{row.buyerName}</strong><span className="max-w-20 truncate rounded-full bg-muted px-1.5 py-px text-[0.65rem] text-muted-foreground" title={row.tags?.join(' · ')}>{row.tags?.[0] ?? adminGoodsCopy(INQUIRY_CATEGORY_LABELS[row.category])}</span></div>
              <p className="truncate text-xs text-foreground">{row.previewAuthor === 'staff' ? '운영자: ' : row.previewAuthor === 'system' ? '자동 안내: ' : ''}{row.preview || '첨부 파일'}</p>
              <small className="truncate text-xs text-muted-foreground">{row.title}</small></div>
            <div className="flex min-w-8 shrink-0 flex-col items-end gap-2.5 text-[0.65rem] text-muted-foreground"><time className="tabular-nums" dateTime={row.lastMessageAt}>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(row.lastMessageAt))}</time>
              {row.unreadCount > 0 ? <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-destructive px-1 text-[0.65rem] font-semibold text-primary-foreground tabular-nums" aria-label={`안읽은 메시지 ${row.unreadCount}개`}>{row.unreadCount > 99 ? '99+' : row.unreadCount}</span> : null}</div>
          </Link>
        </li>)}</ul>
        {!data.rows.length ? <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-sm text-muted-foreground"><p>조건에 맞는 대화가 없습니다.</p><Link className={TEXT_LINK_CLASS} href={inquiryChatHref(filters, { status: 'all', assignee: 'all', period: 'all', read: 'all', query: '', page: 1 })}>전체 대화 보기</Link></div> : null}
        <nav className="flex shrink-0 items-center justify-between border-t px-3 py-2 text-xs" aria-label="대화 목록 페이지">
          {filters.page > 1 ? <Link className={PAGE_LINK_CLASS} data-slot="button" scroll={false} href={inquiryChatHref(filters, { page: filters.page - 1 })}>이전</Link> : <span aria-disabled="true" className={`${PAGE_LINK_CLASS} pointer-events-none opacity-50`}>이전</span>}
          <span className="text-muted-foreground tabular-nums">{filters.page} / {pages}</span>{filters.page < pages ? <Link className={PAGE_LINK_CLASS} data-slot="button" scroll={false} href={inquiryChatHref(filters, { page: filters.page + 1 })}>다음</Link> : <span aria-disabled="true" className={`${PAGE_LINK_CLASS} pointer-events-none opacity-50`}>다음</span>}
        </nav>
      </aside>
      {/* 중간 폭에서만 대화와 상담 정보를 한 스크롤 칸으로 묶는다. 다른 폭에서는 상자 없이(contents) 바깥 배치의 칸이 된다. */}
      <div className="contents @2xl/chat:@max-4xl/chat:flex @2xl/chat:@max-4xl/chat:min-h-0 @2xl/chat:@max-4xl/chat:flex-col @2xl/chat:@max-4xl/chat:overflow-y-auto">
        <section className="flex h-full min-h-0 min-w-0 shrink-0 flex-col bg-muted/30 @max-2xl/chat:group-data-[selected=false]/chat:hidden @2xl/chat:@max-4xl/chat:min-h-[30rem]" aria-label="선택한 상담">
          {selected ? <nav className="flex shrink-0 items-center justify-between border-b bg-background px-3 py-2 text-xs @2xl/chat:hidden" aria-label="상담 화면 이동"><Link className={TEXT_LINK_CLASS} href={inquiryChatHref(filters)} scroll={false}>← 대화 목록</Link>
            {detail ? <a className={TEXT_LINK_CLASS} href="#inquiry-chat-context">상담정보 ↓</a> : null}</nav> : null}
          {detail ? <InquiryChatConversation key={`${accountId}:${detail.inquiry.id}`} accountId={accountId} detail={detail} /> : <div className="flex flex-1 flex-col items-center justify-center gap-2 p-7 text-center">
            <span className="mb-2 flex size-16 items-center justify-center rounded-full border bg-background text-muted-foreground" aria-hidden="true"><MessagesSquare className="size-7" /></span><h2 className="text-base font-medium text-foreground">{selected ? '대화를 찾을 수 없습니다.' : '상담할 대화를 선택해 주세요'}</h2>
            <p className="text-sm text-muted-foreground">{selected ? '문의가 삭제되었거나 접근 권한이 변경되었을 수 있습니다.' : '고객의 문의 내용과 구매 이력을 확인하면서 답변할 수 있습니다.'}</p>
          </div>}
        </section>
        {detail ? <aside id="inquiry-chat-context" tabIndex={-1} className="flex min-w-0 shrink-0 flex-col gap-3 bg-muted/30 p-3 outline-none @max-4xl/chat:border-t @4xl/chat:min-h-0 @4xl/chat:overflow-y-auto @4xl/chat:border-l" aria-label="상담 정보">
          <section className={CHAT_CONTEXT_CARD_CLASS}><h2 className="text-sm font-medium text-foreground">상담 정보</h2><strong className="text-base leading-snug font-semibold text-foreground wrap-anywhere">{detail.inquiry.title}</strong>
            <dl className="grid gap-1.5 text-xs"><div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">문의번호</dt><dd className="text-right tabular-nums">{inquiryReferenceLabel(detail.inquiry.reference)}</dd></div>
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">상담 시작</dt><dd className="text-right tabular-nums">{formatInquiryDateTime(detail.inquiry.createdAt)}</dd></div>
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">첫 응대</dt><dd className="text-right tabular-nums">{detail.inquiry.answeredAt ? formatInquiryDateTime(detail.inquiry.answeredAt) : '답변 대기'}</dd></div>
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2"><dt className="text-muted-foreground">문의 유형</dt><dd className="text-right">{adminGoodsCopy(INQUIRY_CATEGORY_LABELS[detail.inquiry.category])}</dd></div></dl>
          </section>
          {chatContext ? <InquiryChatTags key={detail.inquiry.id} accountId={accountId} inquiryId={detail.inquiry.id} tags={chatContext.tags} /> : null}
          <details className={`group ${CHAT_CONTEXT_CARD_CLASS}`}><summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-medium text-foreground [&::-webkit-details-marker]:hidden">담당자 관리<ChevronDown aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-180" /></summary><InquiryAssignmentPanel key={detail.inquiry.id} framed={false} inquiryId={detail.inquiry.id}
            assigneeId={detail.inquiry.assigneeId} assigneeName={detail.inquiry.assigneeName} staffOptions={detail.staffOptions} /></details>
          {canReadOrders ? <section className={CHAT_CONTEXT_CARD_CLASS}><h2 className="text-sm font-medium text-foreground">구매이력</h2>
            {detail.order ? <div className="flex flex-col gap-1 text-sm"><p>연결 주문 {orderReferenceLabel(detail.order.id, detail.order.orderNumber)}</p><p className="text-muted-foreground">{detail.order.leadItemName ?? '주문 상품'} · {detail.order.itemCount}개</p>
              <Link className={TEXT_LINK_CLASS} href={`/admin/sales/orders/${detail.order.id}`}>주문 상세 보기</Link></div> : <p className="text-sm text-muted-foreground">연결된 주문이 없습니다.</p>}
            {purchaseHistoryError ? <p className="bg-transparent text-sm text-destructive" role="alert">구매이력을 자동으로 불러오지 못했습니다. 아래에서 다시 불러와 주세요.</p> : null}
            <CustomerHistoryPanel key={detail.buyer.id} framed={false} userId={detail.buyer.id} canReadClaims={false} title="전체 구매이력"
              initialHistory={purchaseHistory?.userId === detail.buyer.id ? purchaseHistory : null} />
          </section> : null}
          <section className={CHAT_CONTEXT_CARD_CLASS}><h2 className="text-sm font-medium text-foreground">이전 대화이력</h2>
            {chatContext ? <>{chatContext.previous.length ? <ul className="flex flex-col divide-y">{chatContext.previous.map(previous => <li key={previous.id}>
              <Link className="flex flex-col gap-1 py-2 transition-colors hover:text-muted-foreground" href={inquiryChatHref(filters, {}, previous.id)} scroll={false}><strong className="text-xs font-medium text-foreground">{previous.title}</strong><span className="text-[0.65rem] text-muted-foreground">{CHAT_STATUS_OPTIONS.find(option => option.value === previous.status)?.label} · {formatInquiryDateTime(previous.lastMessageAt)}</span></Link>
            </li>)}</ul> : <p className="text-sm text-muted-foreground">이전 대화 이력이 없습니다.</p>}
              {chatContext.previousCount > 20 ? <p className="text-xs text-muted-foreground">최근 20개 대화를 표시합니다. 전체 {chatContext.previousCount}개</p> : null}</> : <p className="text-sm text-muted-foreground">총 {detail.buyer.inquiryCount}건 · 진행 중 {detail.buyer.openInquiryCount}건</p>}
            {canViewCustomer ? <Link className={`${TEXT_LINK_CLASS} text-sm`} href={`/admin/customers/${detail.buyer.id}?tab=inquiries`}>고객 상세 보기</Link> : null}
          </section>
          <div className={CHAT_CONTEXT_CARD_CLASS}><InquiryInternalNotesPanel key={`${accountId}:${detail.inquiry.id}`} framed={false} accountId={accountId} inquiryId={detail.inquiry.id} notes={detail.notes} /></div>
        </aside> : null}
      </div>
    </div>
  </section>;
}

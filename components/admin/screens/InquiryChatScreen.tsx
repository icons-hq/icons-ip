import Link from 'next/link';
import { InquiryLiveUpdates } from '@/components/screens/InquiryLiveUpdates';
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

export function InquiryChatScreen({ accountId, filters, data, detail, chatContext, selected, canReadOrders, canViewCustomer }: {
  accountId: string; filters: InquiryChatFilters; data: InquiryChatData; detail: AdminInquiryDetail | null;
  chatContext?: InquiryChatContext | null;
  selected: boolean; canReadOrders: boolean; canViewCustomer: boolean;
}) {
  const pages = Math.max(1, Math.ceil(data.total / ADMIN_INQUIRY_CHAT_PAGE_SIZE));
  return <section className="admin-inquiry-chat" data-selected={selected ? 'true' : 'false'} aria-label="ICONS 실시간 상담">
    <div className="admin-inquiry-chat__heading"><strong>ICONS 고객 상담</strong><span>문의 내용과 답변은 ICONS 고객에게 표시됩니다.</span></div>
    <InquiryLiveUpdates audience="staff" />
    <div className="admin-inquiry-chat__layout">
      <aside className="admin-inquiry-chat__queue" aria-label="대화 목록">
        <form action={ADMIN_INQUIRY_CHAT_PATH} className="admin-inquiry-chat__search">
          <input type="hidden" name="status" value={filters.status} /><input type="hidden" name="period" value={filters.period} />
          <input type="hidden" name="read" value={filters.read} /><input type="hidden" name="assignee" value={filters.assignee} /><input type="hidden" name="sort" value={filters.sort} />
          <input type="search" name="query" maxLength={100} defaultValue={filters.query} key={filters.query} aria-label="대화 검색" placeholder="대화내용, 닉네임, 태그 검색" />
          <button type="submit" aria-label="대화 검색하기">검색</button>
        </form>
        <nav className="admin-inquiry-chat__tabs" aria-label="상담 상태">{CHAT_STATUS_OPTIONS.map(option => <Link key={option.value} href={inquiryChatHref(filters, { status: option.value, page: 1 })}
          scroll={false} aria-current={filters.status === option.value ? 'page' : undefined}><span>{option.label}</span><strong>{data.counts[option.value].toLocaleString('ko-KR')}</strong></Link>)}</nav>
        <InquiryChatControls filters={filters} staffOptions={data.staffOptions} />
        <Link className="admin-inquiry-chat__unread" href={inquiryChatHref(filters, { read: 'unread', status: 'all', page: 1 })} scroll={false}>안읽은 메시지 {data.unreadMessages.toLocaleString('ko-KR')}개 전체 보기</Link>
        <ul className="admin-inquiry-chat__threads">{data.rows.map(row => <li key={row.id}>
          <Link href={inquiryChatHref(filters, {}, row.id)} scroll={false} aria-current={detail?.inquiry.id === row.id ? 'page' : undefined}>
            <span className="admin-inquiry-chat__avatar" aria-hidden="true">{row.buyerName.slice(0, 1)}</span>
            <div className="admin-inquiry-chat__thread-summary"><div><strong>{row.buyerName}</strong><span className="admin-inquiry-chat__category" title={row.tags?.join(' · ')}>{row.tags?.[0] ?? adminGoodsCopy(INQUIRY_CATEGORY_LABELS[row.category])}</span></div>
              <p>{row.previewAuthor === 'staff' ? '운영자: ' : row.previewAuthor === 'system' ? '자동 안내: ' : ''}{row.preview || '첨부 파일'}</p>
              <small>{row.title}</small></div>
            <div className="admin-inquiry-chat__thread-meta"><time dateTime={row.lastMessageAt}>{new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(row.lastMessageAt))}</time>
              {row.unreadCount > 0 ? <span aria-label={`안읽은 메시지 ${row.unreadCount}개`}>{row.unreadCount > 99 ? '99+' : row.unreadCount}</span> : null}</div>
          </Link>
        </li>)}</ul>
        {!data.rows.length ? <div className="admin-inquiry-chat__list-empty"><p>조건에 맞는 대화가 없습니다.</p><Link href={inquiryChatHref(filters, { status: 'all', assignee: 'all', period: 'all', read: 'all', query: '', page: 1 })}>전체 대화 보기</Link></div> : null}
        <nav className="admin-inquiry-chat__pagination" aria-label="대화 목록 페이지">
          {filters.page > 1 ? <Link scroll={false} href={inquiryChatHref(filters, { page: filters.page - 1 })}>이전</Link> : <span>이전</span>}
          <span>{filters.page} / {pages}</span>{filters.page < pages ? <Link scroll={false} href={inquiryChatHref(filters, { page: filters.page + 1 })}>다음</Link> : <span>다음</span>}
        </nav>
      </aside>
      <section className="admin-inquiry-chat__main" aria-label="선택한 상담">
        {selected ? <nav className="admin-inquiry-chat__mobile-nav" aria-label="상담 화면 이동"><Link href={inquiryChatHref(filters)} scroll={false}>← 대화 목록</Link>
          {detail ? <a href="#inquiry-chat-context">상담정보 ↓</a> : null}</nav> : null}
        {detail ? <InquiryChatConversation key={`${accountId}:${detail.inquiry.id}`} accountId={accountId} detail={detail} /> : <div className="admin-inquiry-chat__empty">
          <span aria-hidden="true">☏</span><h2>{selected ? '대화를 찾을 수 없습니다.' : '상담할 대화를 선택해 주세요'}</h2>
          <p>{selected ? '문의가 삭제되었거나 접근 권한이 변경되었을 수 있습니다.' : '고객의 문의 내용과 구매 이력을 확인하면서 답변할 수 있습니다.'}</p>
        </div>}
      </section>
      {detail ? <aside id="inquiry-chat-context" tabIndex={-1} className="admin-inquiry-chat__context" aria-label="상담 정보">
        <section className="admin-inquiry-chat__context-card"><h2>상담 정보</h2><strong>{detail.inquiry.title}</strong>
          <dl><div><dt>문의번호</dt><dd>{inquiryReferenceLabel(detail.inquiry.reference)}</dd></div>
            <div><dt>상담 시작</dt><dd>{formatInquiryDateTime(detail.inquiry.createdAt)}</dd></div>
            <div><dt>첫 응대</dt><dd>{detail.inquiry.answeredAt ? formatInquiryDateTime(detail.inquiry.answeredAt) : '답변 대기'}</dd></div>
            <div><dt>문의 유형</dt><dd>{adminGoodsCopy(INQUIRY_CATEGORY_LABELS[detail.inquiry.category])}</dd></div></dl>
        </section>
        {chatContext ? <InquiryChatTags key={detail.inquiry.id} accountId={accountId} inquiryId={detail.inquiry.id} tags={chatContext.tags} /> : null}
        <details className="admin-inquiry-chat__context-card"><summary>담당자 관리</summary><InquiryAssignmentPanel key={detail.inquiry.id} inquiryId={detail.inquiry.id}
          assigneeId={detail.inquiry.assigneeId} assigneeName={detail.inquiry.assigneeName} staffOptions={detail.staffOptions} /></details>
        {canReadOrders ? <section className="admin-inquiry-chat__context-card"><h2>구매이력</h2>
          {detail.order ? <><p>연결 주문 {orderReferenceLabel(detail.order.id)}</p><p>{detail.order.leadItemName ?? '주문 상품'} · {detail.order.itemCount}개</p>
            <Link href={`/admin/sales/orders/${detail.order.id}`}>주문 상세 보기</Link></> : <p>연결된 주문이 없습니다.</p>}
          <details><summary>전체 구매이력 보기</summary><CustomerHistoryPanel key={detail.buyer.id} userId={detail.buyer.id} canReadClaims={false} /></details>
        </section> : null}
        <section className="admin-inquiry-chat__context-card"><h2>이전 대화이력</h2>
          {chatContext ? <>{chatContext.previous.length ? <ul className="admin-inquiry-chat__previous">{chatContext.previous.map(previous => <li key={previous.id}>
            <Link href={inquiryChatHref(filters, {}, previous.id)} scroll={false}><strong>{previous.title}</strong><span>{CHAT_STATUS_OPTIONS.find(option => option.value === previous.status)?.label} · {formatInquiryDateTime(previous.lastMessageAt)}</span></Link>
          </li>)}</ul> : <p>이전 대화 이력이 없습니다.</p>}
            {chatContext.previousCount > 20 ? <p>최근 20개 대화를 표시합니다. 전체 {chatContext.previousCount}개</p> : null}</> : <p>총 {detail.buyer.inquiryCount}건 · 진행 중 {detail.buyer.openInquiryCount}건</p>}
          {canViewCustomer ? <Link href={`/admin/customers/${detail.buyer.id}?tab=inquiries`}>고객 상세 보기</Link> : null}
        </section>
        <div className="admin-inquiry-chat__notes"><InquiryInternalNotesPanel key={`${accountId}:${detail.inquiry.id}`} accountId={accountId} inquiryId={detail.inquiry.id} notes={detail.notes} /></div>
      </aside> : null}
    </div>
  </section>;
}

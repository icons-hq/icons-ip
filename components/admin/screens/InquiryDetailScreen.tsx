import Link from 'next/link';
import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import {
  ADMIN_INQUIRY_STATUS_LABELS,
  formatInquiryDateTime,
  INQUIRY_CATEGORY_LABELS,
  inquiryReferenceLabel,
  inquirySlaState,
} from '@/lib/inquiries';
import { orderReferenceLabel } from '@/lib/orders';
import { InquiryReplyPanel } from './InquiryReplyPanel';

/* 어드민 문의 상세(#253).
 *
 * 왼쪽이 대화, 오른쪽이 컨텍스트다. 컨텍스트 패널이 이 화면의 존재 이유다 — CS가
 * 주문 콘솔과 회원 화면을 오가며 맥락을 모으는 동안 답변은 늦어지고, 늦은 답변은
 * 같은 질문을 한 번 더 만든다.
 *
 * 클레임은 여기서 처리하지 않는다. 문의는 대화이고 클레임은 절차다 — 취소·반품이
 * 필요하면 주문 콘솔로 넘어가는 링크만 둔다. */

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
  korpay: 'Korpay',
};

function ContextRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ gap: 8, justifyContent: 'space-between' }}>
      <span className="muted" style={{ fontSize: 12 }}>{label}</span>
      <span style={{ fontSize: 13 }}>{value}</span>
    </div>
  );
}

export function InquiryDetailScreen({
  backHref,
  detail,
  now = new Date(),
}: {
  backHref: string;
  detail: AdminInquiryDetail;
  now?: Date;
}) {
  const { buyer, inquiry, messages, order, templates } = detail;
  const sla = inquirySlaState(
    { answeredAt: inquiry.answeredAt, createdAt: inquiry.createdAt, status: inquiry.status },
    now,
  );

  return (
    <section className="admin-console col" style={{ gap: 16 }}>
      <div className="col" style={{ gap: 6 }}>
        <Link className="mono" href={backHref} style={{ fontSize: 12 }}>← 문의 목록</Link>
        <div className="row" style={{ alignItems: 'baseline', gap: 8, justifyContent: 'flex-start' }}>
          <span className="mono">{inquiryReferenceLabel(inquiry.reference)}</span>
          <span className="muted">·</span>
          <span className="muted">{INQUIRY_CATEGORY_LABELS[inquiry.category]}</span>
          <span className="muted">·</span>
          <span>{ADMIN_INQUIRY_STATUS_LABELS[inquiry.status]}</span>
          <span className="muted">·</span>
          <span data-sla-tone={sla.tone}>{sla.label}</span>
        </div>
        <h2 style={{ margin: 0 }}>{inquiry.title}</h2>
        <span className="muted" style={{ fontSize: 12.5 }}>
          @{inquiry.buyerName}
          {inquiry.buyerEmail ? ` · ${inquiry.buyerEmail}` : ''}
          {' · 접수 '}{formatInquiryDateTime(inquiry.createdAt)}
          {inquiry.handlerName ? ` · 처리자 @${inquiry.handlerName}` : ' · 처리자 미배정'}
        </span>
      </div>

      <div className="admin-inquiry-layout">
        <div className="col" style={{ gap: 14 }}>
          <ol className="col admin-inquiry-thread" style={{ gap: 10, listStyle: 'none', margin: 0, padding: 0 }}>
            {messages.map((message) => (
              <li
                className="card col"
                data-author={message.author}
                key={message.id}
                style={{ borderRadius: 12, gap: 8, padding: 14 }}
              >
                <span className="mono muted" style={{ fontSize: 11 }}>
                  {message.author === 'staff' ? 'ICONS 운영자' : `@${inquiry.buyerName}`}
                  {' · '}
                  {formatInquiryDateTime(message.createdAt)}
                </span>
                <p style={{ fontSize: 13.5, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>
                  {message.body}
                </p>
                {message.imageUrls.length ? (
                  <div className="row" style={{ flexWrap: 'wrap', gap: 8, justifyContent: 'flex-start' }}>
                    {message.imageUrls.map((url, index) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        alt={`첨부 이미지 ${index + 1}`}
                        key={url}
                        src={url}
                        style={{ borderRadius: 8, maxHeight: 200, maxWidth: '100%' }}
                      />
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          <InquiryReplyPanel
            category={inquiry.category}
            closed={inquiry.status === 'closed'}
            inquiryId={inquiry.id}
            templates={templates}
          />
        </div>

        <aside aria-label="문의 컨텍스트" className="col" style={{ gap: 12 }}>
          <section className="card col" style={{ borderRadius: 12, gap: 8, padding: 16 }}>
            <strong style={{ fontSize: 13.5 }}>연결 주문</strong>
            {order ? (
              <>
                <ContextRow label="주문번호" value={orderReferenceLabel(order.id)} />
                <ContextRow label="주문상태" value={ORDER_STATUS_LABELS[order.status] ?? order.status} />
                <ContextRow label="주문일시" value={formatInquiryDateTime(order.createdAt)} />
                <ContextRow
                  label="굿즈"
                  value={order.leadItemName
                    ? `${order.leadItemName} · 총 ${order.itemCount}개`
                    : `총 ${order.itemCount}개`}
                />
                <ContextRow label="결제금액" value={`₩${order.total.toLocaleString('ko-KR')}`} />
                <ContextRow
                  label="결제"
                  value={order.payment
                    ? `${PAYMENT_PROVIDER_LABELS[order.payment.provider ?? ''] ?? order.payment.provider ?? '확인 필요'} · ${order.payment.status}`
                    : '결제 내역 없음'}
                />
                <ContextRow
                  label="운송장"
                  value={order.trackingNumber
                    ? `${order.shippingCarrier ?? '택배사 미상'} ${order.trackingNumber}`
                    : '미등록'}
                />
                <div className="col" style={{ gap: 4 }}>
                  <span className="muted" style={{ fontSize: 12 }}>클레임 이력</span>
                  {order.claims.length ? (
                    <ul className="col" style={{ gap: 3, listStyle: 'none', margin: 0, padding: 0 }}>
                      {order.claims.map((claim) => (
                        <li key={`${claim.requestedAt}-${claim.status}`} style={{ fontSize: 12.5 }}>
                          {CLAIM_STATUS_LABELS[claim.status] ?? claim.status}
                          {' · '}
                          {formatInquiryDateTime(claim.requestedAt)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <span style={{ fontSize: 12.5 }}>없음</span>
                  )}
                </div>
                {/* 문의에서 클레임이 필요해지면 여기서 넘어간다. 이 화면은 절차를 만들지 않는다. */}
                <Link
                  className="btn btn-sm btn-ghost"
                  href={`/admin/sales/orders?status=all&page=1&order=${order.id}`}
                >
                  주문 콘솔에서 열기
                </Link>
              </>
            ) : (
              <span className="muted" style={{ fontSize: 12.5 }}>
                연결된 주문이 없습니다. 주문 관련 문의라면 구매자에게 주문번호를 물어보세요.
              </span>
            )}
          </section>

          {inquiry.goodId ? (
            <section className="card col" style={{ borderRadius: 12, gap: 8, padding: 16 }}>
              <strong style={{ fontSize: 13.5 }}>연결 굿즈</strong>
              <ContextRow label="굿즈" value={inquiry.goodName ?? inquiry.goodId} />
              <Link className="btn btn-sm btn-ghost" href={`/shop/${inquiry.goodId}`}>
                굿즈 상세 보기
              </Link>
            </section>
          ) : null}

          <section className="card col" style={{ borderRadius: 12, gap: 8, padding: 16 }}>
            <strong style={{ fontSize: 13.5 }}>구매자</strong>
            <ContextRow label="닉네임" value={`@${inquiry.buyerName}`} />
            <ContextRow label="이메일" value={buyer.email ?? '없음'} />
            <ContextRow label="주문 수" value={`${buyer.orderCount.toLocaleString('ko-KR')}건`} />
            <ContextRow
              label="문의 이력"
              value={`총 ${buyer.inquiryCount}건 · 진행 중 ${buyer.openInquiryCount}건`}
            />
            {buyer.suspendedAt ? (
              <span role="alert" style={{ fontSize: 12.5 }}>
                정지된 계정입니다 ({formatInquiryDateTime(buyer.suspendedAt)}).
              </span>
            ) : null}
            <Link
              className="btn btn-sm btn-ghost"
              href={`/admin/community/members?query=${encodeURIComponent(buyer.email ?? inquiry.buyerName)}`}
            >
              회원 화면에서 열기
            </Link>
          </section>
        </aside>
      </div>
    </section>
  );
}

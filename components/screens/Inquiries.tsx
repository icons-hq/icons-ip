import Link from 'next/link';
import { Icon } from '@/components/ui/Icon';
import {
  formatInquiryDateTime,
  INQUIRY_AUTO_CLOSE_DAYS,
  INQUIRY_STATUS_LABELS,
  inquiryReferenceLabel,
  newInquiryHref,
} from '@/lib/inquiries';
import type { InquiryListItem } from '@/lib/inquiries.server';
import { orderReferenceLabel } from '@/lib/orders';

/* 내 문의 목록(#253).
 *
 * 종결된 문의도 계속 보여준다. 대화가 끝났다는 것과 기록이 사라진다는 것은 다르다 —
 * 같은 답을 다시 물으러 오는 이유의 절반이 "지난 답변을 못 찾아서"다. */

const STATUS_TONE: Record<string, string> = {
  open: 'var(--amber)',
  answered: 'var(--mint)',
  closed: 'var(--line-2)',
};

function StatusBadge({ status }: { status: keyof typeof INQUIRY_STATUS_LABELS }) {
  return (
    <span
      className="mono"
      style={{
        border: `1px solid ${STATUS_TONE[status] ?? 'var(--line-2)'}`,
        borderRadius: 999,
        color: status === 'closed' ? 'var(--dim)' : STATUS_TONE[status],
        fontSize: 11,
        letterSpacing: '.08em',
        padding: '4px 10px',
      }}
    >
      {INQUIRY_STATUS_LABELS[status]}
    </span>
  );
}

export function Inquiries({ inquiries }: { inquiries: InquiryListItem[] }) {
  return (
    <main className="screen">
      <header className="my-header">
        <div className="wrap">
          <Link className="mono" href="/my" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 마이
          </Link>
          <div className="eyebrow rise" style={{ marginTop: 14 }}>SUPPORT</div>
          <h1 className="h-xl rise">1:1 문의</h1>
          <p className="rise">
            운영자에게 직접 보내는 비공개 문의입니다. 영업일 기준 24시간 안에 첫 답변을 드립니다.
          </p>
        </div>
      </header>

      <section className="my-content" aria-labelledby="inquiry-list-heading">
        <div className="wrap">
          <div className="my-section-heading">
            <div>
              <span aria-hidden className="mono">MY INQUIRIES</span>
              <h2 id="inquiry-list-heading">보낸 문의</h2>
            </div>
            <Link className="btn" href={newInquiryHref()}>새 문의하기</Link>
          </div>

          {inquiries.length === 0 ? (
            <div className="card col" role="status" style={{ borderRadius: 14, gap: 8, padding: 24 }}>
              <strong>아직 보낸 문의가 없습니다.</strong>
              <span className="muted" style={{ fontSize: 13.5 }}>
                주문·배송, 취소/반품/교환, 상품, 계정에 대해 궁금한 점을 보내주세요.
              </span>
            </div>
          ) : (
            <ul className="col" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
              {inquiries.map((inquiry) => (
                <li key={inquiry.id}>
                  <Link
                    className="card col"
                    href={`/my/inquiries/${inquiry.id}`}
                    style={{ borderRadius: 14, gap: 8, padding: 18, textDecoration: 'none' }}
                  >
                    <div className="row" style={{ alignItems: 'center', gap: 8, justifyContent: 'flex-start' }}>
                      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '.1em' }}>
                        {inquiryReferenceLabel(inquiry.reference)}
                      </span>
                      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>·</span>
                      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
                        {inquiry.categoryLabel}
                      </span>
                      <span style={{ marginLeft: 'auto' }}>
                        <StatusBadge status={inquiry.status} />
                      </span>
                    </div>
                    <strong style={{ fontSize: 15.5 }}>{inquiry.title}</strong>
                    <div className="row" style={{ color: 'var(--dim)', fontSize: 12.5, gap: 8, justifyContent: 'flex-start' }}>
                      <time dateTime={inquiry.lastMessageAt}>
                        최근 {formatInquiryDateTime(inquiry.lastMessageAt)}
                      </time>
                      {inquiry.orderId ? (
                        <>
                          <span aria-hidden>·</span>
                          <span className="mono">주문 {orderReferenceLabel(inquiry.orderId)}</span>
                        </>
                      ) : null}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <p className="faint" style={{ fontSize: 12.5, marginTop: 18 }}>
            <Icon name="bell" size={14} style={{ verticalAlign: 'middle' }} /> 답변이 등록되면 알림과 메일로
            알려드립니다. 답변 후 {INQUIRY_AUTO_CLOSE_DAYS}일 동안 추가 질문이 없으면 문의는 자동으로
            종결되고, 종결된 문의도 계속 열람할 수 있습니다.
          </p>
        </div>
      </section>
    </main>
  );
}

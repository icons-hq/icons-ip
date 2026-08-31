import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
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
  open: '',
  answered: ' wc-receipt__state--positive',
  closed: ' wc-receipt__state--muted',
};

function StatusBadge({ status }: { status: keyof typeof INQUIRY_STATUS_LABELS }) {
  return (
    <span className={`wc-receipt__state${STATUS_TONE[status] ?? ''}`}>
      {INQUIRY_STATUS_LABELS[status]}
    </span>
  );
}

export function Inquiries({ inquiries }: { inquiries: InquiryListItem[] }) {
  return (
    <MypageShell active="/my/inquiries">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">1:1 문의</h1>
        <Link className="wc-mypage__headbar-link" href={newInquiryHref()}>새 문의하기</Link>
      </div>
      <p className="wc-mypage__lede">
        운영자에게 직접 보내는 비공개 문의입니다. 영업일 기준 24시간 안에 첫 답변을 드립니다.
      </p>

      <section aria-labelledby="inquiry-list-heading">
        <div className="wc-mypage__subhead">
          <h2 id="inquiry-list-heading">보낸 문의</h2>
          <span>{inquiries.length}건</span>
        </div>

        {inquiries.length === 0 ? (
          <div className="wc-empty" role="status">
            <h2 className="wc-empty__title">아직 보낸 문의가 없습니다.</h2>
            <p className="wc-empty__desc">
              주문·배송, 취소/반품/교환, 상품, 계정에 대해 궁금한 점을 보내주세요.
            </p>
          </div>
        ) : (
          <ul className="wc-mypage__cards">
            {inquiries.map((inquiry) => (
              <li key={inquiry.id}>
                <Link className="wc-mypage__card" href={`/my/inquiries/${inquiry.id}`}>
                  <span className="wc-mypage__card-meta">
                    <span>{inquiryReferenceLabel(inquiry.reference)}</span>
                    <span aria-hidden>·</span>
                    <span>{inquiry.categoryLabel}</span>
                    <span className="wc-mypage__card-state">
                      <StatusBadge status={inquiry.status} />
                    </span>
                  </span>
                  <strong className="wc-mypage__card-title">{inquiry.title}</strong>
                  <span className="wc-mypage__card-meta">
                    <time dateTime={inquiry.lastMessageAt}>
                      최근 {formatInquiryDateTime(inquiry.lastMessageAt)}
                    </time>
                    {inquiry.orderId ? (
                      <>
                        <span aria-hidden>·</span>
                        <span>주문 {orderReferenceLabel(inquiry.orderId)}</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <p className="wc-mypage__note">
          답변이 등록되면 알림과 메일로 알려드립니다. 답변 후 {INQUIRY_AUTO_CLOSE_DAYS}일 동안 추가
          질문이 없으면 문의는 자동으로 종결되고, 종결된 문의도 계속 열람할 수 있습니다.
        </p>
      </section>
    </MypageShell>
  );
}

'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { replyToInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import {
  formatInquiryDateTime,
  INQUIRY_AUTO_CLOSE_DAYS,
  INQUIRY_IMAGE_ACCEPT,
  INQUIRY_STATUS_LABELS,
  inquiryReferenceLabel,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  newInquiryHref,
} from '@/lib/inquiries';
import type { InquiryThreadView } from '@/lib/inquiries.server';
import { orderReferenceLabel } from '@/lib/orders';

/* 문의 스레드(#253).
 *
 * 종결된 문의는 읽기 전용이다. 답변 입력창을 남겨 두면 사용자가 보냈다고 믿는 글이
 * 어디에도 도착하지 않는다 — 대신 새 문의로 가는 길을 그 자리에 놓는다. */

const EMPTY_STATE: InquiryActionState = {};

const bubbleBase: React.CSSProperties = {
  borderRadius: 14,
  display: 'grid',
  gap: 8,
  padding: '14px 16px',
};

function MessageBubble({
  message,
}: {
  message: InquiryThreadView['messages'][number];
}) {
  const isStaff = message.author === 'staff';
  return (
    <li
      style={{
        ...bubbleBase,
        background: isStaff ? 'rgba(139,92,255,.10)' : 'rgba(21,17,42,.7)',
        border: `1px solid ${isStaff ? 'var(--violet, var(--line-2))' : 'var(--line-2)'}`,
        justifySelf: isStaff ? 'start' : 'end',
        maxWidth: 'min(560px, 100%)',
      }}
    >
      <span className="mono" style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '.08em' }}>
        {isStaff ? 'ICONS 운영자' : '내 문의'} · {formatInquiryDateTime(message.createdAt)}
      </span>
      <p style={{ fontSize: 14.5, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>
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
              style={{ borderRadius: 10, maxHeight: 220, maxWidth: '100%' }}
            />
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function InquiryThread({ inquiry }: { inquiry: InquiryThreadView }) {
  const [state, action, pending] = useActionState(replyToInquiryAction, EMPTY_STATE);
  const closed = inquiry.status === 'closed';

  return (
    <main className="screen">
      <header className="my-header">
        <div className="wrap">
          <Link className="mono" href="/my/inquiries" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 1:1 문의
          </Link>
          <div className="eyebrow rise" style={{ marginTop: 14 }}>
            {inquiryReferenceLabel(inquiry.reference)} · {inquiry.categoryLabel}
          </div>
          <h1 className="h-xl rise">{inquiry.title}</h1>
          <p className="rise">
            {INQUIRY_STATUS_LABELS[inquiry.status]} · 접수 {formatInquiryDateTime(inquiry.createdAt)}
            {inquiry.orderId ? ` · 주문 ${orderReferenceLabel(inquiry.orderId)}` : ''}
          </p>
        </div>
      </header>

      <section className="my-content" aria-labelledby="inquiry-thread-heading">
        <div className="wrap">
          <h2 className="sr-only" id="inquiry-thread-heading">문의 대화</h2>
          <ul className="col" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
            {inquiry.messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </ul>

          {closed ? (
            <div className="card col" role="status" style={{ borderRadius: 14, gap: 8, marginTop: 18, padding: 20 }}>
              <strong>종결된 문의입니다.</strong>
              <span className="muted" style={{ fontSize: 13.5 }}>
                답변 후 {INQUIRY_AUTO_CLOSE_DAYS}일 동안 추가 질문이 없어 자동으로 종결됐거나 운영자가
                종결한 문의입니다. 기록은 계속 열람할 수 있고, 더 궁금한 점은 새 문의로 접수해주세요.
              </span>
              <Link className="btn" href={newInquiryHref({ category: inquiry.category, orderId: inquiry.orderId, goodId: inquiry.goodId })}>
                새 문의하기
              </Link>
            </div>
          ) : (
            /* 등록에 성공하면 key가 바뀌어 입력창과 파일 선택이 초기화된다.
               남겨 두면 같은 질문을 한 번 더 보내게 된다. */
            <form
              action={action}
              className="card col"
              key={state.resultKey ?? 'draft'}
              style={{ borderRadius: 14, gap: 12, marginTop: 18, padding: 20 }}
            >
              <input name="inquiryId" type="hidden" value={inquiry.id} />
              <label className="col" style={{ gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>추가 문의</span>
                <textarea
                  maxLength={MAX_INQUIRY_BODY_LENGTH}
                  name="body"
                  placeholder="답변을 확인한 뒤 더 궁금한 점을 이어서 물어보세요."
                  rows={5}
                  style={{
                    background: 'rgba(21,17,42,.7)',
                    border: '1px solid var(--line-2)',
                    borderRadius: 14,
                    color: 'var(--text)',
                    fontFamily: 'inherit',
                    fontSize: 14.5,
                    lineHeight: 1.7,
                    padding: '13px 16px',
                    resize: 'vertical',
                    width: '100%',
                  }}
                />
              </label>
              {state.errors?.body ? (
                <span role="alert" style={{ color: 'var(--pink)', fontSize: 12.5 }}>{state.errors.body}</span>
              ) : null}

              <label className="col" style={{ gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                  이미지 첨부 <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>선택 · 최대 {MAX_INQUIRY_IMAGES}장</span>
                </span>
                <input accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
              </label>
              {state.errors?.images ? (
                <span role="alert" style={{ color: 'var(--pink)', fontSize: 12.5 }}>{state.errors.images}</span>
              ) : null}
              {state.errors?.form ? (
                <span role="alert" style={{ color: 'var(--pink)', fontSize: 12.5 }}>{state.errors.form}</span>
              ) : null}
              {state.message ? (
                <span className="muted" role="status" style={{ fontSize: 12.5 }}>{state.message}</span>
              ) : null}

              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn" disabled={pending} type="submit">
                  {pending ? '등록 중' : '추가 문의 보내기'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { replyToInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import { MypageShell } from '@/components/wc/MypageShell';
import { WcButton } from '@/components/wc/WcButton';
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

function MessageBubble({
  message,
}: {
  message: InquiryThreadView['messages'][number];
}) {
  const isStaff = message.author === 'staff';
  return (
    <li className={`wc-thread__bubble${isStaff ? ' wc-thread__bubble--staff' : ''}`}>
      <span className="wc-thread__meta">
        {isStaff ? 'ICONS 운영자' : '내 문의'} · {formatInquiryDateTime(message.createdAt)}
      </span>
      <p className="wc-thread__body">
        {message.body}
      </p>
      {message.imageUrls.length ? (
        <div className="wc-thread__images">
          {message.imageUrls.map((url, index) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              alt={`첨부 이미지 ${index + 1}`}
              key={url}
              src={url}
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
    <MypageShell active="/my/inquiries">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">{inquiry.title}</h1>
        <Link className="wc-mypage__headbar-link" href="/my/inquiries">1:1 문의</Link>
      </div>
      <p className="wc-mypage__lede">
        {inquiryReferenceLabel(inquiry.reference)} · {inquiry.categoryLabel} · {INQUIRY_STATUS_LABELS[inquiry.status]} · 접수 {formatInquiryDateTime(inquiry.createdAt)}
        {inquiry.orderId ? ` · 주문 ${orderReferenceLabel(inquiry.orderId)}` : ''}
      </p>

      <section aria-labelledby="inquiry-thread-heading">
        <h2 className="sr-only" id="inquiry-thread-heading">문의 대화</h2>
        <ul className="wc-thread__list">
          {inquiry.messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
        </ul>

        {closed ? (
          <div className="wc-mypage__notice" role="status">
            <strong>종결된 문의입니다.</strong>
            <span>
              답변 후 {INQUIRY_AUTO_CLOSE_DAYS}일 동안 추가 질문이 없어 자동으로 종결됐거나 운영자가
              종결한 문의입니다. 기록은 계속 열람할 수 있고, 더 궁금한 점은 새 문의로 접수해주세요.
            </span>
            <WcButton href={newInquiryHref({ category: inquiry.category, orderId: inquiry.orderId, goodId: inquiry.goodId })}>
              새 문의하기
            </WcButton>
          </div>
        ) : (
          /* 등록에 성공하면 key가 바뀌어 입력창과 파일 선택이 초기화된다.
             남겨 두면 같은 질문을 한 번 더 보내게 된다. */
          <form
            action={action}
            className="wc-mypage__form"
            key={state.resultKey ?? 'draft'}
          >
            <input name="inquiryId" type="hidden" value={inquiry.id} />
            <label className="wc-mypage__field">
              추가 문의
              <textarea
                maxLength={MAX_INQUIRY_BODY_LENGTH}
                name="body"
                placeholder="답변을 확인한 뒤 더 궁금한 점을 이어서 물어보세요."
                rows={5}
              />
            </label>
            {state.errors?.body ? (
              <span className="wc-auth__error" role="alert">{state.errors.body}</span>
            ) : null}

            <label className="wc-mypage__field">
              <span className="wc-mypage__field-title">
                이미지 첨부 <small>선택 · 최대 {MAX_INQUIRY_IMAGES}장</small>
              </span>
              <input accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
            </label>
            {state.errors?.images ? (
              <span className="wc-auth__error" role="alert">{state.errors.images}</span>
            ) : null}
            {state.errors?.form ? (
              <span className="wc-auth__error" role="alert">{state.errors.form}</span>
            ) : null}
            {state.message ? (
              <span className="wc-mypage__hint" role="status">{state.message}</span>
            ) : null}

            <div className="wc-mypage__form-actions">
              <WcButton disabled={pending} type="submit" variant="primary">
                {pending ? '등록 중' : '추가 문의 보내기'}
              </WcButton>
            </div>
          </form>
        )}
      </section>
    </MypageShell>
  );
}

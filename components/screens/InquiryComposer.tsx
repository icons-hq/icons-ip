'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import {
  INQUIRY_CATEGORIES,
  INQUIRY_IMAGE_ACCEPT,
  MAX_INQUIRY_BODY_LENGTH,
  MAX_INQUIRY_IMAGES,
  MAX_INQUIRY_TITLE_LENGTH,
  type InquiryCategory,
} from '@/lib/inquiries';

/* 문의 접수 폼(#253).
 *
 * 진입점(주문 상세·굿즈 상세)이 연결 대상을 실어 보내면 그 값을 미리 채우고, 해제할 수
 * 있게 둔다. 해제 자체가 필요한 이유는 "이 주문에서 출발했지만 묻고 싶은 건 다른 것"이
 * 흔하기 때문이다 — 연결을 강제하면 운영자가 엉뚱한 컨텍스트를 보고 답한다. */

const EMPTY_STATE: InquiryActionState = {};

const fieldStyle: React.CSSProperties = {
  background: 'rgba(21,17,42,.7)',
  border: '1px solid var(--line-2)',
  borderRadius: 14,
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 14.5,
  padding: '13px 16px',
  width: '100%',
};

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <span role="alert" style={{ color: 'var(--pink)', fontSize: 12.5 }}>{children}</span>
  );
}

export interface InquiryComposerLink {
  orderId: string | null;
  orderLabel: string | null;
  goodId: string | null;
  goodName: string | null;
}

export function InquiryComposer({
  defaultCategory,
  link,
}: {
  defaultCategory: InquiryCategory;
  link: InquiryComposerLink;
}) {
  const [state, action, pending] = useActionState(createInquiryAction, EMPTY_STATE);
  const [keepOrder, setKeepOrder] = useState(Boolean(link.orderId));
  const [keepGood, setKeepGood] = useState(Boolean(link.goodId));

  return (
    <main className="screen">
      <header className="my-header">
        <div className="wrap">
          <Link className="mono" href="/my/inquiries" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 1:1 문의
          </Link>
          <div className="eyebrow rise" style={{ marginTop: 14 }}>NEW INQUIRY</div>
          <h1 className="h-xl rise">문의하기</h1>
          <p className="rise">영업일 기준 24시간 안에 첫 답변을 드립니다.</p>
        </div>
      </header>

      <section className="my-content">
        <div className="wrap">
          <form action={action} className="card col" style={{ borderRadius: 16, gap: 16, padding: 22 }}>
            {keepOrder && link.orderId ? (
              <input name="orderId" type="hidden" value={link.orderId} />
            ) : null}
            {keepGood && link.goodId ? (
              <input name="goodId" type="hidden" value={link.goodId} />
            ) : null}

            <label className="col" style={{ gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>문의 유형</span>
              <select defaultValue={defaultCategory} name="category" style={fieldStyle}>
                {INQUIRY_CATEGORIES.map((category) => (
                  <option key={category.id} value={category.id}>{category.label}</option>
                ))}
              </select>
              <FieldError>{state.errors?.category}</FieldError>
            </label>

            <label className="col" style={{ gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>제목</span>
              <input
                maxLength={MAX_INQUIRY_TITLE_LENGTH}
                name="title"
                placeholder="무엇을 도와드릴까요?"
                style={fieldStyle}
                type="text"
              />
              <FieldError>{state.errors?.title}</FieldError>
            </label>

            <label className="col" style={{ gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>문의 내용</span>
              <textarea
                maxLength={MAX_INQUIRY_BODY_LENGTH}
                name="body"
                placeholder="상황을 자세히 적어주시면 더 빠르게 도와드릴 수 있습니다."
                rows={8}
                style={{ ...fieldStyle, lineHeight: 1.7, resize: 'vertical' }}
              />
              <FieldError>{state.errors?.body}</FieldError>
            </label>

            {link.orderId || link.goodId ? (
              <div className="col" style={{ gap: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>연결된 정보</span>
                {link.orderId ? (
                  <label className="row" style={{ alignItems: 'center', gap: 9, justifyContent: 'flex-start' }}>
                    <input
                      checked={keepOrder}
                      onChange={(event) => setKeepOrder(event.target.checked)}
                      type="checkbox"
                    />
                    <span style={{ color: 'var(--dim)', fontSize: 13.5 }}>
                      주문 <span className="mono">{link.orderLabel}</span> 정보를 함께 전달
                    </span>
                  </label>
                ) : null}
                {link.goodId ? (
                  <label className="row" style={{ alignItems: 'center', gap: 9, justifyContent: 'flex-start' }}>
                    <input
                      checked={keepGood}
                      onChange={(event) => setKeepGood(event.target.checked)}
                      type="checkbox"
                    />
                    <span style={{ color: 'var(--dim)', fontSize: 13.5 }}>
                      굿즈 <strong>{link.goodName ?? link.goodId}</strong> 정보를 함께 전달
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}

            <label className="col" style={{ gap: 7 }}>
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>
                이미지 첨부 <span className="mono" style={{ color: 'var(--faint)', fontSize: 11 }}>선택 · 최대 {MAX_INQUIRY_IMAGES}장</span>
              </span>
              <input accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
              <FieldError>{state.errors?.images}</FieldError>
            </label>

            <FieldError>{state.errors?.form}</FieldError>

            <div className="row" style={{ gap: 10, justifyContent: 'flex-end' }}>
              <Link className="btn btn-ghost" href="/my/inquiries">취소</Link>
              <button className="btn" disabled={pending} type="submit">
                {pending ? '접수 중' : '문의 접수'}
              </button>
            </div>
          </form>

          <p className="faint" style={{ fontSize: 12.5, marginTop: 16 }}>
            취소·반품·교환을 실제로 접수하려면 주문 상세의 청약철회 경로를 이용해주세요.
            이 화면은 질문과 답변을 주고받는 곳이라 접수 자체를 대신하지 않습니다.
          </p>
        </div>
      </section>
    </main>
  );
}

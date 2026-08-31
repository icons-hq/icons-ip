'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { createInquiryAction, type InquiryActionState } from '@/app/my/inquiries/actions';
import { MypageShell } from '@/components/wc/MypageShell';
import { WcButton } from '@/components/wc/WcButton';
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

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return (
    <span className="wc-auth__error" role="alert">{children}</span>
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
    <MypageShell active="/my/inquiries">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">문의하기</h1>
        <Link className="wc-mypage__headbar-link" href="/my/inquiries">1:1 문의</Link>
      </div>
      <p className="wc-mypage__lede">영업일 기준 24시간 안에 첫 답변을 드립니다.</p>

      <form action={action} className="wc-mypage__form">
        {keepOrder && link.orderId ? (
          <input name="orderId" type="hidden" value={link.orderId} />
        ) : null}
        {keepGood && link.goodId ? (
          <input name="goodId" type="hidden" value={link.goodId} />
        ) : null}

        <label className="wc-mypage__field">
          문의 유형
          <select defaultValue={defaultCategory} name="category">
            {INQUIRY_CATEGORIES.map((category) => (
              <option key={category.id} value={category.id}>{category.label}</option>
            ))}
          </select>
          <FieldError>{state.errors?.category}</FieldError>
        </label>

        <label className="wc-mypage__field">
          제목
          <input
            maxLength={MAX_INQUIRY_TITLE_LENGTH}
            name="title"
            placeholder="무엇을 도와드릴까요?"
            type="text"
          />
          <FieldError>{state.errors?.title}</FieldError>
        </label>

        <label className="wc-mypage__field">
          문의 내용
          <textarea
            maxLength={MAX_INQUIRY_BODY_LENGTH}
            name="body"
            placeholder="상황을 자세히 적어주시면 더 빠르게 도와드릴 수 있습니다."
            rows={8}
          />
          <FieldError>{state.errors?.body}</FieldError>
        </label>

        {link.orderId || link.goodId ? (
          <div className="wc-mypage__field">
            <span className="wc-mypage__field-title">연결된 정보</span>
            {link.orderId ? (
              <label className="wc-mypage__check">
                <input
                  checked={keepOrder}
                  onChange={(event) => setKeepOrder(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  주문 <strong>{link.orderLabel}</strong> 정보를 함께 전달
                </span>
              </label>
            ) : null}
            {link.goodId ? (
              <label className="wc-mypage__check">
                <input
                  checked={keepGood}
                  onChange={(event) => setKeepGood(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  굿즈 <strong>{link.goodName ?? link.goodId}</strong> 정보를 함께 전달
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        <label className="wc-mypage__field">
          <span className="wc-mypage__field-title">
            이미지 첨부 <small>선택 · 최대 {MAX_INQUIRY_IMAGES}장</small>
          </span>
          <input accept={INQUIRY_IMAGE_ACCEPT} multiple name="images" type="file" />
          <FieldError>{state.errors?.images}</FieldError>
        </label>

        <FieldError>{state.errors?.form}</FieldError>

        <div className="wc-mypage__form-actions">
          <WcButton href="/my/inquiries">취소</WcButton>
          <WcButton disabled={pending} type="submit" variant="primary">
            {pending ? '접수 중' : '문의 접수'}
          </WcButton>
        </div>
      </form>

      <p className="wc-mypage__note">
        취소·반품·교환을 실제로 접수하려면 주문 상세의 청약철회 경로를 이용해주세요.
        이 화면은 질문과 답변을 주고받는 곳이라 접수 자체를 대신하지 않습니다.
      </p>
    </MypageShell>
  );
}

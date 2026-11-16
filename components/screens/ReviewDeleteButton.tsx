'use client';

import { deleteReviewAction } from '@/app/my/reviews/actions';
import { customerConfirm } from '@/lib/customer-confirm';

/*
 * 리뷰 삭제 버튼(#254).
 *
 * 삭제는 되돌릴 수 없다 — 운영자 블라인드와 달리 행 자체가 사라지고 평점 평균에서도
 * 즉시 빠진다. 그래서 확인창이 붙는다. 서버 컴포넌트는 onSubmit을 가질 수
 * 없어 이 버튼만 클라이언트다.
 *
 * 확인은 고객 공용 확인창(lib/customer-confirm.ts)으로 묻는다. 확인창은 비동기라 제출을 먼저 멈추고,
 * 고객이 [리뷰 삭제]를 누르면 같은 제출 버튼으로 폼을 다시 제출해 서버 액션을 그대로 잇는다.
 */

/** 확인을 마치고 다시 제출하는 폼. requestSubmit은 submit 이벤트를 동기로 보내므로 그 한 번만 통과시킨다. */
const confirmedForms = new WeakSet<HTMLFormElement>();

export function ReviewDeleteButton({
  goodId,
  reviewId,
}: {
  goodId: string;
  reviewId: string;
}) {
  return (
    <form
      action={deleteReviewAction}
      onSubmit={(event) => {
        const form = event.currentTarget;
        if (confirmedForms.has(form)) return;
        event.preventDefault();
        const submitter = (event.nativeEvent as SubmitEvent).submitter;
        void customerConfirm({
          title: '이 리뷰를 삭제할까요?',
          message: '삭제한 리뷰와 사진은 복구할 수 없고, 같은 주문에 다시 쓸 수 있어요.',
          confirmLabel: '리뷰 삭제',
        }).then((accepted) => {
          if (!accepted || !form.isConnected) return;
          confirmedForms.add(form);
          try { form.requestSubmit(submitter); } finally { confirmedForms.delete(form); }
        });
      }}
    >
      <input name="reviewId" type="hidden" value={reviewId} />
      <input name="goodId" type="hidden" value={goodId} />
      <button className="wc-mypage__headbar-link wc-mypage__link-danger" type="submit">삭제</button>
    </form>
  );
}

'use client';

import { deleteReviewAction } from '@/app/my/reviews/actions';

/*
 * 리뷰 삭제 버튼(#254).
 *
 * 삭제는 되돌릴 수 없다 — 운영자 블라인드와 달리 행 자체가 사라지고 평점 평균에서도
 * 즉시 빠진다. 그래서 확인 대화상자가 붙는다. 서버 컴포넌트는 onSubmit을 가질 수
 * 없어 이 버튼만 클라이언트다(저장소의 confirmAction 관용구와 같은 형태).
 */
const CONFIRMATION = '이 리뷰를 삭제할까요? 삭제한 리뷰와 사진은 복구할 수 없고, 같은 주문에 다시 쓸 수 있습니다.';

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
        if (!window.confirm(CONFIRMATION)) event.preventDefault();
      }}
    >
      <input name="reviewId" type="hidden" value={reviewId} />
      <input name="goodId" type="hidden" value={goodId} />
      <button className="wc-mypage__headbar-link wc-mypage__link-danger" type="submit">삭제</button>
    </form>
  );
}

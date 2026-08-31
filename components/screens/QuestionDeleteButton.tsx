'use client';

import { useActionState } from 'react';
import {
  deleteMyProductQuestionAction,
  type MyQuestionActionState,
} from '@/app/my/questions/actions';

/*
 * 내 상품 Q&A 삭제 버튼(#330).
 *
 * 운영자 블라인드와 다른 경로다 — 저쪽은 원문을 남기고 상태만 바꾸고, 이쪽은 행이
 * 사라진다. 답변이 달린 질문도 지울 수 있다(본인 콘텐츠 회수권). 답변은 같은 행의
 * 컬럼이라 함께 사라지므로, 그 사실을 버튼 옆에 적는다.
 *
 * 확인 대화상자를 쓰지 않는다. 되돌릴 수 없다는 사실은 누른 뒤가 아니라 누르기 전에
 * 화면에 있어야 하고, 대화상자는 스크린리더·모바일에서 그 문장을 늦게 전달한다.
 *
 * 어휘 규율: 공개 Q&A를 비공개 1:1 '문의'라고 부르지 않는다(CONTEXT.md).
 */

const EMPTY_STATE: MyQuestionActionState = {};

export function QuestionDeleteButton({
  goodName,
  questionId,
}: {
  goodName: string;
  questionId: string;
}) {
  const [state, formAction, pending] = useActionState(deleteMyProductQuestionAction, EMPTY_STATE);

  return (
    <form action={formAction}>
      <input name="questionId" type="hidden" value={questionId} />
      <div className="wc-mypage__card-actions">
        <button
          aria-label={`${goodName}에 남긴 질문 삭제`}
          className="wc-mypage__headbar-link wc-mypage__link-danger"
          disabled={pending}
          type="submit"
        >
          {pending ? '삭제 중' : '삭제'}
        </button>
        <span className="wc-mypage__hint">삭제하면 굿즈 상세에서도 사라져요.</span>
      </div>
      <p aria-live="polite" className="wc-mypage__hint" role="status">
        {state.message ?? ''}
      </p>
    </form>
  );
}

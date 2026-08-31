'use client';

import { useActionState, useState } from 'react';
import {
  answerProductQuestionAction,
  setProductQuestionVisibilityAction,
  type AdminQnaActionState,
} from '@/app/admin/qna-actions';
import type { AdminProductQuestionRow } from '@/lib/admin/product-questions';

/* 상품 Q&A 한 건의 처리 패널 (S8 #330).
 *
 * [답변]과 [비노출]은 다른 폼이다. 하나의 폼에 두 버튼을 두면 브라우저 기본 제출
 * (엔터)이 어느 쪽으로 갈지 마크업 순서에 좌우된다 — 답변을 쓰다 엔터를 눌러 질문이
 * 내려가는 사고를 마크업 순서에 맡길 수 없다(리뷰 콘솔과 같은 규율).
 *
 * 접힌 채로 시작한다. 목록의 존재 이유는 "지금 손댈 것"을 고르는 것이고, 20건 전부의
 * 입력창이 펼쳐져 있으면 고를 수가 없다.
 *
 * 재답변은 허용한다. 답변 내용이 바뀌었는데 조용하면 구매자는 이전 답변을 그대로
 * 믿으므로, DB가 재답변마다 알림을 다시 띄운다 — 버튼 문구로 그 사실을 알린다. */

const EMPTY_STATE: AdminQnaActionState = {};

const ANSWER_MAX_LENGTH = 2000;

const HIDE_CONFIRMATION =
  '이 질문을 비노출 처리할까요? 굿즈 상세에서 즉시 빠지고 작성자에게는 계속 보입니다.';
const SHOW_CONFIRMATION = '이 질문을 다시 공개할까요? 굿즈 상세 목록에 즉시 다시 나옵니다.';

function Feedback({ state }: { state: AdminQnaActionState }) {
  return (
    <div aria-live="polite" className="admin-order-action-feedback">
      {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
      {state.errors?.answer ? <span role="alert">{state.errors.answer}</span> : null}
      {state.message ? <span role="status">{state.message}</span> : null}
    </div>
  );
}

export function QnaActionPanel({ question }: { question: AdminProductQuestionRow }) {
  const [answerState, answerAction, answerPending] = useActionState(
    answerProductQuestionAction,
    EMPTY_STATE,
  );
  const [visibilityState, visibilityAction, visibilityPending] = useActionState(
    setProductQuestionVisibilityAction,
    EMPTY_STATE,
  );
  const [open, setOpen] = useState(false);

  const answered = Boolean(question.answerBody);

  return (
    <details
      className="admin-qna-actions"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      open={open}
    >
      <summary className="btn btn-sm btn-ghost" style={{ minHeight: 44 }}>
        {answered ? '답변 수정' : '답변 등록'}
      </summary>

      <div className="col" style={{ gap: 12, marginTop: 10 }}>
        <form action={answerAction} className="col" style={{ gap: 6 }}>
          <input name="questionId" type="hidden" value={question.id} />
          <label className="admin-console-filter-label" htmlFor={`qna-answer-${question.id}`}>
            운영자 답변 (굿즈 상세에 공개)
          </label>
          <textarea
            defaultValue={question.answerBody ?? ''}
            id={`qna-answer-${question.id}`}
            key={answerState.resultKey ?? 'answer'}
            maxLength={ANSWER_MAX_LENGTH}
            name="answer"
            rows={4}
          />
          <div className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <button className="btn btn-sm" disabled={answerPending} type="submit">
              {answerPending ? '저장 중' : answered ? '답변 수정 (알림 재발송)' : '답변 등록'}
            </button>
          </div>
          <Feedback state={answerState} />
        </form>

        <form
          action={visibilityAction}
          className="col"
          onSubmit={(event) => {
            const message = question.hidden ? SHOW_CONFIRMATION : HIDE_CONFIRMATION;
            if (!window.confirm(message)) event.preventDefault();
          }}
          style={{ gap: 6 }}
        >
          <input name="questionId" type="hidden" value={question.id} />
          <input name="hidden" type="hidden" value={question.hidden ? 'false' : 'true'} />
          <button className="btn btn-sm btn-ghost" disabled={visibilityPending} type="submit">
            {visibilityPending ? '처리 중' : question.hidden ? '비노출 해제' : '비노출'}
          </button>
          <Feedback state={visibilityState} />
        </form>
      </div>
    </details>
  );
}

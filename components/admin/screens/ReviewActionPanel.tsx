'use client';

import { useActionState, useState } from 'react';
import {
  replyToReviewAction,
  setReviewStatusAction,
  type AdminReviewActionState,
} from '@/app/admin/review-actions';
import type { AdminReviewRow } from '@/lib/admin/reviews';

/* 리뷰 한 건의 처리 패널(#254).
 *
 * [답글]과 [블라인드]는 다른 폼이다. 하나의 폼에 두 버튼을 두면 브라우저 기본 제출
 * (엔터)이 어느 쪽으로 갈지 마크업 순서에 좌우된다 — 답글을 쓰다 엔터를 눌러 리뷰가
 * 내려가는 사고를 마크업 순서에 맡길 수 없다.
 *
 * 접힌 채로 시작한다. 목록의 존재 이유는 "지금 손댈 것"을 고르는 것이고, 20건 전부의
 * 입력창이 펼쳐져 있으면 고를 수가 없다. */

const EMPTY_STATE: AdminReviewActionState = {};

const UNHIDE_CONFIRMATION = '이 리뷰를 다시 공개할까요? 공개 즉시 평점 평균과 목록에 다시 반영됩니다.';

function Feedback({ state }: { state: AdminReviewActionState }) {
  return (
    <div aria-live="polite" className="admin-order-action-feedback">
      {state.errors?.form ? <span role="alert">{state.errors.form}</span> : null}
      {state.errors?.reply ? <span role="alert">{state.errors.reply}</span> : null}
      {state.errors?.reason ? <span role="alert">{state.errors.reason}</span> : null}
      {state.message ? <span role="status">{state.message}</span> : null}
    </div>
  );
}

export function ReviewActionPanel({ review }: { review: AdminReviewRow }) {
  const [replyState, replyAction, replyPending] = useActionState(replyToReviewAction, EMPTY_STATE);
  const [statusState, statusAction, statusPending] = useActionState(
    setReviewStatusAction,
    EMPTY_STATE,
  );
  const [open, setOpen] = useState(false);

  const hidden = review.status === 'hidden';
  const hideConfirmation =
    `${review.rating}점 리뷰를 블라인드할까요? 공개 목록과 평점 평균에서 즉시 빠지고 사유가 감사 로그에 남습니다.`;

  return (
    <details
      className="admin-review-actions"
      onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}
      open={open}
    >
      <summary className="btn btn-sm btn-ghost" style={{ minHeight: 44 }}>
        {hidden ? '블라인드 관리' : review.adminReply ? '답글 수정' : '답글·블라인드'}
      </summary>

      <div className="col" style={{ gap: 12, marginTop: 10 }}>
        <form action={replyAction} className="col" style={{ gap: 6 }}>
          <input name="reviewId" type="hidden" value={review.id} />
          <label className="admin-console-filter-label" htmlFor={`review-reply-${review.id}`}>
            운영자 답글 (공개 표시)
          </label>
          <textarea
            defaultValue={review.adminReply ?? ''}
            id={`review-reply-${review.id}`}
            key={replyState.resultKey ?? 'reply'}
            maxLength={1000}
            name="reply"
            rows={3}
          />
          <div className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <button className="btn btn-sm" disabled={replyPending} type="submit">
              {replyPending ? '저장 중' : review.adminReply ? '답글 수정' : '답글 등록'}
            </button>
          </div>
          <Feedback state={replyState} />
        </form>

        {hidden ? (
          <form
            action={statusAction}
            className="col"
            onSubmit={(event) => {
              if (!window.confirm(UNHIDE_CONFIRMATION)) event.preventDefault();
            }}
            style={{ gap: 6 }}
          >
            <input name="reviewId" type="hidden" value={review.id} />
            <input name="status" type="hidden" value="visible" />
            <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
              블라인드 사유: {review.hiddenReason ?? '기록 없음'}
            </p>
            <button className="btn btn-sm btn-ghost" disabled={statusPending} type="submit">
              {statusPending ? '처리 중' : '블라인드 해제'}
            </button>
            <Feedback state={statusState} />
          </form>
        ) : (
          <form
            action={statusAction}
            className="col"
            onSubmit={(event) => {
              if (!window.confirm(hideConfirmation)) event.preventDefault();
            }}
            style={{ gap: 6 }}
          >
            <input name="reviewId" type="hidden" value={review.id} />
            <input name="status" type="hidden" value="hidden" />
            <label className="admin-console-filter-label" htmlFor={`review-reason-${review.id}`}>
              블라인드 사유 (감사 로그에 남습니다)
            </label>
            <input
              id={`review-reason-${review.id}`}
              key={statusState.resultKey ?? 'reason'}
              maxLength={500}
              name="reason"
              placeholder="예: 욕설·비방, 광고성 내용, 구매하지 않은 사용자로 의심"
              type="text"
            />
            <button className="btn btn-sm" disabled={statusPending} type="submit">
              {statusPending ? '처리 중' : '블라인드'}
            </button>
            <Feedback state={statusState} />
          </form>
        )}
      </div>
    </details>
  );
}

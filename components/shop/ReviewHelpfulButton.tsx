'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setReviewHelpfulAction } from '@/app/shop/review-helpful-actions';
import type { GoodReviewListOptions } from '@/lib/reviews';
import type { ReviewHelpfulState } from '@/lib/review-helpful';

export function ReviewHelpfulButton({ goodId, initial, options }: {
  goodId: string; initial: ReviewHelpfulState; options: GoodReviewListOptions;
}) {
  const router = useRouter();
  const [retry, setRetry] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  function save(marked: boolean) {
    setRetry(marked);
    setError('');
    startTransition(async () => {
      try {
        const result = await setReviewHelpfulAction({ goodId, reviewId: initial.reviewId, marked, options });
        if (!result.ok) { setError(result.error); return; }
        setRetry(null);
        // Render the next server read, including changes from another tab. A
        // receipt must not remain as a second, stale copy of the public count.
        router.refresh();
      } catch {
        setError('도움 표시의 저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.');
      }
    });
  }

  return <div className="wc-review-helpful">
    <button type="button" className="wc-review-helpful__button" aria-pressed={initial.helpfulByMe}
      disabled={pending || !initial.canMarkHelpful || retry !== null} onClick={() => save(!initial.helpfulByMe)}>
      도움이 돼요 <span>{initial.helpfulCount.toLocaleString('ko-KR')}</span>
    </button>
    {pending ? <span role="status">저장 결과 확인 중</span> : null}
    {error ? <div className="wc-review-helpful__error">
      <p role="alert">{error}</p>
      {retry !== null ? <button type="button" className="wc-review-helpful__retry" disabled={pending}
        onClick={() => save(retry)}>같은 요청으로 다시 확인</button> : null}
      <button type="button" className="wc-review-helpful__retry" disabled={pending} onClick={() => {
        startTransition(() => router.refresh());
      }}>최신 상태 확인</button>
    </div> : null}
  </div>;
}

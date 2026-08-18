'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  createReviewAction,
  updateReviewAction,
  type ReviewActionState,
} from '@/app/my/reviews/actions';
import type { MyReviewTarget } from '@/lib/reviews.server';
import {
  MAX_REVIEW_BODY_LENGTH,
  MAX_REVIEW_IMAGES,
  MIN_REVIEW_BODY_LENGTH,
  REVIEW_IMAGE_ACCEPT,
  REVIEW_RATINGS,
  REVIEW_WINDOW_DAYS,
  formatReviewDate,
  reviewDaysRemaining,
  reviewRatingLabel,
} from '@/lib/reviews';

/* 리뷰 작성·수정 폼(#254).
 *
 * 작성과 수정이 한 컴포넌트다. 별점·본문·사진이라는 같은 세 칸을 두 번 그리면
 * 한쪽만 고쳐지는 날이 온다.
 *
 * 자격·기한·중복은 서버가 판정한다. 이 화면은 그 결과를 보여줄 뿐이고, 자격이 없는
 * 상태로 들어와도 폼을 숨기지 않는다 — 왜 못 쓰는지 말하지 않으면 사용자는 화면이
 * 고장 났다고 읽는다.
 *
 * 별점은 라디오다. 별 모양 버튼을 직접 만들면 키보드 이동·포커스 표시·읽기 순서를
 * 전부 다시 구현해야 하고, 그 재구현은 대개 절반만 된다. */

const EMPTY_STATE: ReviewActionState = {};

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
  return <span role="alert" style={{ color: 'var(--pink)', fontSize: 12.5 }}>{children}</span>;
}

function RatingField({ defaultValue, error }: { defaultValue: number; error?: string }) {
  return (
    <fieldset className="col" style={{ border: 0, gap: 8, margin: 0, padding: 0 }}>
      <legend style={{ fontSize: 13.5, fontWeight: 700, padding: 0 }}>별점</legend>
      <div className="row" style={{ gap: 10, justifyContent: 'flex-start' }}>
        {REVIEW_RATINGS.map((rating) => (
          <label className="row" key={rating} style={{ alignItems: 'center', gap: 5, justifyContent: 'flex-start' }}>
            <input defaultChecked={rating === defaultValue} name="rating" type="radio" value={rating} />
            <span className="goods-review-stars" aria-hidden="true">{'★'.repeat(rating)}</span>
            <span className="sr-only">{reviewRatingLabel(rating)}</span>
          </label>
        ))}
      </div>
      <FieldError>{error}</FieldError>
    </fieldset>
  );
}

export function ReviewComposer({
  mode,
  target,
  now = new Date(),
}: {
  mode: 'create' | 'edit';
  target: MyReviewTarget;
  /** 기한 계산 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const isEdit = mode === 'edit';
  const review = target.review;
  const [state, action, pending] = useActionState(
    isEdit ? updateReviewAction : createReviewAction,
    EMPTY_STATE,
  );
  const [keptPaths, setKeptPaths] = useState<string[]>(review?.imagePaths ?? []);

  const daysLeft = reviewDaysRemaining(target.deliveredAt, now);
  const expired = daysLeft === null || daysLeft === 0;
  const hidden = review?.status === 'hidden';
  const blocked = expired || hidden || (!isEdit && !target.writable);

  return (
    <main className="screen">
      <header className="my-header">
        <div className="wrap">
          <Link className="mono" href="/my/reviews" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 내 리뷰
          </Link>
          <div className="eyebrow rise" style={{ marginTop: 14 }}>{isEdit ? 'EDIT REVIEW' : 'NEW REVIEW'}</div>
          <h1 className="h-xl rise">{target.goodName}</h1>
          <p className="rise">
            {target.deliveredAt ? `배송완료 ${formatReviewDate(target.deliveredAt)} · ` : ''}
            {expired
              ? `작성 기한(배송완료 후 ${REVIEW_WINDOW_DAYS}일)이 지났습니다.`
              : `작성 기한 ${daysLeft}일 남음`}
          </p>
        </div>
      </header>

      <section className="my-content">
        <div className="wrap">
          {blocked ? (
            <div className="card col" style={{ borderRadius: 16, gap: 10, padding: 22 }}>
              <strong style={{ fontSize: 15 }}>
                {hidden ? '비공개 처리된 리뷰입니다' : '지금은 리뷰를 남길 수 없습니다'}
              </strong>
              <p className="muted" style={{ margin: 0 }}>
                {hidden
                  ? '운영 정책에 따라 비공개 처리되어 수정할 수 없습니다. 삭제는 내 리뷰에서 언제든 가능합니다.'
                  : expired
                    ? `리뷰는 배송완료 후 ${REVIEW_WINDOW_DAYS}일까지 남기거나 고칠 수 있습니다.`
                    : '이미 이 주문의 굿즈에 리뷰를 남겼거나, 배송이 아직 완료되지 않았습니다.'}
              </p>
              <Link className="btn btn-sm btn-ghost" href="/my/reviews" style={{ alignSelf: 'flex-start' }}>
                내 리뷰로 돌아가기
              </Link>
            </div>
          ) : (
            <form action={action} className="card col" style={{ borderRadius: 16, gap: 16, padding: 22 }}>
              {isEdit && review ? (
                <>
                  <input name="reviewId" type="hidden" value={review.id} />
                  {/* 원본 목록을 함께 보내야 서버가 "빠진 사진"을 알아내 정리할 수 있다. */}
                  {review.imagePaths.map((path) => (
                    <input key={path} name="originalImagePaths" type="hidden" value={path} />
                  ))}
                  {keptPaths.map((path) => (
                    <input key={`keep:${path}`} name="keepImagePaths" type="hidden" value={path} />
                  ))}
                </>
              ) : (
                <>
                  <input name="orderId" type="hidden" value={target.orderId} />
                  <input name="goodId" type="hidden" value={target.goodId} />
                </>
              )}

              <RatingField defaultValue={review?.rating ?? 5} error={state.errors?.rating} />

              <label className="col" style={{ gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>리뷰 내용</span>
                <textarea
                  defaultValue={review?.body ?? ''}
                  maxLength={MAX_REVIEW_BODY_LENGTH}
                  minLength={MIN_REVIEW_BODY_LENGTH}
                  name="body"
                  placeholder="굿즈의 마감, 크기, 색감, 배송처럼 다음 사람이 궁금해할 점을 적어주세요."
                  rows={8}
                  style={{ ...fieldStyle, lineHeight: 1.7, resize: 'vertical' }}
                />
                <FieldError>{state.errors?.body}</FieldError>
              </label>

              {isEdit && review && review.imageUrls.length > 0 ? (
                <div className="col" style={{ gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>기존 사진</span>
                  <ul className="goods-review-photos">
                    {review.imagePaths.map((path, index) => {
                      const kept = keptPaths.includes(path);
                      const url = review.imageUrls[index];

                      return (
                        <li className="col" key={path} style={{ gap: 6 }}>
                          {url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img alt={`기존 리뷰 사진 ${index + 1}`} src={url} style={{ opacity: kept ? 1 : 0.35 }} />
                          ) : null}
                          <label className="row" style={{ alignItems: 'center', fontSize: 11, gap: 5, justifyContent: 'flex-start' }}>
                            <input
                              checked={kept}
                              onChange={(event) => setKeptPaths((current) => (
                                event.target.checked
                                  ? [...current, path]
                                  : current.filter((entry) => entry !== path)
                              ))}
                              type="checkbox"
                            />
                            유지
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              <label className="col" style={{ gap: 7 }}>
                <span style={{ fontSize: 13.5, fontWeight: 700 }}>사진 (선택 · 최대 {MAX_REVIEW_IMAGES}장)</span>
                <input accept={REVIEW_IMAGE_ACCEPT} multiple name="images" type="file" />
                <FieldError>{state.errors?.images}</FieldError>
              </label>

              <FieldError>{state.errors?.form}</FieldError>
              {state.message ? (
                <span role="status" style={{ color: 'var(--mint)', fontSize: 12.5 }}>{state.message}</span>
              ) : null}

              <div className="row" style={{ gap: 10, justifyContent: 'flex-start' }}>
                <button className="btn" disabled={pending} type="submit">
                  {pending ? '저장 중' : isEdit ? '리뷰 수정' : '리뷰 등록'}
                </button>
                <Link className="btn btn-ghost" href="/my/reviews">취소</Link>
              </div>

              <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
                등록한 리뷰는 굿즈 상세에 닉네임과 함께 공개됩니다. 리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.
                개인정보나 타인을 비방하는 내용은 운영 정책에 따라 비공개 처리될 수 있습니다.
              </p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

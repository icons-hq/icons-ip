'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import {
  createReviewAction,
  updateReviewAction,
  type ReviewActionState,
} from '@/app/my/reviews/actions';
import { MypageShell } from '@/components/wc/MypageShell';
import { WcButton } from '@/components/wc/WcButton';
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

function FieldError({ children }: { children?: string }) {
  if (!children) return null;
  return <span className="wc-auth__error" role="alert">{children}</span>;
}

function RatingField({ defaultValue, error }: { defaultValue: number; error?: string }) {
  return (
    <fieldset className="wc-mypage__rating">
      <legend>별점</legend>
      <div className="wc-mypage__rating-row">
        {REVIEW_RATINGS.map((rating) => (
          <label className="wc-mypage__rating-option" key={rating}>
            <input defaultChecked={rating === defaultValue} name="rating" type="radio" value={rating} />
            <span className="wc-rating__stars" aria-hidden="true">{'★'.repeat(rating)}</span>
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
    <MypageShell active="/my/reviews">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">{target.goodName}</h1>
        <Link className="wc-mypage__headbar-link" href="/my/reviews">내 리뷰</Link>
      </div>
      <p className="wc-mypage__lede">
        {target.deliveredAt ? `배송완료 ${formatReviewDate(target.deliveredAt)} · ` : ''}
        {expired
          ? `작성 기한(배송완료 후 ${REVIEW_WINDOW_DAYS}일)이 지났습니다.`
          : `작성 기한 ${daysLeft}일 남음`}
      </p>

      {blocked ? (
        <div className="wc-mypage__notice">
          <strong>
            {hidden ? '비공개 처리된 리뷰입니다' : '지금은 리뷰를 남길 수 없습니다'}
          </strong>
          <span>
            {hidden
              ? '운영 정책에 따라 비공개 처리되어 수정할 수 없습니다. 삭제는 내 리뷰에서 언제든 가능합니다.'
              : expired
                ? `리뷰는 배송완료 후 ${REVIEW_WINDOW_DAYS}일까지 남기거나 고칠 수 있습니다.`
                : '이미 이 주문의 굿즈에 리뷰를 남겼거나, 배송이 아직 완료되지 않았습니다.'}
          </span>
          <WcButton href="/my/reviews">내 리뷰로 돌아가기</WcButton>
        </div>
      ) : (
        <form action={action} className="wc-mypage__form">
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

          <label className="wc-mypage__field">
            리뷰 내용
            <textarea
              defaultValue={review?.body ?? ''}
              maxLength={MAX_REVIEW_BODY_LENGTH}
              minLength={MIN_REVIEW_BODY_LENGTH}
              name="body"
              placeholder="굿즈의 마감, 크기, 색감, 배송처럼 다음 사람이 궁금해할 점을 적어주세요."
              rows={8}
            />
            <FieldError>{state.errors?.body}</FieldError>
          </label>

          {isEdit && review && review.imageUrls.length > 0 ? (
            <div className="wc-mypage__field">
              <span className="wc-mypage__field-title">기존 사진</span>
              <ul className="wc-review-item__photos">
                {review.imagePaths.map((path, index) => {
                  const kept = keptPaths.includes(path);
                  const url = review.imageUrls[index];

                  return (
                    <li className="wc-mypage__photo-keep" key={path}>
                      {url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img alt={`기존 리뷰 사진 ${index + 1}`} src={url} style={{ opacity: kept ? 1 : 0.35 }} />
                      ) : null}
                      <label className="wc-mypage__check">
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

          <label className="wc-mypage__field">
            <span className="wc-mypage__field-title">사진 <small>선택 · 최대 {MAX_REVIEW_IMAGES}장</small></span>
            <input accept={REVIEW_IMAGE_ACCEPT} multiple name="images" type="file" />
            <FieldError>{state.errors?.images}</FieldError>
          </label>

          <FieldError>{state.errors?.form}</FieldError>
          {state.message ? (
            <span className="wc-mypage__success" role="status">{state.message}</span>
          ) : null}

          <div className="wc-mypage__form-actions">
            <WcButton disabled={pending} type="submit" variant="primary">
              {pending ? '저장 중' : isEdit ? '리뷰 수정' : '리뷰 등록'}
            </WcButton>
            <WcButton href="/my/reviews">취소</WcButton>
          </div>

          <p className="wc-mypage__note">
            등록한 리뷰는 굿즈 상세에 닉네임과 함께 공개됩니다. 리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.
            개인정보나 타인을 비방하는 내용은 운영 정책에 따라 비공개 처리될 수 있습니다.
          </p>
        </form>
      )}
    </MypageShell>
  );
}

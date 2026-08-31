import Link from 'next/link';
import { MypageShell } from '@/components/wc/MypageShell';
import type { MyReviewTarget } from '@/lib/reviews.server';
import {
  editReviewHref,
  formatReviewDate,
  goodReviewsHref,
  newReviewHref,
  REVIEW_WINDOW_DAYS,
  reviewDaysRemaining,
  reviewRatingLabel,
} from '@/lib/reviews';
import { orderReferenceLabel } from '@/lib/orders';
import { ReviewDeleteButton } from './ReviewDeleteButton';

/* 내 리뷰(#254).
 *
 * 한 화면에 "쓸 수 있는 것"과 "이미 쓴 것"을 함께 둔다. 작성 목록만 있으면 지난
 * 리뷰를 고치러 갈 곳이 없고, 작성한 것만 있으면 남은 기한을 알 수 없다.
 *
 * 기한이 지난 항목도 감추지 않는다. 사라진 항목은 "왜 못 쓰는지"를 설명하지 못한다 —
 * 리뷰를 쓰려고 들어온 사람이 자기 주문이 없어졌다고 읽게 된다. */

function Stars({ rating }: { rating: number }) {
  return (
    <span className="wc-rating__stars">
      <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
      <span className="sr-only">{reviewRatingLabel(rating)}</span>
    </span>
  );
}

function DeadlineNote({ target, now }: { target: MyReviewTarget; now: Date }) {
  const daysLeft = reviewDaysRemaining(target.deliveredAt, now);

  if (daysLeft === null) {
    return (
      <span className="wc-mypage__hint">
        배송완료가 확인되면 작성 기한이 시작됩니다.
      </span>
    );
  }
  if (daysLeft === 0) {
    return (
      <span className="wc-mypage__hint">
        작성 기한(배송완료 후 {REVIEW_WINDOW_DAYS}일)이 지났습니다.
      </span>
    );
  }
  return (
    <span className="wc-mypage__hint">
      배송완료 {formatReviewDate(target.deliveredAt ?? '')} · 작성 기한 {daysLeft}일 남음
    </span>
  );
}

function WritableCard({ target, now }: { target: MyReviewTarget; now: Date }) {
  return (
    <li className="wc-mypage__card">
      <div className="wc-mypage__card-row">
        <div className="wc-mypage__card-main">
          <Link className="wc-mypage__card-title" href={`/shop/${target.goodId}`}>
            {target.goodName}
          </Link>
          <span className="wc-mypage__card-meta">주문 {orderReferenceLabel(target.orderId)}</span>
          <DeadlineNote now={now} target={target} />
        </div>
        <Link className="wc-mypage__headbar-link" href={newReviewHref(target.orderId, target.goodId)}>
          리뷰 쓰기
        </Link>
      </div>
    </li>
  );
}

function WrittenCard({ target, now }: { target: MyReviewTarget; now: Date }) {
  const review = target.review;
  if (!review) return null;

  const daysLeft = reviewDaysRemaining(target.deliveredAt, now);
  const editable = review.status === 'visible' && daysLeft !== null && daysLeft > 0;

  return (
    <li className="wc-mypage__card">
      <div className="wc-mypage__card-row">
        <div className="wc-mypage__card-main">
          <Link className="wc-mypage__card-title" href={goodReviewsHref(target.goodId)}>
            {target.goodName}
          </Link>
          <span className="wc-mypage__card-meta">
            <Stars rating={review.rating} />
            <time dateTime={review.createdAt}>
              {formatReviewDate(review.createdAt)}
            </time>
            {review.editedAt ? <span>수정됨</span> : null}
          </span>
        </div>
        <div className="wc-mypage__card-actions">
          {editable ? (
            <Link className="wc-mypage__headbar-link" href={editReviewHref(review.id)}>수정</Link>
          ) : null}
          <ReviewDeleteButton goodId={target.goodId} reviewId={review.id} />
        </div>
      </div>

      <p className="wc-mypage__card-body">{review.body}</p>

      {review.imageUrls.length > 0 ? (
        <ul className="wc-review-item__photos">
          {review.imageUrls.map((url, index) => (
            <li key={url}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt={`내 리뷰 사진 ${index + 1}`} loading="lazy" src={url} />
            </li>
          ))}
        </ul>
      ) : null}

      {/*
        * 블라인드는 삭제가 아니다. 왜 안 보이는지 말하지 않으면 사용자는 자기 글이
        * 사라졌다고만 알게 되고, 물어볼 근거조차 갖지 못한다.
        */}
      {review.status === 'hidden' ? (
        <p className="wc-mypage__hint">
          운영 정책에 따라 비공개 처리되어 굿즈 상세에는 보이지 않습니다. 수정은 할 수 없고 삭제는 언제든 가능합니다.
          이유가 궁금하면 <Link href="/my/inquiries/new?category=account">1:1 문의</Link>로 알려주세요.
        </p>
      ) : !editable ? (
        <p className="wc-mypage__hint">
          작성 기한(배송완료 후 {REVIEW_WINDOW_DAYS}일)이 지나 수정할 수 없습니다. 삭제는 언제든 가능합니다.
        </p>
      ) : null}

      {review.adminReply ? (
        <div className="wc-review-item__reply">
          <strong className="wc-review-item__reply-author">ICONS 운영자</strong>
          {review.adminReplyAt ? (
            <time className="wc-review-item__date" dateTime={review.adminReplyAt}>
              {formatReviewDate(review.adminReplyAt)}
            </time>
          ) : null}
          <p className="wc-review-item__body" style={{ whiteSpace: 'pre-wrap' }}>{review.adminReply}</p>
        </div>
      ) : null}
    </li>
  );
}

export function MyReviews({
  targets,
  now = new Date(),
}: {
  targets: MyReviewTarget[];
  /** 기한 계산 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const writable = targets.filter((target) => target.writable);
  const expired = targets.filter((target) => !target.writable && !target.review);
  const written = targets.filter((target) => target.review);

  return (
    <MypageShell active="/my/reviews">
      <div className="wc-mypage__headbar">
        <h1 className="wc-mypage__headbar-title">내 리뷰</h1>
      </div>
      <p className="wc-mypage__lede">
        배송이 완료된 굿즈에 별점과 후기를 남길 수 있습니다. 주문·굿즈당 한 번, 배송완료 후 {REVIEW_WINDOW_DAYS}일까지입니다.
        리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.
      </p>

      <section aria-labelledby="review-writable-heading">
        <div className="wc-mypage__subhead">
          <h2 id="review-writable-heading">작성할 수 있는 리뷰 {writable.length}건</h2>
        </div>
        {writable.length ? (
          <ul className="wc-mypage__cards">
            {writable.map((target) => (
              <WritableCard key={`${target.orderId}:${target.goodId}`} now={now} target={target} />
            ))}
          </ul>
        ) : (
          <p className="wc-mypage__hint">
            지금 리뷰를 남길 수 있는 굿즈가 없습니다. 배송이 완료되면 여기에 나타납니다.
          </p>
        )}
      </section>

      {written.length ? (
        <section aria-labelledby="review-written-heading">
          <div className="wc-mypage__subhead">
            <h2 id="review-written-heading">내가 쓴 리뷰 {written.length}건</h2>
          </div>
          <ul className="wc-mypage__cards">
            {written.map((target) => (
              <WrittenCard key={`${target.orderId}:${target.goodId}`} now={now} target={target} />
            ))}
          </ul>
        </section>
      ) : null}

      {expired.length ? (
        <section aria-labelledby="review-expired-heading">
          <div className="wc-mypage__subhead">
            <h2 id="review-expired-heading">기한이 지난 굿즈 {expired.length}건</h2>
          </div>
          <ul className="wc-mypage__rows">
            {expired.map((target) => (
              <li key={`${target.orderId}:${target.goodId}`}>
                <Link href={`/shop/${target.goodId}`}>{target.goodName}</Link>
                <DeadlineNote now={now} target={target} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </MypageShell>
  );
}

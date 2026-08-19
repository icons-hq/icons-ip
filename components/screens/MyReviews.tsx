import Link from 'next/link';
import type { MyReviewTarget } from '@/lib/reviews.server';
import {
  editReviewHref,
  formatReviewDate,
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
    <span className="goods-review-stars">
      <span aria-hidden="true">{'★'.repeat(rating)}{'☆'.repeat(5 - rating)}</span>
      <span className="sr-only">{reviewRatingLabel(rating)}</span>
    </span>
  );
}

function DeadlineNote({ target, now }: { target: MyReviewTarget; now: Date }) {
  const daysLeft = reviewDaysRemaining(target.deliveredAt, now);

  if (daysLeft === null) {
    return (
      <span className="muted" style={{ fontSize: 12 }}>
        배송완료가 확인되면 작성 기한이 시작됩니다.
      </span>
    );
  }
  if (daysLeft === 0) {
    return (
      <span className="muted" style={{ fontSize: 12 }}>
        작성 기한(배송완료 후 {REVIEW_WINDOW_DAYS}일)이 지났습니다.
      </span>
    );
  }
  return (
    <span className="muted" style={{ fontSize: 12 }}>
      배송완료 {formatReviewDate(target.deliveredAt ?? '')} · 작성 기한 {daysLeft}일 남음
    </span>
  );
}

function WritableCard({ target, now }: { target: MyReviewTarget; now: Date }) {
  return (
    <li className="card col" style={{ borderRadius: 12, gap: 10, padding: 16 }}>
      <div className="between" style={{ alignItems: 'start', gap: 12 }}>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <Link href={`/shop/${target.goodId}`} style={{ fontSize: 15, fontWeight: 700 }}>
            {target.goodName}
          </Link>
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
            주문 {orderReferenceLabel(target.orderId)}
          </span>
          <DeadlineNote now={now} target={target} />
        </div>
        <Link className="btn btn-sm" href={newReviewHref(target.orderId, target.goodId)}>
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
    <li className="card col" style={{ borderRadius: 12, gap: 10, padding: 16 }}>
      <div className="between" style={{ alignItems: 'start', gap: 12 }}>
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <Link href={`/shop/${target.goodId}#reviews`} style={{ fontSize: 15, fontWeight: 700 }}>
            {target.goodName}
          </Link>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-start' }}>
            <Stars rating={review.rating} />
            <time className="mono" dateTime={review.createdAt} style={{ color: 'var(--dim)', fontSize: 11 }}>
              {formatReviewDate(review.createdAt)}
            </time>
            {review.editedAt ? (
              <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>수정됨</span>
            ) : null}
          </div>
        </div>
        <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
          {editable ? (
            <Link className="btn btn-sm btn-ghost" href={editReviewHref(review.id)}>수정</Link>
          ) : null}
          <ReviewDeleteButton goodId={target.goodId} reviewId={review.id} />
        </div>
      </div>

      <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{review.body}</p>

      {review.imageUrls.length > 0 ? (
        <ul className="goods-review-photos">
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
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          운영 정책에 따라 비공개 처리되어 굿즈 상세에는 보이지 않습니다. 수정은 할 수 없고 삭제는 언제든 가능합니다.
          이유가 궁금하면 <Link href="/my/inquiries/new?category=account">1:1 문의</Link>로 알려주세요.
        </p>
      ) : !editable ? (
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          작성 기한(배송완료 후 {REVIEW_WINDOW_DAYS}일)이 지나 수정할 수 없습니다. 삭제는 언제든 가능합니다.
        </p>
      ) : null}

      {review.adminReply ? (
        <div className="goods-review-reply">
          <strong className="mono" style={{ fontSize: 11, letterSpacing: '.08em' }}>ICONS 운영자</strong>
          {review.adminReplyAt ? (
            <time className="mono" dateTime={review.adminReplyAt} style={{ color: 'var(--dim)', fontSize: 11 }}>
              {formatReviewDate(review.adminReplyAt)}
            </time>
          ) : null}
          <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>{review.adminReply}</p>
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
    <main className="screen">
      <header className="my-header">
        <div className="wrap">
          <Link className="mono" href="/my" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.1em', textDecoration: 'none' }}>
            ← 마이
          </Link>
          <div className="eyebrow rise" style={{ marginTop: 14 }}>REVIEW</div>
          <h1 className="h-xl rise">내 리뷰</h1>
          <p className="rise">
            배송이 완료된 굿즈에 별점과 후기를 남길 수 있습니다. 주문·굿즈당 한 번, 배송완료 후 {REVIEW_WINDOW_DAYS}일까지입니다.
            리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.
          </p>
        </div>
      </header>

      <section aria-labelledby="review-writable-heading" className="my-content">
        <div className="wrap">
          <div className="my-section-heading">
            <h2 id="review-writable-heading">작성할 수 있는 리뷰 {writable.length}건</h2>
          </div>
          {writable.length ? (
            <ul className="col" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
              {writable.map((target) => (
                <WritableCard key={`${target.orderId}:${target.goodId}`} now={now} target={target} />
              ))}
            </ul>
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              지금 리뷰를 남길 수 있는 굿즈가 없습니다. 배송이 완료되면 여기에 나타납니다.
            </p>
          )}
        </div>
      </section>

      {written.length ? (
        <section aria-labelledby="review-written-heading" className="my-content">
          <div className="wrap">
            <div className="my-section-heading">
              <h2 id="review-written-heading">내가 쓴 리뷰 {written.length}건</h2>
            </div>
            <ul className="col" style={{ gap: 12, listStyle: 'none', margin: 0, padding: 0 }}>
              {written.map((target) => (
                <WrittenCard key={`${target.orderId}:${target.goodId}`} now={now} target={target} />
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {expired.length ? (
        <section aria-labelledby="review-expired-heading" className="my-content">
          <div className="wrap">
            <div className="my-section-heading">
              <h2 id="review-expired-heading">기한이 지난 굿즈 {expired.length}건</h2>
            </div>
            <ul className="col" style={{ gap: 8, listStyle: 'none', margin: 0, padding: 0 }}>
              {expired.map((target) => (
                <li className="row" key={`${target.orderId}:${target.goodId}`} style={{ gap: 10, justifyContent: 'flex-start' }}>
                  <Link href={`/shop/${target.goodId}`} style={{ fontSize: 13.5 }}>{target.goodName}</Link>
                  <DeadlineNote now={now} target={target} />
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </main>
  );
}

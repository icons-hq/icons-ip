import Link from 'next/link';
import { reportCommunityTargetAction } from '@/app/community/actions';
import type { GoodReviewSection } from '@/lib/reviews.server';
import {
  formatReviewAverage,
  formatReviewDate,
  goodReviewsHref,
  REVIEW_SORTS,
  REVIEW_SORT_LABELS,
  reviewDistributionPercent,
  reviewRatingLabel,
} from '@/lib/reviews';

/*
 * 굿즈 상세의 리뷰 표면(#254).
 *
 * 서버 컴포넌트다. GoodDetailView는 갤러리 상태 때문에 `'use client'`지만, 리뷰는
 * 클라이언트 상태가 없다 — 정렬·필터·페이지는 전부 링크(URL)로 움직인다. 그래서
 * 이 블록만 서버에 남겨 slot으로 끼운다. 결과적으로 리뷰 본문·사진 서명 URL이
 * 클라이언트 번들의 props로 직렬화되지 않는다.
 *
 * 읽기는 비로그인도 가능하다(공개 브라우징 원칙). 살지 말지를 정하는 사람은 아직
 * 로그인하지 않은 사람이라, 리뷰를 로그인 뒤로 미루면 리뷰를 두는 이유가 사라진다.
 * 신고와 작성만 보호 액션이다.
 */

function Stars({ rating }: { rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <span className="goods-review-stars">
      <span aria-hidden="true">{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span>
      <span className="sr-only">{reviewRatingLabel(rating)}</span>
    </span>
  );
}

/** 별점 분포. 5점부터 내려온다 — 사람들이 먼저 찾는 것은 "몇 명이 만점을 줬나"다. */
function Distribution({ distribution, total }: { distribution: readonly number[]; total: number }) {
  return (
    <ul className="goods-review-distribution">
      {[5, 4, 3, 2, 1].map((rating) => {
        const count = distribution[rating - 1] ?? 0;
        const percent = reviewDistributionPercent(count, total);

        return (
          <li key={rating}>
            <span className="goods-review-distribution-label">{rating}점</span>
            <span aria-hidden="true" className="goods-review-distribution-track">
              <span className="goods-review-distribution-bar" style={{ width: `${percent}%` }} />
            </span>
            <span className="goods-review-distribution-count">{count.toLocaleString('ko-KR')}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function GoodReviews({
  goodId,
  section,
}: {
  goodId: string;
  section: GoodReviewSection;
}) {
  const { options, pageSize, reviews, summary, total } = section;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, options.page), totalPages);
  /* 조건이 걸린 목록은 요약 개수와 다를 수 있다. 목록 헤더에는 요약(전체)이 아니라
     지금 보고 있는 조건의 건수를 적는다 — 두 숫자가 어긋나 보이면 어느 쪽도 못 믿는다. */
  const listCountLabel = options.photoOnly ? '사진 리뷰' : '리뷰';

  return (
    <section aria-labelledby="goods-review-heading" className="goods-detail-section" id="reviews">
      <h2 className="mono" id="goods-review-heading" style={{ color: 'var(--dim)', fontSize: 12, letterSpacing: '.16em', margin: 0 }}>
        리뷰
      </h2>

      {summary.count === 0 ? (
        <p style={{ color: 'var(--dim)', fontSize: 13.5, lineHeight: 1.7, margin: 0 }}>
          아직 등록된 리뷰가 없습니다. 배송이 완료되면 구매하신 분이 별점과 후기를 남길 수 있습니다.
        </p>
      ) : (
        <>
          <div className="goods-review-summary">
            <div className="goods-review-average">
              <strong className="mono">{formatReviewAverage(summary.average)}</strong>
              <Stars rating={summary.average} />
              <span style={{ color: 'var(--dim)', fontSize: 12.5 }}>
                리뷰 {summary.count.toLocaleString('ko-KR')}건
                {summary.photoCount > 0 ? ` · 사진 ${summary.photoCount.toLocaleString('ko-KR')}건` : ''}
              </span>
            </div>
            <Distribution distribution={summary.distribution} total={summary.count} />
          </div>

          <div className="goods-review-controls" role="group" aria-label="리뷰 정렬과 필터">
            {REVIEW_SORTS.map((sort) => (
              <Link
                aria-current={options.sort === sort ? 'true' : undefined}
                className={`btn btn-sm${options.sort === sort ? '' : ' btn-ghost'}`}
                href={goodReviewsHref(goodId, options, { page: 1, sort })}
                key={sort}
              >
                {REVIEW_SORT_LABELS[sort]}
              </Link>
            ))}
            <Link
              aria-current={options.photoOnly ? 'true' : undefined}
              className={`btn btn-sm${options.photoOnly ? '' : ' btn-ghost'}`}
              href={goodReviewsHref(goodId, options, { page: 1, photoOnly: !options.photoOnly })}
            >
              {options.photoOnly ? '전체 리뷰 보기' : '사진 리뷰만'}
            </Link>
          </div>

          {reviews.length === 0 ? (
            <p style={{ color: 'var(--dim)', fontSize: 13.5, margin: 0 }}>
              조건에 맞는 리뷰가 없습니다.
            </p>
          ) : (
            <>
              <p className="mono" style={{ color: 'var(--dim)', fontSize: 11, letterSpacing: '.08em', margin: 0 }}>
                {listCountLabel} {total.toLocaleString('ko-KR')}건
              </p>
              <ul className="goods-review-list">
                {reviews.map((review) => (
                  <li className="goods-review-item" key={review.id}>
                    <div className="goods-review-item-head">
                      <Stars rating={review.rating} />
                      <span style={{ fontSize: 13.5 }}>@{review.authorName}</span>
                      <time className="mono" dateTime={review.createdAt} style={{ color: 'var(--dim)', fontSize: 11 }}>
                        {formatReviewDate(review.createdAt)}
                      </time>
                      {review.editedAt ? (
                        <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>수정됨</span>
                      ) : null}
                    </div>

                    <p style={{ fontSize: 14, lineHeight: 1.75, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {review.body}
                    </p>

                    {review.imageUrls.length > 0 ? (
                      <ul className="goods-review-photos">
                        {review.imageUrls.map((url, index) => (
                          <li key={url}>
                            {/* 서명 URL은 매 요청 달라진다. next/image의 최적화 캐시가
                                의미를 잃고 만료된 URL을 다시 그릴 위험만 남는다. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={`리뷰 사진 ${index + 1}`} loading="lazy" src={url} />
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    {review.adminReply ? (
                      <div className="goods-review-reply">
                        <strong className="mono" style={{ fontSize: 11, letterSpacing: '.08em' }}>ICONS 운영자</strong>
                        {review.adminReplyAt ? (
                          <time className="mono" dateTime={review.adminReplyAt} style={{ color: 'var(--dim)', fontSize: 11 }}>
                            {formatReviewDate(review.adminReplyAt)}
                          </time>
                        ) : null}
                        <p style={{ fontSize: 13.5, lineHeight: 1.7, margin: 0, whiteSpace: 'pre-wrap' }}>
                          {review.adminReply}
                        </p>
                      </div>
                    ) : null}

                    {/* 자기 리뷰는 신고 대상이 아니다. 수정·삭제는 내 리뷰 화면이 맡는다. */}
                    {review.isMine ? (
                      <Link className="mono goods-review-action" href="/my/reviews">
                        내 리뷰 관리
                      </Link>
                    ) : (
                      <form action={reportCommunityTargetAction} className="goods-review-report">
                        <input name="targetType" type="hidden" value="review" />
                        <input name="targetId" type="hidden" value={review.id} />
                        <input name="next" type="hidden" value={goodReviewsHref(goodId, options)} />
                        <button className="mono goods-review-action" type="submit">
                          신고
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>

              {totalPages > 1 ? (
                <nav aria-label="리뷰 페이지" className="goods-review-pagination">
                  {currentPage > 1 ? (
                    <Link className="btn btn-sm btn-ghost" href={goodReviewsHref(goodId, options, { page: currentPage - 1 })}>
                      이전
                    </Link>
                  ) : <span />}
                  <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
                    {currentPage} / {totalPages}
                  </span>
                  {currentPage < totalPages ? (
                    <Link className="btn btn-sm btn-ghost" href={goodReviewsHref(goodId, options, { page: currentPage + 1 })}>
                      다음
                    </Link>
                  ) : <span />}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}

      <p style={{ color: 'var(--dim)', fontSize: 12.5, lineHeight: 1.7, margin: 0 }}>
        리뷰는 배송이 완료된 주문의 구매자만 주문·굿즈당 한 번 남길 수 있고, 작성 기한은 배송완료 후 90일입니다.
        리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.{' '}
        <Link href="/my/reviews">내가 쓸 수 있는 리뷰 보기</Link>
      </p>
    </section>
  );
}

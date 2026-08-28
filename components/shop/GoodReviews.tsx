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
 * 굿즈 상세의 리뷰 표면(#254 → #326 White Catalog 재조판).
 *
 * 서버 컴포넌트다. GoodDetailView는 갤러리·수량 때문에 `'use client'`지만, 리뷰는
 * 클라이언트 상태가 없다 — 정렬·필터·페이지는 전부 링크(URL)로 움직인다. 그래서
 * 이 블록만 서버에 남겨 PDP 리뷰 탭에 slot으로 끼운다. 결과적으로 리뷰 본문·사진
 * 서명 URL이 클라이언트 번들의 props로 직렬화되지 않는다.
 *
 * 읽기는 비로그인도 가능하다(공개 브라우징 원칙). 살지 말지를 정하는 사람은 아직
 * 로그인하지 않은 사람이라, 리뷰를 로그인 뒤로 미루면 리뷰를 두는 이유가 사라진다.
 * 신고와 작성만 보호 액션이다.
 *
 * 레퍼런스는 분포 바·검증구매·도움돼요를 전부 숨겨 리뷰 신뢰 UI가 반쯤 꺼져 있다
 * (R-04 §10-3). 우리는 이미 가진 분포 데이터를 그대로 보여준다.
 */

/** 요약부 포토 그리드 상한(R-04 §6.1 — 2×4). 현재 페이지에 실린 사진만 쓴다. */
const SUMMARY_PHOTO_LIMIT = 8;

/**
 * 숫자 페이저에 그릴 페이지 번호.
 *
 * 항상 같은 개수를 유지한다 — 끝 페이지에서 창이 줄어들면 페이저 폭이 흔들려
 * 다음 클릭 지점이 이동한다.
 */
export function reviewPageWindow(current: number, pageCount: number, span = 5): number[] {
  const size = Math.min(span, Math.max(1, pageCount));
  const start = Math.max(1, Math.min(current - Math.floor(size / 2), pageCount - size + 1));
  return Array.from({ length: size }, (_, index) => start + index);
}

function Stars({ className, rating }: { className?: string; rating: number }) {
  const filled = Math.max(0, Math.min(5, Math.round(rating)));

  return (
    <span className={`wc-rating__stars${className ? ` ${className}` : ''}`}>
      <span aria-hidden="true">{'★'.repeat(filled)}{'☆'.repeat(5 - filled)}</span>
      <span className="wc-sr-only">{reviewRatingLabel(rating)}</span>
    </span>
  );
}

/** 별점 분포. 5점부터 내려온다 — 사람들이 먼저 찾는 것은 "몇 명이 만점을 줬나"다. */
function Distribution({ distribution, total }: { distribution: readonly number[]; total: number }) {
  return (
    <ul className="wc-review-summary__dist">
      {[5, 4, 3, 2, 1].map((rating) => {
        const count = distribution[rating - 1] ?? 0;
        const percent = reviewDistributionPercent(count, total);

        return (
          <li key={rating} className="wc-review-summary__dist-row">
            <span className="wc-review-summary__dist-label">{rating}점</span>
            <span aria-hidden="true" className="wc-review-summary__dist-track">
              <span className="wc-review-summary__dist-bar" style={{ width: `${percent}%` }} />
            </span>
            <span className="wc-review-summary__dist-count">{count.toLocaleString('ko-KR')}</span>
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
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(Math.max(1, options.page), pageCount);
  /* 조건이 걸린 목록은 요약 개수와 다를 수 있다. 목록 헤더에는 요약(전체)이 아니라
     지금 보고 있는 조건의 건수를 적는다 — 두 숫자가 어긋나 보이면 어느 쪽도 못 믿는다. */
  const listCountLabel = options.photoOnly ? '사진 리뷰' : '리뷰';
  const summaryPhotos = reviews.flatMap((review) => review.imageUrls).slice(0, SUMMARY_PHOTO_LIMIT);

  return (
    <section aria-labelledby="pdp-review-heading" className="wc-reviews" id="reviews">
      <h2 className="wc-sr-only" id="pdp-review-heading">리뷰</h2>

      {summary.count === 0 ? (
        <p className="wc-pdp-panel__note">
          아직 등록된 리뷰가 없습니다. 배송이 완료되면 구매하신 분이 별점과 후기를 남길 수 있습니다.
        </p>
      ) : (
        <>
          <div className="wc-review-summary">
            <div className="wc-review-summary__average">
              <strong className="wc-review-summary__score">{formatReviewAverage(summary.average)}</strong>
              <Stars className="wc-review-summary__stars" rating={summary.average} />
              <span className="wc-review-summary__count">
                리뷰 {summary.count.toLocaleString('ko-KR')}건
                {summary.photoCount > 0 ? ` · 사진 ${summary.photoCount.toLocaleString('ko-KR')}건` : ''}
              </span>
            </div>
            <Distribution distribution={summary.distribution} total={summary.count} />
            {summaryPhotos.length > 0 ? (
              <ul className="wc-review-summary__photos">
                {summaryPhotos.map((url, index) => (
                  <li key={url}>
                    {/* 서명 URL은 매 요청 달라진다. next/image의 최적화 캐시가
                        의미를 잃고 만료된 URL을 다시 그릴 위험만 남는다. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={`리뷰 사진 ${index + 1}`} loading="lazy" src={url} />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div aria-label="리뷰 정렬과 필터" className="wc-review-controls" role="group">
            {REVIEW_SORTS.map((sort) => (
              <Link
                key={sort}
                aria-current={options.sort === sort ? 'true' : undefined}
                className="wc-review-controls__link"
                href={goodReviewsHref(goodId, options, { page: 1, sort })}
              >
                {REVIEW_SORT_LABELS[sort]}
              </Link>
            ))}
            <Link
              aria-current={options.photoOnly ? 'true' : undefined}
              className="wc-review-controls__link"
              href={goodReviewsHref(goodId, options, { page: 1, photoOnly: !options.photoOnly })}
            >
              {options.photoOnly ? '전체 리뷰 보기' : '사진 리뷰만'}
            </Link>
          </div>

          {reviews.length === 0 ? (
            <p className="wc-pdp-panel__note">조건에 맞는 리뷰가 없습니다.</p>
          ) : (
            <>
              <p className="wc-review-list__count">
                {listCountLabel} {total.toLocaleString('ko-KR')}건
              </p>
              <ul className="wc-review-list">
                {reviews.map((review) => (
                  <li key={review.id} className="wc-review-item">
                    <div className="wc-review-item__meta">
                      <Stars rating={review.rating} />
                      <span className="wc-review-item__author">@{review.authorName}</span>
                      <time className="wc-review-item__date" dateTime={review.createdAt}>
                        {formatReviewDate(review.createdAt)}
                      </time>
                      {review.editedAt ? (
                        <span className="wc-review-item__flag">수정됨</span>
                      ) : null}
                    </div>

                    {/* 줄바꿈은 작성자가 넣은 내용이다 — 접으면 문단이 한 덩어리가 된다. */}
                    <p className="wc-review-item__body" style={{ whiteSpace: 'pre-wrap' }}>{review.body}</p>

                    {review.imageUrls.length > 0 ? (
                      <ul className="wc-review-item__photos">
                        {review.imageUrls.map((url, index) => (
                          <li key={url}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img alt={`리뷰 사진 ${index + 1}`} loading="lazy" src={url} />
                          </li>
                        ))}
                      </ul>
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

                    {/* 자기 리뷰는 신고 대상이 아니다. 수정·삭제는 내 리뷰 화면이 맡는다. */}
                    {review.isMine ? (
                      <Link className="wc-review-item__action" href="/my/reviews">내 리뷰 관리</Link>
                    ) : (
                      <form action={reportCommunityTargetAction} className="wc-review-item__report">
                        <input name="targetType" type="hidden" value="review" />
                        <input name="targetId" type="hidden" value={review.id} />
                        <input name="next" type="hidden" value={goodReviewsHref(goodId, options)} />
                        <button className="wc-review-item__action" type="submit">신고</button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>

              {pageCount > 1 ? (
                <nav aria-label="리뷰 페이지" className="wc-pagination">
                  {currentPage > 1 ? (
                    <Link
                      className="wc-pagination__arrow"
                      href={goodReviewsHref(goodId, options, { page: currentPage - 1 })}
                    >
                      이전
                    </Link>
                  ) : null}
                  {reviewPageWindow(currentPage, pageCount).map((page) => (
                    page === currentPage ? (
                      <span key={page} aria-current="page" className="wc-pagination__cell">{page}</span>
                    ) : (
                      <Link
                        key={page}
                        className="wc-pagination__cell"
                        href={goodReviewsHref(goodId, options, { page })}
                      >
                        {page}
                      </Link>
                    )
                  ))}
                  {currentPage < pageCount ? (
                    <Link
                      className="wc-pagination__arrow"
                      href={goodReviewsHref(goodId, options, { page: currentPage + 1 })}
                    >
                      다음
                    </Link>
                  ) : null}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}

      <p className="wc-reviews__policy">
        리뷰는 배송이 완료된 주문의 구매자만 주문·굿즈당 한 번 남길 수 있고, 작성 기한은 배송완료 후 90일입니다.
        리뷰를 남긴다고 적립금이나 혜택이 주어지지는 않습니다.{' '}
        <Link href="/my/reviews">내가 쓸 수 있는 리뷰 보기</Link>
      </p>
    </section>
  );
}

import Link from 'next/link';
import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_REVIEW_PHOTO_OPTIONS,
  ADMIN_REVIEW_RATING_OPTIONS,
  ADMIN_REVIEW_REPLY_OPTIONS,
  ADMIN_REVIEW_SEARCH_FIELDS,
  ADMIN_REVIEW_SORT_OPTIONS,
  ADMIN_REVIEW_STATUS_OPTIONS,
  adminReviewHref,
  adminReviewResetHref,
  isLowReviewRating,
  type AdminReviewConsoleData,
  type AdminReviewRow,
} from '@/lib/admin/reviews';
import {
  ADMIN_REVIEW_STATUS_LABELS,
  formatReviewDateTime,
  LOW_REVIEW_RATING_MAX,
  reviewBodyPreview,
  reviewRatingLabel,
} from '@/lib/reviews';
import { ReviewActionPanel } from './ReviewActionPanel';

/* 어드민 리뷰 관리 콘솔(#254).
 *
 * 스마트스토어 리뷰관리의 목록 구조를 그대로 따르되 보상(리뷰 포인트)은 없다.
 * 그래서 이 화면에는 적립·지급 칸이 하나도 없다 — 없는 개념의 자리를 비워 두면
 * 다음 사람이 "왜 지급이 안 되지"를 찾게 된다.
 *
 * 저평점(1~2점) 필터는 목록 맨 위에 고정한다. 리뷰 운영에서 가장 급한 일은 낮은
 * 별점을 먼저 읽고 답하는 것이고, 그 조건이 다른 셀렉트 사이에 섞여 있으면
 * "찾아서 거는" 필터가 된다 — 급한 것은 찾게 만들지 않는다. */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'createdAt', label: '작성일', width: '140px' },
  { key: 'good', label: '굿즈', width: '150px' },
  { key: 'rating', label: '평점', width: '92px' },
  { key: 'body', label: '리뷰 내용' },
  { key: 'photo', label: '사진', align: 'end', width: '70px' },
  { key: 'author', label: '작성자', width: '130px' },
  { key: 'reports', label: '신고', align: 'end', width: '80px' },
  { key: 'status', label: '상태', width: '90px' },
  { key: 'reply', label: '답글', width: '110px' },
  { key: 'action', label: '처리', width: '210px' },
];

/** 별점 셀. 별 문자만 두면 스크린리더가 "검은 별 검은 별..."을 읽는다. */
function ratingCell(row: AdminReviewRow) {
  return (
    <span data-low-rating={isLowReviewRating(row.rating) ? 'true' : undefined} key="rating">
      <span aria-hidden="true">{'★'.repeat(row.rating)}{'☆'.repeat(5 - row.rating)}</span>
      <span className="sr-only">{reviewRatingLabel(row.rating)}</span>
    </span>
  );
}

export function ReviewConsoleScreen({
  data,
  now = new Date(),
}: {
  data: AdminReviewConsoleData;
  /** 기간 프리셋 기준 시각. 테스트 주입용. */
  now?: Date;
}) {
  const { counts, filters, pageSize, rows, total } = data;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => ({
    id: row.id,
    cells: [
      <span key="createdAt">
        <time dateTime={row.createdAt}>{formatReviewDateTime(row.createdAt)}</time>
        {row.editedAt ? <><br /><span className="muted">수정됨</span></> : null}
      </span>,
      <Link href={`/shop/${row.goodId}#reviews`} key="good">{row.goodName}</Link>,
      ratingCell(row),
      <span key="body">{reviewBodyPreview(row.body, 70)}</span>,
      row.imageCount > 0
        ? <span key="photo">{row.imageCount}장</span>
        : <span className="muted" key="photo">-</span>,
      <span key="author">@{row.authorName}</span>,
      /* 신고가 0건인 리뷰와 "신고는 있었지만 다 처리된" 리뷰는 다른 상황이다.
         미처리 건수를 앞에 두되 총 건수도 함께 남긴다. */
      row.reportCount > 0
        ? (
          <Link href="/admin/community/moderation" key="reports">
            {row.openReportCount > 0 ? `${row.openReportCount}건 미처리` : `${row.reportCount}건 처리됨`}
          </Link>
        )
        : <span className="muted" key="reports">-</span>,
      <span data-review-status={row.status} key="status">
        {ADMIN_REVIEW_STATUS_LABELS[row.status]}
      </span>,
      row.adminReply
        ? (
          <span key="reply">
            등록됨
            {row.replyAuthorName ? <><br /><span className="muted">@{row.replyAuthorName}</span></> : null}
          </span>
        )
        : <span className="muted" key="reply">미등록</span>,
      <ReviewActionPanel key="action" review={row} />,
    ],
  }));

  return (
    <section className="admin-console">
      {/* 저평점 고정 필터. 목록의 어떤 조건보다 먼저 보여야 하는 한 줄이다. */}
      <div className="admin-console-pinned-filter card">
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>저평점 리뷰 {counts.lowRating.toLocaleString('ko-KR')}건</strong>
          <span className="muted" style={{ fontSize: 12.5 }}>
            {LOW_REVIEW_RATING_MAX}점 이하 리뷰입니다. 답글이 늦을수록 그대로 굳습니다.
          </span>
        </div>
        <Link
          aria-current={filters.lowRating ? 'true' : undefined}
          className={`btn btn-sm${filters.lowRating ? '' : ' btn-ghost'}`}
          href={adminReviewHref(filters, { lowRating: !filters.lowRating, page: 1, reviewId: null })}
        >
          {filters.lowRating ? '저평점 필터 해제' : '저평점만 보기'}
        </Link>
      </div>

      {filters.reviewId ? (
        /* 모더레이션 큐에서 넘어온 딥링크. 한 건만 보이는 이유를 말하지 않으면
           운영자는 목록이 비었다고 읽는다. */
        <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
          신고된 리뷰 한 건만 보고 있습니다.{' '}
          <Link href={adminReviewHref(filters, { page: 1, reviewId: null })}>전체 목록으로 돌아가기</Link>
        </p>
      ) : null}

      <ConsoleFilterPanel
        action="/admin/cs/reviews"
        dateRange={{
          from: filters.from,
          label: '작성일',
          presetHref: (range) => adminReviewHref(filters, {
            from: range.from,
            page: 1,
            to: range.to,
          }),
          to: filters.to,
        }}
        hiddenFields={{
          ...(filters.lowRating ? { low: '1' } : {}),
          ...(filters.reviewId ? { reviewId: filters.reviewId } : {}),
        }}
        now={now}
        resetHref={adminReviewResetHref()}
        search={{
          fields: ADMIN_REVIEW_SEARCH_FIELDS,
          fieldName: 'field',
          fieldValue: filters.field,
          placeholder: '굿즈명 · 작성자 · 리뷰 내용',
          value: filters.query,
        }}
        statusFilter={{ options: ADMIN_REVIEW_STATUS_OPTIONS, value: filters.status }}
      >
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-review-rating">평점</label>
          <select defaultValue={filters.rating} id="admin-review-rating" name="rating">
            {ADMIN_REVIEW_RATING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-review-photo">사진</label>
          <select defaultValue={filters.photo} id="admin-review-photo" name="photo">
            {ADMIN_REVIEW_PHOTO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-review-reply">답글</label>
          <select defaultValue={filters.reply} id="admin-review-reply" name="reply">
            {ADMIN_REVIEW_REPLY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <div className="admin-console-filter-field">
          <label className="admin-console-filter-label" htmlFor="admin-review-sort">정렬</label>
          <select defaultValue={filters.sort} id="admin-review-sort" name="sort">
            {ADMIN_REVIEW_SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
      </ConsoleFilterPanel>

      <ConsoleCountChips
        chips={[
          {
            active: !filters.lowRating && filters.status === 'all' && filters.reply === 'all',
            count: counts.total,
            href: adminReviewHref(filters, {
              lowRating: false,
              page: 1,
              reply: 'all',
              reviewId: null,
              status: 'all',
            }),
            label: '전체',
          },
          {
            active: filters.lowRating,
            count: counts.lowRating,
            href: adminReviewHref(filters, { lowRating: true, page: 1, reviewId: null }),
            label: `저평점(${LOW_REVIEW_RATING_MAX}점 이하)`,
            tone: 'danger',
          },
          {
            active: filters.reply === 'without',
            count: counts.awaitingReply,
            href: adminReviewHref(filters, { page: 1, reply: 'without', reviewId: null }),
            label: '답글 미등록',
            tone: 'warning',
          },
          {
            active: filters.status === 'hidden',
            count: counts.hidden,
            href: adminReviewHref(filters, { page: 1, reviewId: null, status: 'hidden' }),
            label: '블라인드',
            tone: 'info',
          },
          /* 신고 건수는 리뷰 필터로 좁힐 수 없다(신고는 별도 테이블이다).
             칩을 읽기 전용으로 두고 처리는 모더레이션 큐로 보낸다. */
          {
            count: counts.reported,
            href: '/admin/community/moderation',
            label: '미처리 신고',
            tone: 'danger',
          },
        ]}
        label="리뷰 상태별 건수"
      />

      <ConsoleGrid
        caption="리뷰 목록"
        columns={COLUMNS}
        emptyLabel="조건에 맞는 리뷰가 없습니다."
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminReviewHref(filters, { page })}
        label="리뷰 목록 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />

      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        리뷰는 배송완료된 주문의 구매자만 주문·굿즈당 한 번 남길 수 있고, 작성 기한은 배송완료 후 90일입니다.
        블라인드는 작성자 삭제와 다릅니다 — 원문과 사유가 남아 언제든 해제할 수 있습니다. 신고 건 처리는{' '}
        <Link href="/admin/community/moderation">모더레이션</Link>에서 이어집니다.
      </p>
    </section>
  );
}

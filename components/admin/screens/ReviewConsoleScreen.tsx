import { CustomerServiceTabs, CustomerServiceResultsHeader } from './CustomerServiceListParts';
import { CustomerServiceListSelect } from './CustomerServiceListControls';
import { CUSTOMER_SERVICE_PAGE_SIZES } from '@/lib/admin/customer-service-list';
import Link from 'next/link';
import { REVIEW_KIND_LABELS, REVIEW_KIND_OPTIONS, REVIEW_REPEAT_OPTIONS } from '@/lib/review-types';
import { ReviewTypePolicyPanel } from '../ReviewTypePolicyPanel';
import {
  ConsoleCountChips,
  ConsoleFilterField,
  ConsoleFilterPanel,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_REVIEW_PHOTO_OPTIONS,
  ADMIN_REVIEW_RATING_OPTIONS,
  ADMIN_REVIEW_REPLY_OPTIONS,
  ADMIN_REVIEW_BEST_OPTIONS,
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
  goodReviewsHref,
  LOW_REVIEW_RATING_MAX,
  reviewBodyPreview,
  reviewRatingLabel,
} from '@/lib/reviews';
import { ReviewActionPanel } from './ReviewActionPanel';
import { ReviewBulkGrid } from './ReviewBulkGrid';
import { REVIEW_BEST_LABELS } from '@/lib/review-best';
import { reviewExportFilters, reviewExportHref } from '@/lib/admin/review-export';
import { ReviewExportDownloadButton } from '../ReviewExportDownloadButton';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { AdminSelect } from '@/components/admin/console/AdminSelect';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
import { csChipTone } from './cs-kit-classes';

/* 어드민 리뷰 관리 콘솔(#254).
 *
 * 일반 리뷰 응대와 이벤트 선정·적립금 지급은 서로 다른 운영 표면이다.
 * 이벤트 조건과 지급 원장은 별도 리뷰이벤트 화면에서 관리한다.
 *
 * 저평점(1~2점) 바로가기는 결과 목록 위에 유지한다. 검색 조건과 결과를 분리하되
 * 낮은 별점을 바로 좁히는 동작과 실제 집계 건수는 함께 남긴다. */

/* 리뷰 내용이 좁게 꺾이지 않도록 본문 칸에 폭을 주고, 짧은 값 칸(사진·도움수·처리)을 줄였다. */
const COLUMNS: ConsoleGridColumn[] = [
  { key: 'createdAt', label: '작성일', width: '116px' },
  { key: 'good', label: '상품', width: '150px' },
  { key: 'kind', label: '리뷰 구분', width: '112px' },
  { key: 'rating', label: '평점', width: '92px' },
  { key: 'body', label: '리뷰 내용', width: '320px' },
  { key: 'photo', label: '사진', align: 'end', width: '52px' },
  { key: 'helpful', label: '리뷰도움수', align: 'end', width: '84px' },
  { key: 'author', label: '작성자', width: '130px' },
  { key: 'reports', label: '신고', align: 'end', width: '108px' },
  { key: 'status', label: '상태', width: '90px' },
  { key: 'reply', label: '답글', width: '110px' },
  { key: 'best', label: 'BEST 리뷰', width: '110px' },
  { key: 'action', label: '처리', width: '150px' },
];

/** 별점 셀. 별 문자만 두면 스크린리더가 "검은 별 검은 별..."을 읽는다. */
function ratingCell(row: AdminReviewRow) {
  return (
    <span className="relative tracking-tight whitespace-nowrap data-[low-rating=true]:font-semibold data-[low-rating=true]:text-destructive" data-low-rating={isLowReviewRating(row.rating) ? 'true' : undefined} key="rating">
      <span aria-hidden="true">{'★'.repeat(row.rating)}{'☆'.repeat(5 - row.rating)}</span>
      <span className="sr-only">{reviewRatingLabel(row.rating)}</span>
    </span>
  );
}

const TEXT_LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline';

function replyTone(replied: boolean) {
  return statusTone('question', replied ? 'answered' : 'awaiting');
}

export function ReviewConsoleScreen({
  data,
  now = new Date(),
  initialDetail,
  accountId='',
}: {
  data: AdminReviewConsoleData;
  /** 기간 프리셋 기준 시각. 테스트 주입용. */
  now?: Date;
  initialDetail?:string|null;
  accountId?:string;
}) {
  const { counts, filters, pageSize, rows, total } = data;

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => ({
    id: row.id,
    cells: [
      <span key="createdAt">
        <time className="tabular-nums" dateTime={row.createdAt}>{formatReviewDateTime(row.createdAt)}</time>
        {row.editedAt ? <><br /><span className="text-xs text-muted-foreground">수정됨</span></> : null}
      </span>,
      <Link className={TEXT_LINK_CLASS} href={goodReviewsHref(row.goodId)} key="good">{row.goodName}</Link>,
      <span key="kind">{REVIEW_KIND_LABELS[row.kind ?? 'ordinary']}<br /><span className="text-xs text-muted-foreground">{row.repeatPurchase === true ? '재구매' : row.repeatPurchase === null ? '이력 미확인' : ''}</span></span>,
      ratingCell(row),
      <span key="body">{reviewBodyPreview(row.body, 70)}</span>,
      row.imageCount > 0
        ? <span key="photo">{row.imageCount}장</span>
        : <span className="text-muted-foreground" key="photo">-</span>,
      <span key="helpful">{row.helpfulCount.toLocaleString('ko-KR')}</span>,
      <span className="block max-w-28 truncate" key="author" title={`@${row.authorName}`}>@{row.authorName}</span>,
      /* 신고가 0건인 리뷰와 "신고는 있었지만 다 처리된" 리뷰는 다른 상황이다.
         미처리 건수를 앞에 두되 총 건수도 함께 남긴다. */
      row.reportCount > 0
        ? (
          <AdminStatusBadge key="reports" render={<Link href="/admin/community/moderation" />} tone={statusTone('report', row.openReportCount > 0 ? 'open' : 'resolved')}>
            {row.openReportCount > 0 ? `${row.openReportCount}건 미처리` : `${row.reportCount}건 처리됨`}
          </AdminStatusBadge>
        )
        : <span className="text-muted-foreground" key="reports">-</span>,
      <AdminStatusBadge data-review-status={row.status} key="status" tone={statusTone('review', row.status)}>
        {ADMIN_REVIEW_STATUS_LABELS[row.status]}
      </AdminStatusBadge>,
      row.adminReply
        ? (
          <span className="flex flex-col items-start gap-0.5" key="reply">
            <AdminStatusBadge tone={replyTone(true)}>등록됨</AdminStatusBadge>
            {row.replyAuthorName ? <span className="text-xs text-muted-foreground">@{row.replyAuthorName}</span> : null}
          </span>
        )
        : <AdminStatusBadge key="reply" tone={replyTone(false)}>미등록</AdminStatusBadge>,
      /* 미선정은 대부분의 리뷰가 갖는 기본값이라 글자로 물러나고, 선정·재확인만 배지로 보인다. */
      row.best && row.best.state !== 'not_selected'
        ? <AdminStatusBadge key="best" tone={statusTone('reviewBest', row.best.state)}>{REVIEW_BEST_LABELS[row.best.state]}</AdminStatusBadge>
        : <span className="text-muted-foreground" key="best">{row.best ? REVIEW_BEST_LABELS[row.best.state] : '확인 불가'}</span>,
      <ReviewActionPanel accountId={accountId} key="action" review={row} />,
    ],
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-cs-console="reviews">
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
          pageSize: String(pageSize),
          sort: filters.sort,
          ...(filters.lowRating ? { low: '1' } : {}),
          ...(filters.reviewId ? { reviewId: filters.reviewId } : {}),
        }}
        now={now}
        resetHref={adminReviewResetHref()}
        search={{
          fields: ADMIN_REVIEW_SEARCH_FIELDS,
          fieldName: 'field',
          fieldValue: filters.field,
          placeholder: '상품명 · 작성자 · 리뷰 내용',
          value: filters.query,
        }}
        statusFilter={{ options: ADMIN_REVIEW_STATUS_OPTIONS, value: filters.status }}
      >
        <ConsoleFilterField htmlFor="review-kind" label="리뷰 구분"><AdminSelect id="review-kind" name="kind" defaultValue={filters.kind ?? 'all'} wrapperClassName="w-40">{REVIEW_KIND_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</AdminSelect></ConsoleFilterField>
        <ConsoleFilterField htmlFor="review-repeat" label="재구매"><AdminSelect id="review-repeat" name="repeat" defaultValue={filters.repeat ?? 'all'} wrapperClassName="w-44">{REVIEW_REPEAT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</AdminSelect></ConsoleFilterField>
        <ConsoleFilterField htmlFor="admin-review-rating" label="평점">
          <AdminSelect defaultValue={filters.rating} id="admin-review-rating" name="rating" wrapperClassName="w-36">
            {ADMIN_REVIEW_RATING_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </AdminSelect>
        </ConsoleFilterField>
        <ConsoleFilterField htmlFor="admin-review-photo" label="사진">
          <AdminSelect defaultValue={filters.photo} id="admin-review-photo" name="photo" wrapperClassName="w-36">
            {ADMIN_REVIEW_PHOTO_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </AdminSelect>
        </ConsoleFilterField>
        <ConsoleFilterField htmlFor="admin-review-reply" label="답글">
          <AdminSelect defaultValue={filters.reply} id="admin-review-reply" name="reply" wrapperClassName="w-36">
            {ADMIN_REVIEW_REPLY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </AdminSelect>
        </ConsoleFilterField>
        <ConsoleFilterField htmlFor="admin-review-best" label="BEST 리뷰">
          <AdminSelect defaultValue={filters.best ?? 'all'} id="admin-review-best" name="best" wrapperClassName="w-36">
            {ADMIN_REVIEW_BEST_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </AdminSelect>
        </ConsoleFilterField>
      </ConsoleFilterPanel>

      <section aria-label="리뷰 목록" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
        <CustomerServiceResultsHeader title="리뷰 목록" total={total} pageSize={pageSize} pageSizeOptions={CUSTOMER_SERVICE_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: adminReviewHref(filters, { pageSize: size, page: 1 }) }))}>
          <CustomerServiceListSelect label="리뷰 정렬" value={filters.sort} options={ADMIN_REVIEW_SORT_OPTIONS.map(option => ({ ...option, href: adminReviewHref(filters, { sort: option.value, page: 1 }) }))} />
        </CustomerServiceResultsHeader>
        <div className="flex min-w-0 flex-col gap-3">
          <CustomerServiceTabs active="reviews" />
          {/* 저평점 바로가기와 집계는 결과 목록 바로 위에서 유지한다. */}
          <div className="flex min-w-0 flex-wrap items-center gap-3" data-cs-pinned="">
            <AdminNotice className="min-w-[min(100%,18rem)] flex-1" title={<span className="tabular-nums">저평점 리뷰 {counts.lowRating.toLocaleString('ko-KR')}건</span>} tone={counts.lowRating > 0 ? 'danger' : 'neutral'}>
              {LOW_REVIEW_RATING_MAX}점 이하 리뷰입니다. 빨리 답글을 달면 다른 고객도 판매자의 대응을 함께 봅니다.
            </AdminNotice>
            <Link
              aria-current={filters.lowRating ? 'true' : undefined}
              className={buttonVariants({ size: 'sm', variant: filters.lowRating ? 'outline' : 'soft' })}
              data-slot="button"
              href={adminReviewHref(filters, { lowRating: !filters.lowRating, page: 1, reviewId: null })}
            >
              {filters.lowRating ? '저평점 필터 해제' : '저평점만 보기'}
            </Link>
          </div>

          {filters.reviewId ? (
            /* 모더레이션 큐에서 넘어온 딥링크. 한 건만 보이는 이유를 말하지 않으면
               운영자는 목록이 비었다고 읽는다. */
            <AdminNotice tone="info">
              신고된 리뷰 한 건만 보고 있습니다.{' '}
              <Link className="font-medium text-foreground underline underline-offset-4" href={adminReviewHref(filters, { page: 1, reviewId: null })}>전체 목록으로 돌아가기</Link>
            </AdminNotice>
          ) : null}

          <p className="text-xs text-muted-foreground">스토어 전체 리뷰 현황 · 검색 조건을 적용하지 않은 건수입니다.</p>
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
                tone: csChipTone('question', 'awaiting'),
              },
              {
                active: filters.status === 'hidden',
                count: counts.hidden,
                href: adminReviewHref(filters, { page: 1, reviewId: null, status: 'hidden' }),
                label: '블라인드',
                tone: csChipTone('review', 'hidden'),
              },
              /* 신고 건수는 리뷰 필터로 좁힐 수 없다(신고는 별도 테이블이다).
                 칩을 읽기 전용으로 두고 처리는 모더레이션 큐로 보낸다. */
              {
                count: counts.reported,
                href: '/admin/community/moderation',
                label: '미처리 신고',
                tone: csChipTone('report', 'open'),
              },
            ]}
            label="리뷰 상태별 건수"
          />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 border-t pt-4">
          <p className="text-sm text-muted-foreground">상세에서 원문을 확인하고 답글·BEST 선정을 관리합니다. <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/display/detail/reviews">BEST 리뷰 전시 설정</Link></p>
          <ReviewExportDownloadButton accountId={accountId} href={reviewExportHref(reviewExportFilters(filters))} total={total} />
        </div>
        <ReviewBulkGrid key={accountId}
          columns={COLUMNS}
          rows={rowsForGrid}
          reviews={rows}
          accountId={accountId}
          navigation={{ids:rows.map(row=>row.id),initialDetail,total,offset:(filters.page-1)*pageSize,
            previousPageHref:filters.page>1?adminReviewHref(filters,{page:filters.page-1}):null,
            nextPageHref:filters.page*pageSize<total?adminReviewHref(filters,{page:filters.page+1}):null}}
        />

        <ConsolePagination
          hrefForPage={(page) => adminReviewHref(filters, { page })}
          label="리뷰 목록 페이지"
          page={filters.page}
          pageSize={pageSize}
          total={total}
        />
      </section>

      {/* 설정은 목록을 밀지 않게 아래에 둔다 — 첫 화면은 처리할 리뷰가 차지한다. */}
      {accountId ? <ReviewTypePolicyPanel accountId={accountId} /> : null}

      <p className="text-sm leading-relaxed text-muted-foreground">
        일반 리뷰는 배송완료된 주문의 구매자가 주문·상품당 한 번, 배송완료 후 90일까지 작성합니다. 한달사용 리뷰는 설정된 기간에 별도로 한 번 작성합니다.
        블라인드는 작성자 삭제와 다릅니다 — 원문과 사유가 남아 언제든 해제할 수 있습니다. 신고 건 처리는{' '}
        <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/community/moderation">모더레이션</Link>에서 이어집니다.
      </p>
    </div>
  );
}

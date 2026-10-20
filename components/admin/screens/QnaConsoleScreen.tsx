import { CustomerServiceTabs, CustomerServiceResultsHeader } from './CustomerServiceListParts';
import { CustomerServiceListSelect, CustomerServiceListView } from './CustomerServiceListControls';
import { CUSTOMER_SERVICE_PAGE_SIZES } from '@/lib/admin/customer-service-list';
import Link from 'next/link';
import Image from 'next/image';
import {
  ConsoleCountChips,
  ConsoleFilterPanel,
  ConsoleGrid,
  ConsolePagination,
  type ConsoleGridColumn,
  type ConsoleGridRow,
} from '@/components/admin/console';
import {
  ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS,
  ADMIN_PRODUCT_QUESTION_SEARCH_FIELDS,
  ADMIN_PRODUCT_QUESTION_SORT_OPTIONS,
  ADMIN_PRODUCT_QUESTIONS_PATH,
  adminProductQuestionHref,
  adminProductQuestionResetHref,
  formatAdminProductQuestionDateTime,
  productQuestionBodyPreview,
  type AdminProductQuestionConsoleData,
} from '@/lib/admin/product-questions';
import { goodQuestionsHref } from '@/lib/product-questions';
import { QnaActionPanel } from './QnaActionPanel';
import { CustomerServiceRecordProvider } from './CustomerServiceRecordNavigation';

/* 어드민 상품 Q&A 콘솔 (S8 #330).
 *
 * 상품 문의는 기본 목록형으로 원문과 답변 진입점을 보여주며, 표형에서는 기존
 * 열 설정을 유지한다. 검색은 조건이 있을 때 펼치고 미답변 집계와 바로가기를
 * 결과 영역에 함께 보존한다.
 *
 * 비공개 1:1 문의와 어휘를 섞지 않는다. 여기서 다는 답변은 굿즈 상세에 공개된다. */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'createdAt', label: '작성일', width: '140px' },
  { key: 'good', label: '상품', width: '160px' },
  { key: 'body', label: '질문 내용' },
  { key: 'author', label: '작성자', width: '130px' },
  { key: 'status', label: '노출', width: '90px' },
  { key: 'answer', label: '답변', width: '130px' },
  { key: 'action', label: '처리', width: '210px' },
];

export function QnaConsoleScreen({ data, now = new Date(), initialDetail, accountId='' }: { data: AdminProductQuestionConsoleData; now?: Date; initialDetail?:string|null; accountId?:string }) {
  const { counts, filters, pageSize, rows, total } = data;
  const hasSearch = filters.status !== 'all' || Boolean(filters.from || filters.to || filters.query);

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => ({
    id: row.id,
    cells: [
      <time dateTime={row.createdAt} key="createdAt">
        {formatAdminProductQuestionDateTime(row.createdAt)}
      </time>,
      /* `#qna` 앵커만으로는 굿즈 상세가 Q&A 탭을 열지 않는다 — 공개 지면과 같은
         헬퍼를 써서 탭 파라미터까지 실어 보낸다(lib/product-questions.ts). */
      <Link href={goodQuestionsHref(row.goodId)} key="good">{row.goodName}</Link>,
      <span key="body">{productQuestionBodyPreview(row.body, 70)}</span>,
      <span key="author">@{row.authorName}</span>,
      <span data-question-status={row.hidden ? 'hidden' : 'visible'} key="status">
        {row.hidden ? '비노출' : '공개'}
      </span>,
      row.answerBody
        ? (
          <span key="answer">
            등록됨
            {row.answeredByName ? <><br /><span className="muted">@{row.answeredByName}</span></> : null}
            {row.answeredAt
              ? <><br /><span className="muted">{formatAdminProductQuestionDateTime(row.answeredAt)}</span></>
              : null}
          </span>
        )
        : <span className="muted" key="answer">미등록</span>,
      <QnaActionPanel accountId={accountId} key="action" question={row} />,
    ],
  }));

  return (
    <section className="admin-console wc-admin-kit admin-cs-console admin-cs-console--seller admin-cs-console--qna">
      <section className="admin-cs-results admin-cs-results--questions" aria-label="상품 문의 목록">
      <CustomerServiceResultsHeader title="상품 문의 목록" total={total} pageSize={pageSize} pageSizeOptions={CUSTOMER_SERVICE_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: adminProductQuestionHref(filters, { pageSize: size, page: 1 }) }))}>
        <CustomerServiceListSelect label="상품 문의 정렬" value={filters.sort ?? "recent"} options={ADMIN_PRODUCT_QUESTION_SORT_OPTIONS.map(option => ({ ...option, href: adminProductQuestionHref(filters, { sort: option.value, page: 1 }) }))} />
</CustomerServiceResultsHeader>
      <details className="admin-cs-search-disclosure" open={hasSearch}>
        <summary>검색 조건 <span aria-hidden="true">⌄</span></summary>
        <ConsoleFilterPanel
        action={ADMIN_PRODUCT_QUESTIONS_PATH}
        dateRange={{
          from: filters.from,
          to: filters.to,
          label: '문의등록일',
          presetHref: (range) => adminProductQuestionHref(filters, { ...range, page: 1 }),
        }}
        hiddenFields={{ pageSize: String(pageSize), sort: filters.sort ?? 'recent' }}
        now={now}
        search={{
          fields: [...ADMIN_PRODUCT_QUESTION_SEARCH_FIELDS],
          fieldName: 'field',
          fieldValue: filters.field ?? 'body',
          placeholder: '문의 내용 · 상품명 · 상품번호 · 문의번호',
          value: filters.query,
        }}
        resetHref={adminProductQuestionResetHref()}
        statusFilter={{
          label: '처리 상태',
          options: ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS,
          value: filters.status,
        }}
        submitLabel="조회"
      />
      </details>
      <CustomerServiceRecordProvider key={accountId} ids={rows.map(row=>row.id)} initialDetail={initialDetail} total={total} offset={(filters.page-1)*pageSize}
        previousPageHref={filters.page>1?adminProductQuestionHref(filters,{page:filters.page-1}):null}
        nextPageHref={filters.page*pageSize<total?adminProductQuestionHref(filters,{page:filters.page+1}):null}>
      <CustomerServiceListView list={rows.length ? <ul className="admin-cs-question-list">{rows.map(row => <li key={row.id} data-has-image={Boolean(row.goodImageUrl)}>
        {row.goodImageUrl ? <Link className="admin-cs-question-list__image" href={goodQuestionsHref(row.goodId)}><Image src={row.goodImageUrl} alt={row.goodName} width={110} height={110} unoptimized /></Link> : null}
        <div className="admin-cs-question-list__content">
        <header><span className="admin-cs-question-list__state">{row.answerBody ? '답변 등록됨' : '답변 미등록'}</span><Link href={goodQuestionsHref(row.goodId)}>{row.goodName}</Link><span data-question-status={row.hidden ? 'hidden' : 'visible'}>{row.hidden ? '비노출' : '공개'}</span></header>
        <p className="admin-cs-question-list__meta"><span>상품번호 {row.goodId}</span><span>@{row.authorName}</span><time dateTime={row.createdAt}>{formatAdminProductQuestionDateTime(row.createdAt)}</time></p>
        <p className="admin-cs-question-list__body">{productQuestionBodyPreview(row.body, 180)}</p>
        <div className="admin-cs-question-list__actions"><QnaActionPanel inline accountId={accountId} question={row} triggerLabel={row.answerBody ? '답변 확인 · 수정' : '답변 등록'} />{row.answeredByName ? <span>@{row.answeredByName}{row.answeredAt ? ` · ${formatAdminProductQuestionDateTime(row.answeredAt)}` : ''}</span> : null}</div>
        </div>
      </li>)}</ul> : <p className="admin-cs-question-list__empty">조건에 맞는 질문이 없습니다.</p>} table={<ConsoleGrid
        caption="상품 Q&A 목록"
        preferencesKey="cs-qna"
        columns={COLUMNS}
        emptyLabel="조건에 맞는 질문이 없습니다."
        rows={rowsForGrid}
      />} />
      </CustomerServiceRecordProvider>

      <ConsolePagination
        hrefForPage={(page) => adminProductQuestionHref(filters, { page })}
        label="상품 Q&A 목록 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />
      <div className="admin-cs-results__context">
      <CustomerServiceTabs active="qna" />
      {/* 목록 표시 방식과 무관하게 미답변 집계와 바로가기를 유지한다. */}
      <div className="admin-console-pinned-filter card wc-admin-kit wc-admin-kit__card">
        <div className="col" style={{ gap: 4, minWidth: 0 }}>
          <strong style={{ fontSize: 14 }}>
            답변 미등록 {counts.unanswered.toLocaleString('ko-KR')}건
          </strong>
          <span className="muted" style={{ fontSize: 12.5 }}>
            구매 전 질문입니다. 답이 늦으면 그대로 이탈로 남습니다.
          </span>
        </div>
        <Link
          aria-current={filters.status === 'unanswered' ? 'true' : undefined}
          className={`btn btn-sm${filters.status === 'unanswered' ? '' : ' btn-ghost'}`}
          href={adminProductQuestionHref(filters, {
            page: 1,
            status: filters.status === 'unanswered' ? 'all' : 'unanswered',
          })}
        >
          {filters.status === 'unanswered' ? '미답변 필터 해제' : '미답변만 보기'}
        </Link>
      </div>

      <ConsoleCountChips
        chips={[
          {
            active: filters.status === 'all',
            count: counts.total,
            href: adminProductQuestionHref(filters, { page: 1, status: 'all' }),
            label: '전체',
          },
          {
            active: filters.status === 'unanswered',
            count: counts.unanswered,
            href: adminProductQuestionHref(filters, { page: 1, status: 'unanswered' }),
            label: '답변 미등록',
            tone: 'warning',
          },
          {
            active: filters.status === 'answered',
            count: counts.answered,
            href: adminProductQuestionHref(filters, { page: 1, status: 'answered' }),
            label: '답변 완료',
            tone: 'success',
          },
          {
            active: filters.status === 'hidden',
            count: counts.hidden,
            href: adminProductQuestionHref(filters, { page: 1, status: 'hidden' }),
            label: '비노출',
            tone: 'info',
          },
        ]}
        label="상품 Q&A 상태별 건수"
      />

      </div>
      </section>

      <p className="admin-cs-help">
        상품 Q&A는 상품 상세에 공개로 붙는 구매 전 질문입니다 — 비공개 1:1{' '}
        <Link href="/admin/cs/inquiries">문의</Link>와 다릅니다. 답변을 저장하면 작성자에게 알림이
        가고, 답변을 고칠 때마다 알림이 다시 갑니다. 비노출은 작성자 삭제와 다릅니다: 원문이 남고
        작성자에게는 계속 보이며 언제든 되돌릴 수 있습니다.
      </p>
    </section>
  );
}

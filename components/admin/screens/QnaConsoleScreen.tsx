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
  ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS,
  ADMIN_PRODUCT_QUESTIONS_PATH,
  adminProductQuestionHref,
  adminProductQuestionResetHref,
  formatAdminProductQuestionDateTime,
  productQuestionBodyPreview,
  type AdminProductQuestionConsoleData,
} from '@/lib/admin/product-questions';
import { goodQuestionsHref } from '@/lib/product-questions';
import { QnaActionPanel } from './QnaActionPanel';

/* 어드민 상품 Q&A 콘솔 (S8 #330).
 *
 * 리뷰 콘솔과 같은 목록 구조(필터 → 카운트 칩 → 그리드)를 쓴다. 다른 점은 급한
 * 것이 무엇인가다 — 리뷰에서는 저평점이지만 Q&A에서는 답변 미등록이다. 구매 전
 * 질문은 답이 늦으면 그대로 이탈이 되므로 미답변 건수를 맨 위에 고정한다.
 *
 * 비공개 1:1 문의와 어휘를 섞지 않는다. 여기서 다는 답변은 굿즈 상세에 공개된다. */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'createdAt', label: '작성일', width: '140px' },
  { key: 'good', label: '굿즈', width: '160px' },
  { key: 'body', label: '질문 내용' },
  { key: 'author', label: '작성자', width: '130px' },
  { key: 'status', label: '노출', width: '90px' },
  { key: 'answer', label: '답변', width: '130px' },
  { key: 'action', label: '처리', width: '210px' },
];

export function QnaConsoleScreen({ data }: { data: AdminProductQuestionConsoleData }) {
  const { counts, filters, pageSize, rows, total } = data;

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
      <QnaActionPanel key="action" question={row} />,
    ],
  }));

  return (
    <section className="admin-console">
      {/* 미답변 고정 줄. 목록의 어떤 조건보다 먼저 읽혀야 하는 한 줄이다 —
          구매 전 질문은 답이 늦을수록 판매 기회 자체가 사라진다. */}
      <div className="admin-console-pinned-filter card">
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

      <ConsoleFilterPanel
        action={ADMIN_PRODUCT_QUESTIONS_PATH}
        resetHref={adminProductQuestionResetHref()}
        statusFilter={{
          label: '처리 상태',
          options: ADMIN_PRODUCT_QUESTION_STATUS_OPTIONS,
          value: filters.status,
        }}
        submitLabel="조회"
      />

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

      <ConsoleGrid
        caption="상품 Q&A 목록"
        columns={COLUMNS}
        emptyLabel="조건에 맞는 질문이 없습니다."
        rows={rowsForGrid}
      />

      <ConsolePagination
        hrefForPage={(page) => adminProductQuestionHref(filters, { page })}
        label="상품 Q&A 목록 페이지"
        page={filters.page}
        pageSize={pageSize}
        total={total}
      />

      <p className="muted" style={{ fontSize: 12.5, margin: 0 }}>
        상품 Q&A는 굿즈 상세에 공개로 붙는 구매 전 질문입니다 — 비공개 1:1{' '}
        <Link href="/admin/cs/inquiries">문의</Link>와 다릅니다. 답변을 저장하면 작성자에게 알림이
        가고, 답변을 고칠 때마다 알림이 다시 갑니다. 비노출은 작성자 삭제와 다릅니다: 원문이 남고
        작성자에게는 계속 보이며 언제든 되돌릴 수 있습니다.
      </p>
    </section>
  );
}

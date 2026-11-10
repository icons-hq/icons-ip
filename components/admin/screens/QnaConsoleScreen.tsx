import { CustomerServiceTabs, CustomerServiceResultsHeader } from './CustomerServiceListParts';
import { CustomerServiceListSelect, CustomerServiceListView } from './CustomerServiceListControls';
import { CUSTOMER_SERVICE_PAGE_SIZES } from '@/lib/admin/customer-service-list';
import Link from 'next/link';
import Image from 'next/image';
import { ChevronDown, ExternalLink, Image as ImageIcon, ListFilter } from 'lucide-react';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
import { statusTone } from '@/lib/admin/status-tone';
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
import { AdminPendingCountLink } from '../AdminOpenInquiryBadge';
import { QnaActionPanel } from './QnaActionPanel';
import { CustomerServiceRecordProvider } from './CustomerServiceRecordNavigation';
import { csChipTone } from './cs-kit-classes';

/* 어드민 상품 Q&A 콘솔 (S8 #330).
 *
 * 상품 문의는 기본 목록형으로 원문과 답변 진입점을 보여주며, 표형에서는 기존
 * 열 설정을 유지한다. 검색은 조건이 있을 때 펼치고 미답변 집계와 바로가기를
 * 결과 영역에 함께 보존한다.
 *
 * 비공개 1:1 문의와 어휘를 섞지 않는다. 여기서 다는 답변은 굿즈 상세에 공개된다 — 비밀글
 * (MD-0023)만 예외로, 원문과 답변이 작성자와 운영자에게만 보이고 공개 화면에는 자리만 남는다.
 *
 * 템플릿 룩(ADR-0028): 결과 카드 안에 머리 → 검색 조건(접기) → 목록/표 → 페이지 → 상태 바로가기 순서 그대로다. */

const COLUMNS: ConsoleGridColumn[] = [
  { key: 'createdAt', label: '작성일', width: '140px' },
  { key: 'good', label: '상품', width: '160px' },
  { key: 'body', label: '질문 내용' },
  { key: 'author', label: '작성자', width: '130px' },
  { key: 'status', label: '노출', width: '90px' },
  { key: 'answer', label: '답변', width: '130px' },
  { key: 'action', label: '처리', width: '210px' },
];

const TEXT_LINK_CLASS = 'font-medium text-primary underline-offset-4 hover:underline';
/** 목록형의 상품 링크. 질문이 이 줄의 주인공이라 상품명은 회색으로 물러난다. 공개 상품 화면이라 새 창으로 연다. */
const META_LINK_CLASS = 'inline-flex max-w-[24rem] items-center gap-1 underline-offset-4 hover:text-foreground hover:underline';

/** 비밀글(MD-0023)은 콘솔에서 원문이 보이므로, 공개 화면에서는 가려진다는 것을 문구로 표시한다. */
function SecretBadge() {
  return <AdminStatusBadge data-secret-badge="" tone="neutral">비밀글</AdminStatusBadge>;
}

function answerTone(answered: boolean) {
  return statusTone('question', answered ? 'answered' : 'awaiting');
}

const DAY_MS = 86_400_000;

/** 24시간을 넘긴 미답변 질문의 대기 일수. 그 밖에는 null(고객문의 목록과 같은 표시). */
function waitingDays(row: { answerBody: string | null; createdAt: string }, now: Date) {
  if (row.answerBody) return null;
  const days = Math.floor((now.getTime() - Date.parse(row.createdAt)) / DAY_MS);
  return days >= 1 ? days : null;
}

function WaitingBadge({ days }: { days: number | null }) {
  return days === null ? null : <AdminStatusBadge title="답변 미등록 24시간 경과" tone="warning">{days}일 경과</AdminStatusBadge>;
}

export function QnaConsoleScreen({ data, now = new Date(), initialDetail, accountId='' }: { data: AdminProductQuestionConsoleData; now?: Date; initialDetail?:string|null; accountId?:string }) {
  const { counts, filters, pageSize, rows, total } = data;
  const hasSearch = filters.status !== 'all' || Boolean(filters.from || filters.to || filters.query);

  const rowsForGrid: ConsoleGridRow[] = rows.map((row) => ({
    id: row.id,
    cells: [
      <time className="tabular-nums" dateTime={row.createdAt} key="createdAt">
        {formatAdminProductQuestionDateTime(row.createdAt)}
      </time>,
      /* `#qna` 앵커만으로는 굿즈 상세가 Q&A 탭을 열지 않는다 — 공개 지면과 같은
         헬퍼를 써서 탭 파라미터까지 실어 보낸다(lib/product-questions.ts). */
      <Link className={TEXT_LINK_CLASS} href={goodQuestionsHref(row.goodId)} key="good" rel="noopener noreferrer" target="_blank" title="쇼핑몰 상품 화면을 새 창으로 엽니다">{row.goodName}</Link>,
      <span key="body">{productQuestionBodyPreview(row.body, 70)}</span>,
      <span key="author">@{row.authorName}</span>,
      <span className="flex flex-col items-start gap-1" key="status">
        <AdminStatusBadge data-question-status={row.hidden ? 'hidden' : 'visible'} tone={statusTone('questionVisibility', row.hidden ? 'hidden' : 'visible')}>{row.hidden ? '비노출' : '공개'}</AdminStatusBadge>
        {row.secret ? <SecretBadge /> : null}
      </span>,
      row.answerBody
        ? (
          <span className="flex flex-col items-start gap-0.5" key="answer">
            <AdminStatusBadge tone={answerTone(true)}>등록됨</AdminStatusBadge>
            {row.answeredByName ? <span className="text-xs text-muted-foreground">@{row.answeredByName}</span> : null}
            {row.answeredAt
              ? <span className="text-xs text-muted-foreground tabular-nums">{formatAdminProductQuestionDateTime(row.answeredAt)}</span>
              : null}
          </span>
        )
        : <span className="flex flex-col items-start gap-1" key="answer"><AdminStatusBadge tone={answerTone(false)}>미등록</AdminStatusBadge><WaitingBadge days={waitingDays(row, now)} /></span>,
      <QnaActionPanel accountId={accountId} key="action" question={row} />,
    ],
  }));

  return (
    <div className="flex min-w-0 flex-col gap-4" data-cs-console="qna">
      <section aria-label="상품 문의 목록" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
        {/* 상태별 집계는 목록 아래가 계약이다. 밀린 건수와 바로가기만 목록 제목 옆에 둔다(0건이면 그리지 않는다). */}
        <CustomerServiceResultsHeader aside={counts.unanswered > 0 ? <AdminPendingCountLink count={counts.unanswered} href={adminProductQuestionHref(filters, { page: 1, status: 'unanswered' })}><span>답변 미등록 상품 문의</span></AdminPendingCountLink> : null} title="상품 문의 목록" total={total} pageSize={pageSize} pageSizeOptions={CUSTOMER_SERVICE_PAGE_SIZES.map(size => ({ value: String(size), label: `${size}개씩`, href: adminProductQuestionHref(filters, { pageSize: size, page: 1 }) }))}>
          <CustomerServiceListSelect label="상품 문의 정렬" value={filters.sort ?? "recent"} options={ADMIN_PRODUCT_QUESTION_SORT_OPTIONS.map(option => ({ ...option, href: adminProductQuestionHref(filters, { sort: option.value, page: 1 }) }))} />
        </CustomerServiceResultsHeader>
        <CustomerServiceRecordProvider key={accountId} ids={rows.map(row=>row.id)} initialDetail={initialDetail} total={total} offset={(filters.page-1)*pageSize}
          previousPageHref={filters.page>1?adminProductQuestionHref(filters,{page:filters.page-1}):null}
          nextPageHref={filters.page*pageSize<total?adminProductQuestionHref(filters,{page:filters.page+1}):null}>
          <CustomerServiceListView toolbar={
            <details className="group/search" data-cs-search="" open={hasSearch}>
              <summary className={`${buttonVariants({ size: 'sm', variant: 'outline' })} w-fit list-none [&::-webkit-details-marker]:hidden`} data-slot="button"><ListFilter aria-hidden="true" />검색 조건 <ChevronDown aria-hidden="true" className="transition-transform group-open/search:rotate-180" /></summary>
              <ConsoleFilterPanel
                action={ADMIN_PRODUCT_QUESTIONS_PATH}
                className="mt-3"
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
          } list={rows.length ? <ul className="flex flex-col divide-y" data-cs-question-list="">{rows.map(row => <li className={`grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 py-3.5 first:pt-1 last:pb-1 sm:grid-cols-[3.5rem_minmax(0,1fr)_auto] ${row.answerBody ? '' : 'pl-3 shadow-[inset_2px_0_var(--warning)]'}`} key={row.id} data-has-image={Boolean(row.goodImageUrl)}>
            {row.goodImageUrl ? <Link className="block size-14 overflow-hidden rounded-lg border bg-muted" href={goodQuestionsHref(row.goodId)} rel="noopener noreferrer" target="_blank"><Image className="size-full object-contain" src={row.goodImageUrl} alt={row.goodName} width={56} height={56} unoptimized /></Link> : <span aria-hidden="true" className="grid size-14 place-items-center rounded-lg border bg-muted text-muted-foreground"><ImageIcon className="size-5" /></span>}
            <div className="flex min-w-0 flex-col gap-1.5">
              {/* 답변 상태 다음에 고객 질문이 먼저 온다. 상품·작성자는 그 아래 회색 줄이다. 공개는 기본 상태라 글자로 물러나고, 비노출만 배지로 보인다. */}
              <header className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"><AdminStatusBadge tone={answerTone(Boolean(row.answerBody))}>{row.answerBody ? '답변 등록됨' : '답변 미등록'}</AdminStatusBadge><WaitingBadge days={waitingDays(row, now)} />{row.hidden ? <AdminStatusBadge data-question-status="hidden" tone={statusTone('questionVisibility', 'hidden')}>비노출</AdminStatusBadge> : null}{row.secret ? <SecretBadge /> : null}</header>
              <p className="text-sm leading-snug font-medium text-foreground wrap-anywhere">{productQuestionBodyPreview(row.body, 180)}</p>
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground [&>*+*]:border-l [&>*+*]:pl-2.5"><Link className={META_LINK_CLASS} href={goodQuestionsHref(row.goodId)} rel="noopener noreferrer" target="_blank" title={row.goodName}><span className="truncate">{row.goodName}</span><ExternalLink aria-hidden="true" className="size-3 shrink-0" /></Link><span className="tabular-nums">상품번호 {row.goodId}</span><span>@{row.authorName}</span><time className="tabular-nums" dateTime={row.createdAt}>{formatAdminProductQuestionDateTime(row.createdAt)}</time>{row.answeredByName ? <span>답변 @{row.answeredByName}{row.answeredAt ? ` · ${formatAdminProductQuestionDateTime(row.answeredAt)}` : ''}</span> : null}{row.hidden ? null : <span data-question-status="visible">공개</span>}</p>
            </div>
            {/* 고객문의 표처럼 줄 오른쪽 한 자리에 처리 버튼을 둔다. 펼친 답변 패널(section)은 줄 전체를 쓴다. */}
            <div className="contents [&>button]:justify-self-end [&>button]:self-center max-sm:[&>button]:col-start-2 max-sm:[&>button]:justify-self-start [&>section]:col-span-full"><QnaActionPanel inline accountId={accountId} question={row} triggerLabel={row.answerBody ? '답변 확인 · 수정' : '답변 등록'} /></div>
          </li>)}</ul> : <p className="py-12 text-center text-sm text-muted-foreground">조건에 맞는 질문이 없습니다.</p>} table={<ConsoleGrid
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
        <div className="flex min-w-0 flex-col gap-3 border-t pt-4">
          <CustomerServiceTabs active="qna" />
          {/* 목록 표시 방식과 무관하게 미답변 집계와 바로가기를 유지한다. */}
          <div className="flex min-w-0 flex-wrap items-center gap-3" data-cs-pinned="">
            <AdminNotice className="min-w-[min(100%,18rem)] flex-1" title={<span className="tabular-nums">답변 미등록 {counts.unanswered.toLocaleString('ko-KR')}건</span>} tone={counts.unanswered > 0 ? 'warning' : 'neutral'}>
              구매 전 질문입니다. 답이 늦으면 그대로 이탈로 남습니다.
            </AdminNotice>
            <Link
              aria-current={filters.status === 'unanswered' ? 'true' : undefined}
              className={buttonVariants({ size: 'sm', variant: filters.status === 'unanswered' ? 'outline' : 'soft' })}
              data-slot="button"
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
                tone: csChipTone('question', 'awaiting'),
              },
              {
                active: filters.status === 'answered',
                count: counts.answered,
                href: adminProductQuestionHref(filters, { page: 1, status: 'answered' }),
                label: '답변 완료',
                tone: csChipTone('question', 'answered'),
              },
              {
                active: filters.status === 'hidden',
                count: counts.hidden,
                href: adminProductQuestionHref(filters, { page: 1, status: 'hidden' }),
                label: '비노출',
                tone: csChipTone('question', 'hidden'),
              },
            ]}
            label="상품 Q&A 상태별 건수"
          />
        </div>
      </section>

      <p className="text-sm leading-relaxed text-muted-foreground">
        상품 Q&A는 상품 상세에 공개로 붙는 구매 전 질문입니다 — 비공개 1:1{' '}
        <Link className="font-medium text-foreground underline underline-offset-4" href="/admin/cs/inquiries">문의</Link>와 다릅니다. 답변을 저장하면 작성자에게 알림이
        가고, 답변을 고칠 때마다 알림이 다시 갑니다. 비노출은 작성자 삭제와 다릅니다: 원문이 남고
        작성자에게는 계속 보이며 언제든 되돌릴 수 있습니다.
      </p>
    </div>
  );
}

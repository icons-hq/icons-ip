import Link from 'next/link';
import { Plus } from 'lucide-react';
import { AdminPageHeader, AdminStatusBadge } from '../console/AdminKit';
import { ConsolePagination } from '../console';
import { ConsoleTableHeader } from '../console/ConsoleListCard';
import { AdminSelect } from '../console/AdminSelect';
import { ReviewEventExportButton } from '../ReviewEventExportButton';
import { Button, buttonVariants } from '@/components/admin/kit/ui/button';
import { Input } from '@/components/admin/kit/ui/input';
import { Table, TableBody, TableCell, TableHead, TableRow } from '@/components/admin/kit/ui/table';
import { reviewEventExportHref } from '@/lib/admin/review-event-export';
import { statusTone } from '@/lib/admin/status-tone';
import { REVIEW_EVENTS_ADMIN_PATH, REVIEW_EVENT_STATES, reviewEventStateLabel, reviewEventAdminHref, type ReviewEventList } from '@/lib/review-events';
import { FIELD_LABEL_CLASS } from './cs-kit-classes';

const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5';
const SUB_CLASS = 'block text-xs text-muted-foreground';

/* 템플릿 룩(ADR-0028): 조회 조건 카드 → 건수·엑셀 → kit 표 → 페이지. 조회 키(q·state·dateField·from·to·pageSize)는 그대로다. */
export function ReviewEventListScreen({ data }: { data: ReviewEventList }) {
  const { filters, rows, total } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-review-events="list">
    <AdminPageHeader title="리뷰이벤트" description="구매 리뷰를 모집하고, 선정한 고객에게 적립금 혜택을 지급합니다." actions={<Link className={buttonVariants()} data-slot="button" href={`${REVIEW_EVENTS_ADMIN_PATH}/new`}><Plus aria-hidden="true" />이벤트 등록</Link>} />
    <form className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" method="get">
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <label className={`${LABEL_CLASS} sm:col-span-2 lg:col-span-1 xl:col-span-2`}><span className={FIELD_LABEL_CLASS}>이벤트명·번호</span><Input name="q" defaultValue={filters.query} maxLength={100} /></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>상태</span><AdminSelect name="state" defaultValue={filters.state}><option value="all">전체 (보관 제외)</option>{REVIEW_EVENT_STATES.map(state => <option key={state} value={state}>{reviewEventStateLabel[state]}</option>)}</AdminSelect></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>기간 기준</span><AdminSelect name="dateField" defaultValue={filters.dateField}><option value="created">등록일</option><option value="start">시작일</option><option value="end">종료일</option><option value="announce">발표일</option></AdminSelect></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>시작 날짜</span><Input type="date" name="from" defaultValue={filters.from} /></label><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>종료 날짜</span><Input type="date" name="to" defaultValue={filters.to} /></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>목록 수</span><AdminSelect name="pageSize" defaultValue={filters.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</AdminSelect></label>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={REVIEW_EVENTS_ADMIN_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </form>
    <section aria-label="리뷰이벤트 목록" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <p className="text-sm lg:shrink-0">전체 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>건 <span className="text-muted-foreground">· 날짜는 한국 시각 기준입니다.</span></p>
        <ReviewEventExportButton total={total} href={reviewEventExportHref({ mode: 'events', query: filters.query, state: filters.state, dateField: filters.dateField, from: filters.from || null, to: filters.to || null })} />
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border"><Table className="min-w-[53rem]"><caption className="sr-only">리뷰이벤트 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>번호 / 이벤트명</TableHead><TableHead>상태</TableHead><TableHead>응모기간 / 발표일</TableHead><TableHead className="text-right">선정 혜택</TableHead><TableHead className="text-right">응모 / 선정 / 지급</TableHead><TableHead>관리</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {rows.map(event => <TableRow key={event.id}><TableCell className="max-w-80 align-top whitespace-normal"><small className={SUB_CLASS}>#{event.number}</small><strong className="block font-medium text-foreground wrap-anywhere">{event.title}</strong><span className={SUB_CLASS}>{event.description}</span></TableCell><TableCell className="align-top"><AdminStatusBadge tone={statusTone('reviewEvent', event.state)}>{reviewEventStateLabel[event.state]}</AdminStatusBadge></TableCell><TableCell className="align-top tabular-nums">{event.startsOn} ~ {event.endsOn}<small className={SUB_CLASS}>발표 {event.announcesOn}</small></TableCell><TableCell className="text-right align-top tabular-nums">1인 {event.creditAmount.toLocaleString('ko-KR')}원<small className={SUB_CLASS}>예정 {event.plannedWinners}명</small></TableCell><TableCell className="text-right align-top tabular-nums">{event.entryCount} / {event.selectedCount} / {event.awardedCount}<small className={SUB_CLASS}>회수 {event.revokedCount}건</small></TableCell><TableCell className="align-top"><Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={`${REVIEW_EVENTS_ADMIN_PATH}/${event.id}`}>상세 관리</Link></TableCell></TableRow>)}
        {!rows.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>조건에 맞는 리뷰이벤트가 없습니다.</TableCell></TableRow> : null}
      </TableBody></Table></div>
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => reviewEventAdminHref(filters, page)} />
    </section>
  </div>;
}

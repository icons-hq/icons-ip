import Link from 'next/link';
import { ChevronDown, Download, Plus } from 'lucide-react';
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
import { REVIEW_EVENTS_ADMIN_PATH, REVIEW_EVENT_STATES, REVIEW_EVENT_TEMPLATES_ADMIN_PATH, reviewEventStateLabel, reviewEventAdminHref, type ReviewEventList, type ReviewEventState } from '@/lib/review-events';
import { FIELD_LABEL_CLASS } from './cs-kit-classes';

const LABEL_CLASS = 'flex min-w-0 flex-col gap-1.5';
const SUB_CLASS = 'block text-xs text-muted-foreground';
/** 저장값은 한국 시각 날짜(YYYY-MM-DD)다. 다른 화면과 같은 표기로 보인다. */
const eventDate = (value: string) => `${value.replaceAll('-', '. ')}.`;
/** 줄의 버튼이 왜 강조되는지 말한다 — 응모가 끝나 운영자가 처리할 단계만 있다. */
const NEXT_STEP: Partial<Record<ReviewEventState, string>> = { closed: '당첨자 선정 필요', ready: '발표·지급 필요' };
const KST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
/** 한국 날짜 기준으로 발표일까지 남은 날. 지났으면 음수다. */
const daysUntil = (date: string, now: Date) => Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${KST_DATE.format(now)}T00:00:00Z`)) / 86_400_000);

/** 발표 전 처리 단계의 발표일 임박 표시. 사흘 안이면 주의색, 지났으면 위험색이다. */
function AnnounceDue({ days }: { days: number }) {
  return <AdminStatusBadge tone={days < 0 ? 'danger' : days <= 3 ? 'warning' : 'neutral'}>{days > 0 ? `D-${days}` : days === 0 ? '오늘 발표' : `발표일 ${-days}일 지남`}</AdminStatusBadge>;
}

/* 템플릿 룩(ADR-0028): 조회 조건 카드 → 건수·엑셀 → kit 표 → 페이지. 조회 키(q·state·dateField·from·to·pageSize)는 그대로다. */
export function ReviewEventListScreen({ data, now = new Date() }: { data: ReviewEventList; /** 발표일 계산 기준 시각. 테스트 주입용. */ now?: Date }) {
  const { filters, rows, total } = data;
  return <div className="flex min-w-0 flex-col gap-4" data-review-events="list">
    <AdminPageHeader title="리뷰이벤트" description="구매 리뷰를 모집하고, 선정한 고객에게 적립금 혜택을 지급합니다." actions={<>
      {/* SHEET-017: 이벤트명·내용 문구 템플릿. 등록 화면의 "템플릿 불러오기"와 같은 목록이다. */}
      <Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href={REVIEW_EVENT_TEMPLATES_ADMIN_PATH}>문구 템플릿</Link>
      <Link className={buttonVariants()} data-slot="button" href={`${REVIEW_EVENTS_ADMIN_PATH}/new`}><Plus aria-hidden="true" />이벤트 등록</Link></>} />
    <form className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground" method="get">
      <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
        <label className={`${LABEL_CLASS} sm:col-span-2 lg:col-span-1`}><span className={FIELD_LABEL_CLASS}>이벤트명·번호</span><Input name="q" defaultValue={filters.query} maxLength={100} /></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>상태</span><AdminSelect name="state" defaultValue={filters.state}><option value="all">전체 (보관 제외)</option>{REVIEW_EVENT_STATES.map(state => <option key={state} value={state}>{reviewEventStateLabel[state]}</option>)}</AdminSelect></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>기간 기준</span><AdminSelect name="dateField" defaultValue={filters.dateField}><option value="created">등록일</option><option value="start">시작일</option><option value="end">종료일</option><option value="announce">발표일</option></AdminSelect></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>시작 날짜</span><Input type="date" name="from" defaultValue={filters.from} /></label><label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>종료 날짜</span><Input type="date" name="to" defaultValue={filters.to} /></label>
        <label className={LABEL_CLASS}><span className={FIELD_LABEL_CLASS}>목록 수</span><AdminSelect name="pageSize" defaultValue={filters.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</AdminSelect></label>
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Link className={buttonVariants({ variant: 'ghost' })} data-slot="button" href={REVIEW_EVENTS_ADMIN_PATH}>초기화</Link><Button type="submit" variant="soft">검색</Button></div>
    </form>
    <section aria-label="리뷰이벤트 목록" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4 text-card-foreground">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <p className="text-sm lg:shrink-0">전체 <strong className="font-semibold text-foreground tabular-nums">{total.toLocaleString('ko-KR')}</strong>건 <span className="text-muted-foreground">· 날짜는 한국 시각 기준입니다.</span></p>
        {/* 내려받기는 가끔 하는 보조 작업이다 — 파일 책임 확인 문구가 이벤트 목록보다 먼저 읽히지 않게 펼쳐서 쓴다. */}
        <details className="group/export min-w-0" data-review-event-export-toggle="">
          <summary className={buttonVariants({ size: 'sm', variant: 'outline', className: 'flex w-fit cursor-pointer list-none lg:ml-auto [&::-webkit-details-marker]:hidden' })} data-slot="button"><Download aria-hidden="true" />엑셀 다운로드 <ChevronDown aria-hidden="true" className="transition-transform group-open/export:rotate-180" /></summary>
          <div className="mt-2"><ReviewEventExportButton total={total} href={reviewEventExportHref({ mode: 'events', query: filters.query, state: filters.state, dateField: filters.dateField, from: filters.from || null, to: filters.to || null })} /></div>
        </details>
      </div>
      <div className="min-w-0 overflow-hidden rounded-lg border"><Table className="min-w-[53rem]"><caption className="sr-only">리뷰이벤트 목록</caption><ConsoleTableHeader><TableRow className="hover:bg-transparent"><TableHead>번호 / 이벤트명</TableHead><TableHead>상태</TableHead><TableHead>응모기간 / 발표일</TableHead><TableHead className="text-right">선정 혜택</TableHead><TableHead className="text-right">응모 / 선정 / 지급</TableHead><TableHead>관리</TableHead></TableRow></ConsoleTableHeader><TableBody>
        {rows.map(event => <TableRow key={event.id}><TableCell className="max-w-80 align-top whitespace-normal"><small className={SUB_CLASS}>#{event.number}</small><strong className="block font-medium text-foreground wrap-anywhere">{event.title}</strong><span className={SUB_CLASS}>{event.description}</span></TableCell><TableCell className="align-top"><span className="flex flex-col items-start gap-1"><AdminStatusBadge tone={statusTone('reviewEvent', event.state)}>{reviewEventStateLabel[event.state]}</AdminStatusBadge>{NEXT_STEP[event.state] ? <span className="text-xs font-medium text-foreground">{NEXT_STEP[event.state]}</span> : null}</span></TableCell><TableCell className="align-top tabular-nums">{eventDate(event.startsOn)} ~ {eventDate(event.endsOn)}<span className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">발표 {eventDate(event.announcesOn)}{NEXT_STEP[event.state] ? <AnnounceDue days={daysUntil(event.announcesOn, now)} /> : null}</span></TableCell><TableCell className="text-right align-top tabular-nums">1인 {event.creditAmount.toLocaleString('ko-KR')}원<small className={SUB_CLASS}>예정 {event.plannedWinners}명</small></TableCell><TableCell className="text-right align-top tabular-nums">{event.entryCount} / {event.selectedCount} / {event.awardedCount}<small className={SUB_CLASS}>회수 {event.revokedCount}건</small></TableCell><TableCell className="align-top"><Link className={buttonVariants({ size: 'sm', variant: event.state === 'closed' || event.state === 'ready' ? 'soft' : event.state === 'announced' || event.state === 'archived' ? 'ghost' : 'outline' })} data-slot="button" href={`${REVIEW_EVENTS_ADMIN_PATH}/${event.id}`}>상세 관리</Link></TableCell></TableRow>)}
        {!rows.length ? <TableRow><TableCell className="h-24 text-center text-muted-foreground" colSpan={6}>조건에 맞는 리뷰이벤트가 없습니다.</TableCell></TableRow> : null}
      </TableBody></Table></div>
      <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => reviewEventAdminHref(filters, page)} />
    </section>
  </div>;
}

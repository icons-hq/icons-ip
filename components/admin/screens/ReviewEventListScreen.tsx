import Link from 'next/link';
import { AdminPageHeader } from '../console/AdminKit';
import { ConsolePagination } from '../console';
import { ReviewEventExportButton } from '../ReviewEventExportButton';
import { reviewEventExportHref } from '@/lib/admin/review-event-export';
import { REVIEW_EVENTS_ADMIN_PATH, REVIEW_EVENT_STATES, reviewEventStateLabel, reviewEventAdminHref, type ReviewEventList } from '@/lib/review-events';

export function ReviewEventListScreen({ data }: { data: ReviewEventList }) {
  const { filters, rows, total } = data;
  return <section className="wc-admin-kit wc-admin-kit__screen admin-review-events">
    <AdminPageHeader title="리뷰이벤트" description="구매 리뷰를 모집하고, 선정한 고객에게 적립금 혜택을 지급합니다." actions={<Link className="btn btn-primary" href={`${REVIEW_EVENTS_ADMIN_PATH}/new`}>이벤트 등록</Link>} />
    <form className="admin-review-events__panel admin-review-events__filters" method="get">
      <label>이벤트명·번호<input name="q" defaultValue={filters.query} maxLength={100} /></label>
      <label>상태<select name="state" defaultValue={filters.state}><option value="all">전체 (보관 제외)</option>{REVIEW_EVENT_STATES.map(state => <option key={state} value={state}>{reviewEventStateLabel[state]}</option>)}</select></label>
      <label>기간 기준<select name="dateField" defaultValue={filters.dateField}><option value="created">등록일</option><option value="start">시작일</option><option value="end">종료일</option><option value="announce">발표일</option></select></label>
      <label>시작 날짜<input type="date" name="from" defaultValue={filters.from} /></label><label>종료 날짜<input type="date" name="to" defaultValue={filters.to} /></label>
      <label>목록 수<select name="pageSize" defaultValue={filters.pageSize}>{[20, 50, 100].map(size => <option key={size} value={size}>{size}개씩</option>)}</select></label><button className="btn btn-primary" type="submit">검색</button><Link href={REVIEW_EVENTS_ADMIN_PATH}>초기화</Link>
    </form>
    <p>전체 {total.toLocaleString('ko-KR')}건 · 날짜는 한국 시각 기준입니다.</p>
    <ReviewEventExportButton total={total} href={reviewEventExportHref({ mode: 'events', query: filters.query, state: filters.state, dateField: filters.dateField, from: filters.from || null, to: filters.to || null })} />
    <div className="admin-review-events__table-scroll"><table><caption className="sr-only">리뷰이벤트 목록</caption><thead><tr><th>번호 / 이벤트명</th><th>상태</th><th>응모기간 / 발표일</th><th>선정 혜택</th><th>응모 / 선정 / 지급</th><th>관리</th></tr></thead><tbody>
      {rows.map(event => <tr key={event.id}><td><small>#{event.number}</small><strong>{event.title}</strong><span>{event.description}</span></td><td>{reviewEventStateLabel[event.state]}</td><td>{event.startsOn} ~ {event.endsOn}<small>발표 {event.announcesOn}</small></td><td>1인 {event.creditAmount.toLocaleString('ko-KR')}원<small>예정 {event.plannedWinners}명</small></td><td>{event.entryCount} / {event.selectedCount} / {event.awardedCount}<small>회수 {event.revokedCount}건</small></td><td><Link href={`${REVIEW_EVENTS_ADMIN_PATH}/${event.id}`}>상세 관리</Link></td></tr>)}
      {!rows.length ? <tr><td colSpan={6}>조건에 맞는 리뷰이벤트가 없습니다.</td></tr> : null}
    </tbody></table></div>
    <ConsolePagination page={filters.page} pageSize={filters.pageSize} total={total} hrefForPage={page => reviewEventAdminHref(filters, page)} />
  </section>;
}

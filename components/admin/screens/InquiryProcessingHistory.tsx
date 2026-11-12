import { formatInquiryDateTime } from '@/lib/inquiries';
import { inquiryProcessingEventSummary, type InquiryProcessingHistory as History } from '@/lib/admin/inquiry-processing-history';

/*
 * 문의 처리 이력(1014-105). 그 문의를 열 수 있는 모든 운영자에게 누가 언제 담당을 맡거나 바꾸고, 답변하고, 완료했는지 보인다.
 * 운영자별 집계는 운영자 관리 권한의 '운영자별 처리 이력' 화면에 있다. 상태 색은 쓰지 않는다 — 지난 기록이다.
 */
export function InquiryProcessingHistoryList({ result }: { result?: { ok: true; value: History } | { ok: false } }) {
  if (!result) return null;
  if (!result.ok) return <p className="bg-transparent text-sm text-destructive" role="alert">처리 이력을 불러오지 못했습니다. 새로고침해 다시 확인해주세요.</p>;
  const { events, total, limit } = result.value;
  if (!events.length) return <p className="text-sm text-muted-foreground">아직 운영자 처리 기록이 없습니다.</p>;
  return <div className="flex min-w-0 flex-col gap-2">
    <ol className="flex flex-col divide-y text-sm" data-inquiry-processing-history="">{events.map(event => <li className="flex min-w-0 flex-col gap-0.5 py-2 first:pt-0 last:pb-0" key={event.id} data-kind={event.kind}>
      <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
        <time className="tabular-nums" dateTime={event.at}>{formatInquiryDateTime(event.at)}</time>
        <span className="font-medium text-foreground">{event.kind === 'auto_closed' ? '시스템' : event.actorName ?? '알 수 없는 운영자'}</span>
      </span>
      <span className="wrap-anywhere">{inquiryProcessingEventSummary(event)}</span>
      {event.reason ? <span className="text-xs text-muted-foreground wrap-anywhere">사유 · {event.reason}</span> : null}
    </li>)}</ol>
    {total > events.length ? <p className="text-xs text-muted-foreground">최근 처리 {limit.toLocaleString('ko-KR')}건을 표시합니다. 전체 {total.toLocaleString('ko-KR')}건</p> : null}
  </div>;
}

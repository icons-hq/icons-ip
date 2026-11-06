import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { INQUIRY_SATISFACTION_LABELS } from '@/lib/inquiry-satisfaction';
import { formatInquiryDateTime } from '@/lib/inquiries';

export function InquirySatisfactionContext({ result }: { result: AdminInquiryDetail['satisfaction'] }) {
  return <section className="flex min-w-0 flex-col gap-2 rounded-xl border bg-card p-4 text-sm text-card-foreground" aria-label="답변 만족도">
    <h3 className="text-sm font-medium text-foreground">답변 만족도</h3>
    {result?.ok ? <>
      <span className="font-medium">{INQUIRY_SATISFACTION_LABELS[result.value.current.value ?? 'unrated']}</span>
      <small className="text-xs text-muted-foreground">{result.value.current.answerCreatedAt ? `평가 대상: ${formatInquiryDateTime(result.value.current.answerCreatedAt)} 답변` : '현재 평가할 운영자 답변 없음'}</small>
      {result.value.current.ratedAt ? <small className="text-xs text-muted-foreground">평가 {formatInquiryDateTime(result.value.current.ratedAt)}</small> : null}
      <p className="text-xs leading-relaxed text-muted-foreground">고객이 직접 남긴 평가입니다. 새 운영자 답변이 등록되면 현재 평가는 미평가로 시작합니다.</p>
      {result.value.history.length ? <details className="group rounded-lg border bg-muted/40 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">최근 평가 처리 이력 {result.value.history.length}건</summary>
        <ol className="mt-2 flex list-decimal flex-col gap-1 pl-4 text-xs text-muted-foreground">{result.value.history.map(row => <li key={row.operationId}>
          {formatInquiryDateTime(row.createdAt)} · {INQUIRY_SATISFACTION_LABELS[row.afterValue ?? 'unrated']}
          {row.outcome === 'unchanged' ? ' (변경 없음)' : ''}
          {row.answerId !== result.value.current.answerId ? ' · 이전 답변 평가' : ''}
        </li>)}</ol>
      </details> : null}
    </> : <p className="bg-transparent text-destructive" role="alert">만족도 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
  </section>;
}

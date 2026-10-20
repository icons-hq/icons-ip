import type { AdminInquiryDetail } from '@/lib/admin/inquiries.server';
import { INQUIRY_SATISFACTION_LABELS } from '@/lib/inquiry-satisfaction';
import { formatInquiryDateTime } from '@/lib/inquiries';

export function InquirySatisfactionContext({ result }: { result: AdminInquiryDetail['satisfaction'] }) {
  return <section className="card col" style={{ gap: 8, padding: 16 }} aria-label="답변 만족도">
    <strong>답변 만족도</strong>
    {result?.ok ? <>
      <span>{INQUIRY_SATISFACTION_LABELS[result.value.current.value ?? 'unrated']}</span>
      <small>{result.value.current.answerCreatedAt ? `평가 대상: ${formatInquiryDateTime(result.value.current.answerCreatedAt)} 답변` : '현재 평가할 운영자 답변 없음'}</small>
      {result.value.current.ratedAt ? <small>평가 {formatInquiryDateTime(result.value.current.ratedAt)}</small> : null}
      <p className="muted">고객이 직접 남긴 평가입니다. 새 운영자 답변이 등록되면 현재 평가는 미평가로 시작합니다.</p>
      {result.value.history.length ? <details><summary>최근 평가 처리 이력 {result.value.history.length}건</summary>
        <ol>{result.value.history.map(row => <li key={row.operationId}>
          {formatInquiryDateTime(row.createdAt)} · {INQUIRY_SATISFACTION_LABELS[row.afterValue ?? 'unrated']}
          {row.outcome === 'unchanged' ? ' (변경 없음)' : ''}
          {row.answerId !== result.value.current.answerId ? ' · 이전 답변 평가' : ''}
        </li>)}</ol>
      </details> : null}
    </> : <p role="alert">만족도 정보를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p>}
  </section>;
}

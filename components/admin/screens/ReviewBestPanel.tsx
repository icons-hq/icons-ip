'use client';
import { useRef, useState } from 'react';
import { setBestReviewAction, type BestReviewResult } from '@/app/admin/review-best-actions';
import { canSelectBestReview, REVIEW_BEST_LABELS, REVIEW_BEST_PROBLEM_LABELS, type ReviewBestRequest, type ReviewBestState } from '@/lib/review-best';
import { ReviewBestRewardStatus } from './ReviewBestRewardStatus';

export function ReviewBestPanel({ initial, disabled, onBusyChange }: { initial?: ReviewBestState | null; disabled: boolean; onBusyChange: (value: boolean) => void }) {
  const [reason, setReason] = useState(''), [pending, setPending] = useState(false), [uncertain, setUncertain] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState(false);
  const [saved, setSaved] = useState<{ baseline: string; state: ReviewBestState } | null>(null);
  const request = useRef<ReviewBestRequest | null>(null);
  const baseline = `${initial?.reviewId}:${initial?.revision}:${initial?.reviewFingerprint}`;
  const state = saved?.baseline === baseline ? saved.state : initial;
  async function save(selected: boolean) {
    if (!state || disabled || pending) return;
    request.current ??= { reviewId: state.reviewId, selected, reason: reason.trim(), expectedRevision: state.revision, reviewFingerprint: state.reviewFingerprint, operationId: crypto.randomUUID() };
    setPending(true); onBusyChange(true); setMessage('');
    let result: BestReviewResult;
    try { result = await setBestReviewAction(request.current); }
    catch { result = { error: '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.', uncertain: true }; }
    setPending(false);
    if ('error' in result) {
      setError(true); setMessage(result.error); setUncertain(Boolean(result.uncertain)); onBusyChange(Boolean(result.uncertain));
      if (!result.uncertain) request.current = null;
    } else {
      setSaved({ baseline, state: result.state }); setMessage(result.state.selected ? 'BEST 리뷰로 선정했습니다.' : 'BEST 리뷰 선정을 해제했습니다.');
      setError(false); setUncertain(false); setReason(''); request.current = null; onBusyChange(false);
    }
  }
  return <section className="admin-review-best" aria-labelledby={`review-best-${initial?.reviewId}`}>
    <h3 id={`review-best-${initial?.reviewId}`}>BEST 리뷰 선정 <span>{state ? REVIEW_BEST_LABELS[state.state] : '확인 불가'}</span></h3>
    <p>별점과 무관하게 구체적인 사용 후기를 선정합니다. 상품별 유효한 선정 리뷰가 3개 이상이면 대표 이미지 영역에 3개를 무작위로 표시합니다.</p>
    <p>홈 베스트리뷰에서는 유효한 선정 리뷰를 해당 상품의 대표 후기로 우선 사용하며, 상품상세 이미지 영역의 표시 설정·최소 3개 조건과는 별개입니다.</p>
    {!state ? <p role="alert">선정 상태를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : <>
      {state.problem ? <p role="status">{REVIEW_BEST_PROBLEM_LABELS[state.problem]}</p> : null}
      {state.reason ? <p className="admin-review-best__reason">최근 선정·해제 사유: {state.reason}</p> : null}
      <label htmlFor={`best-reason-${state.reviewId}`}>선정·해제 사유 (운영 기록에 남습니다)</label>
      <textarea id={`best-reason-${state.reviewId}`} rows={3} maxLength={1000} value={reason} disabled={disabled || pending || uncertain} onChange={event => setReason([...event.target.value].slice(0,500).join(''))} />
      <p>활성화한 BEST 보상 정책이 있으면 리뷰당 최초 1회 적립금을 지급합니다. 리뷰 내용·공개 상태·구매 내역이 변경되면 재확인 후 다시 선정합니다.</p>
      <div className="admin-review-best__actions">{uncertain ? <button className="btn btn-sm" disabled={disabled || pending} type="button" onClick={() => void save(request.current!.selected)}>같은 요청 결과 확인</button> : <>
        {(!state.selected || state.state === 'needs_review') ? <button className="btn btn-sm" disabled={disabled || pending || !canSelectBestReview(state) || [...reason.trim()].length < 2} type="button" onClick={() => void save(true)}>{pending ? '처리 중…' : state.selected ? '다시 선정' : 'BEST 리뷰 선정'}</button> : null}
        {state.selected ? <button className="btn btn-sm btn-ghost" disabled={disabled || pending || [...reason.trim()].length < 2} type="button" onClick={() => void save(false)}>{pending ? '처리 중…' : '선정 해제'}</button> : null}
      </>}</div>
      <ReviewBestRewardStatus key={`${state.reviewId}:${state.revision}`} reviewId={state.reviewId} process={Boolean(saved?.baseline === baseline)} disabled={disabled || pending || uncertain} />
    </>}
    {message ? <p role={error ? 'alert' : 'status'}>{message}</p> : null}
  </section>;
}

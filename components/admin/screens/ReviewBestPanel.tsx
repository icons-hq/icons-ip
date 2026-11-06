'use client';
import { useRef, useState } from 'react';
import { setBestReviewAction, type BestReviewResult } from '@/app/admin/review-best-actions';
import { canSelectBestReview, REVIEW_BEST_LABELS, REVIEW_BEST_PROBLEM_LABELS, type ReviewBestRequest, type ReviewBestState } from '@/lib/review-best';
import { Badge } from '@/components/admin/kit/ui/badge';
import { Button } from '@/components/admin/kit/ui/button';
import { Label } from '@/components/admin/kit/ui/label';
import { Textarea } from '@/components/admin/kit/ui/textarea';
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
  return <section className="flex min-w-0 flex-col gap-3 rounded-lg border p-4" aria-labelledby={`review-best-${initial?.reviewId}`}>
    <h3 className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground" id={`review-best-${initial?.reviewId}`}>BEST 리뷰 선정 <Badge variant="secondary">{state ? REVIEW_BEST_LABELS[state.state] : '확인 불가'}</Badge></h3>
    <p className="text-xs leading-relaxed text-muted-foreground">별점과 무관하게 구체적인 사용 후기를 선정합니다. 상품별 유효한 선정 리뷰가 3개 이상이면 대표 이미지 영역에 3개를 무작위로 표시합니다.</p>
    <p className="text-xs leading-relaxed text-muted-foreground">홈 베스트리뷰에서는 유효한 선정 리뷰를 해당 상품의 대표 후기로 우선 사용하며, 상품상세 이미지 영역의 표시 설정·최소 3개 조건과는 별개입니다.</p>
    {!state ? <p className="bg-transparent text-sm text-destructive" role="alert">선정 상태를 불러오지 못했습니다. 새로고침 후 다시 확인해주세요.</p> : <>
      {state.problem ? <p className="text-sm text-[var(--wc-warning)]" role="status">{REVIEW_BEST_PROBLEM_LABELS[state.problem]}</p> : null}
      {state.reason ? <p className="text-sm text-muted-foreground wrap-anywhere">최근 선정·해제 사유: {state.reason}</p> : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`best-reason-${state.reviewId}`}>선정·해제 사유 (운영 기록에 남습니다)</Label>
        <Textarea className="min-h-20" id={`best-reason-${state.reviewId}`} rows={3} maxLength={1000} value={reason} disabled={disabled || pending || uncertain} onChange={event => setReason([...event.target.value].slice(0,500).join(''))} />
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">활성화한 BEST 보상 정책이 있으면 리뷰당 최초 1회 적립금을 지급합니다. 리뷰 내용·공개 상태·구매 내역이 변경되면 재확인 후 다시 선정합니다.</p>
      <div className="flex flex-wrap gap-2">{uncertain ? <Button disabled={disabled || pending} onClick={() => void save(request.current!.selected)} size="sm" type="button">같은 요청 결과 확인</Button> : <>
        {(!state.selected || state.state === 'needs_review') ? <Button disabled={disabled || pending || !canSelectBestReview(state) || [...reason.trim()].length < 2} onClick={() => void save(true)} size="sm" type="button">{pending ? '처리 중…' : state.selected ? '다시 선정' : 'BEST 리뷰 선정'}</Button> : null}
        {state.selected ? <Button disabled={disabled || pending || [...reason.trim()].length < 2} onClick={() => void save(false)} size="sm" type="button" variant="outline">{pending ? '처리 중…' : '선정 해제'}</Button> : null}
      </>}</div>
      <ReviewBestRewardStatus key={`${state.reviewId}:${state.revision}`} reviewId={state.reviewId} process={Boolean(saved?.baseline === baseline)} disabled={disabled || pending || uncertain} />
    </>}
    {message ? <p className={error ? 'bg-transparent text-sm text-destructive' : 'text-sm text-[var(--wc-success)]'} role={error ? 'alert' : 'status'}>{message}</p> : null}
  </section>;
}

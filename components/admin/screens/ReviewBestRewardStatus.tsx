'use client';
import { useEffect, useRef, useState } from 'react';
import { readBestReviewRewardAction } from '@/app/admin/customer-reward-actions';
import { BEST_REWARD_LABELS, type ReviewBestReward } from '@/lib/admin/customer-rewards';

export function ReviewBestRewardStatus({ reviewId, process, disabled }: { reviewId: string; process: boolean; disabled: boolean }) {
  const [reward, setReward] = useState<ReviewBestReward | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    let active = true;
    const current = ++sequence.current;
    void readBestReviewRewardAction(reviewId, process).then(result => {
      if (!active || sequence.current !== current) return;
      if ('reward' in result && result.reward) setReward(result.reward); else setError(result.error ?? '보상 상태를 조회하지 못했습니다.');
    }).catch(() => { if (active && sequence.current === current) setError('보상 상태를 조회하지 못했습니다.'); });
    return () => { active = false; };
  }, [reviewId, process]);
  async function refresh() {
    const current = ++sequence.current; setPending(true); setError('');
    try {
      const result = await readBestReviewRewardAction(reviewId, true);
      if (sequence.current !== current) return;
      if ('reward' in result && result.reward) setReward(result.reward); else setError(result.error ?? '보상 상태를 조회하지 못했습니다.');
    } catch { if (sequence.current === current) setError('보상 상태를 조회하지 못했습니다. 선정 결과는 유지됩니다.'); }
    finally { if (sequence.current === current) setPending(false); }
  }
  return <div className="admin-review-best__reward" aria-label="BEST 보상 처리 상태">
    <p>적립금 보상: {reward ? BEST_REWARD_LABELS[reward.state] : '조회 중…'}{reward && reward.grantedAt ? ` · ${reward.amount.toLocaleString('ko-KR')}원 / 예정 ${reward.plannedAmount.toLocaleString('ko-KR')}원` : ''}</p>
    {reward?.expiresAt ? <p>유효기간: {new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(reward.expiresAt))}</p> : null}
    <button type="button" className="btn btn-sm btn-ghost" disabled={disabled || pending} onClick={() => void refresh()}>{pending ? '확인 중…' : '보상 처리 결과 확인'}</button>
    {error ? <p role="status">{error}</p> : null}
  </div>;
}

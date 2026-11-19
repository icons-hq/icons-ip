'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { revokeUserCouponsAction } from '@/app/admin/coupon-revoke-actions';
import { Button } from '@/components/admin/kit/ui/button';
import { adminPrompt } from '@/lib/admin/confirm';
import { COUPON_REVOKE_REASON_MAX, COUPON_REVOKE_REASON_MIN, couponRevokeSummary } from '@/lib/admin/coupon-revoke';

/** 고객 상세 쿠폰 탭의 보유 쿠폰 줄에서 그 한 장을 회수한다(잘못 발급한 쿠폰, PAY-034). 사유는 adminPrompt 로 받는다. */
export function CustomerCouponRevoke({ userCouponId, couponLabel }: { userCouponId: string; couponLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function revoke() {
    const reason = await adminPrompt({
      title: `쿠폰 회수 · ${couponLabel}`, destructive: true, confirmLabel: '회수',
      message: '이 쿠폰은 고객 쿠폰함에서 사라지고 쓸 수 없게 됩니다. 되돌릴 수 없고, 지정·코드 발급으로는 같은 쿠폰을 같은 고객에게 다시 발급하지 않습니다(매월 지급하는 등급 쿠폰은 다음 달 지급분이 새로 들어갑니다). 결제 대기 주문이 잡은 쿠폰이나 이미 사용한 쿠폰은 회수되지 않습니다.',
      input: { label: '회수 사유', placeholder: '예: 다른 고객에게 잘못 발급', minLength: COUPON_REVOKE_REASON_MIN, maxLength: COUPON_REVOKE_REASON_MAX },
    });
    if (reason === null) return;
    startTransition(async () => {
      const outcome = await revokeUserCouponsAction({ userCouponIds: [userCouponId], reason, operationId: crypto.randomUUID() });
      if (!outcome.ok) { setResult({ ok: false, text: outcome.error }); return; }
      setResult({ ok: outcome.result.revokedCount > 0, text: couponRevokeSummary(outcome.result) });
      if (outcome.result.revokedCount > 0) router.refresh();
    });
  }

  return <div className="flex flex-wrap items-center gap-2">
    <Button type="button" size="sm" variant="outline" disabled={pending} aria-label={`쿠폰 회수 ${couponLabel}`} onClick={revoke}>쿠폰 회수</Button>
    {result ? <span className={result.ok ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'} role={result.ok ? 'status' : 'alert'}>{result.text}</span> : null}
  </div>;
}

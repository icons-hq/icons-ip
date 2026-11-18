'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { reconcilePaymentAttemptAction } from '@/app/admin/system-health-actions';
import { Button } from '@/components/admin/kit/ui/button';

/**
 * 미종결 결제 시도의 '결제 상태 다시 확인'. 결제사 조회 결과로만 확정되고(돈을 새로 움직이지 않는다) 같은 결과로 여러 번 눌러도
 * 안전해서 확인 창을 띄우지 않는다. 결과 문구를 남기고, 확정됐으면 목록을 새로 읽는다.
 */
export function PaymentAttemptReconcileButton({ attemptId, targetLabel }: { attemptId: string; targetLabel: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  function reconcile() {
    setResult(null);
    startTransition(async () => {
      const outcome = await reconcilePaymentAttemptAction({ attemptId, operationId: crypto.randomUUID() });
      setResult(outcome.ok ? { ok: true, text: outcome.message } : { ok: false, text: outcome.error });
      if (outcome.ok) router.refresh();
    });
  }

  return <div className="flex min-w-0 flex-col items-start gap-1" data-payment-reconcile={attemptId}>
    <Button aria-label={`${targetLabel} 결제 상태 다시 확인`} disabled={pending} onClick={reconcile} size="sm" variant="outline">
      {pending ? '확인 중' : '결제 상태 다시 확인'}
    </Button>
    {result ? <p className={`max-w-72 text-xs leading-relaxed ${result.ok ? 'text-success' : 'text-destructive'}`} role={result.ok ? 'status' : 'alert'}>{result.text}</p> : null}
  </div>;
}

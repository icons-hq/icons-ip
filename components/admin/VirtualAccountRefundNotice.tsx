'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { resolveVirtualAccountRefundAction } from '@/app/admin/virtual-account-refund-actions';
import { AdminNotice } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { adminPrompt } from '@/lib/admin/confirm';
import {
  ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURE_LABELS,
  ADMIN_VIRTUAL_ACCOUNT_REFUND_HINTS,
  type AdminVirtualAccountRefundWatch,
} from '@/lib/admin/orders';

/**
 * 가상계좌 환불 송금 확인 필요(ADR-0049 결정 5 보강). 은행이 고객 계좌로 송금하지 못했거나 7일째 확인되지 않거나 결제사 기록이 맞지 않을 때
 * 주문 상세·처리 패널의 가상계좌 칸 아래에 보인다. 주문 관리 권한이면 결제사 밖에서 끝낸 환불을 사유와 함께 '처리 완료'로 표시한다.
 */
export function VirtualAccountRefundNotice({ orderId, refund, canManage }: {
  orderId: string; refund: AdminVirtualAccountRefundWatch | null; canManage: boolean;
}) {
  return refund?.state === 'failed' ? <FailedRefundNotice canManage={canManage} orderId={orderId} refund={refund} /> : null;
}

function FailedRefundNotice({ orderId, refund, canManage }: { orderId: string; refund: AdminVirtualAccountRefundWatch; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useClaimPreviewBusy(pending);

  async function resolve() {
    const note = await adminPrompt({
      title: '환불 송금 처리 완료로 표시',
      message: '결제사 밖(회사 계좌 직접 송금 등)에서 고객 환불을 끝낸 경우에만 표시합니다. 토스페이먼츠 상점관리자에서 다시 환불했다면 누르지 않아도 시스템이 조회해 완료로 바꿉니다. 처리 내용은 감사 기록에 남습니다.',
      confirmLabel: '처리 완료로 표시',
      input: { label: '처리 내용', placeholder: '예: 11/27 회사 계좌에서 고객 계좌로 31,000원 송금', minLength: 2, maxLength: 200 },
    });
    if (note === null) return;
    startTransition(async () => {
      const outcome = await resolveVirtualAccountRefundAction({ orderId, note });
      setResult(outcome.ok ? { ok: true, text: outcome.message } : { ok: false, text: outcome.error });
      if (outcome.ok) router.refresh();
    });
  }

  return <AdminNotice role="status" tone="danger" title="환불 송금 확인이 필요합니다">
    <div className="flex flex-col gap-2" data-virtual-account-refund-failed={refund.failureCode ?? ''}>
      {refund.failureCode ? <p className="font-medium">{ADMIN_VIRTUAL_ACCOUNT_REFUND_FAILURE_LABELS[refund.failureCode]}</p> : null}
      <p>{ADMIN_VIRTUAL_ACCOUNT_REFUND_HINTS.failed}</p>
      {canManage ? <div>
        <Button disabled={pending} onClick={() => { void resolve(); }} size="sm" variant="outline">{pending ? '저장 중…' : '처리 완료로 표시'}</Button>
      </div> : null}
      {result ? <p role={result.ok ? 'status' : 'alert'}>{result.text}</p> : null}
    </div>
  </AdminNotice>;
}

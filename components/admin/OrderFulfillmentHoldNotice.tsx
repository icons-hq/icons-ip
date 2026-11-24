'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { releaseOrderFulfillmentHoldAction } from '@/app/admin/fulfillment-hold-actions';
import { AdminNotice, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { Button } from '@/components/admin/kit/ui/button';
import { useClaimPreviewBusy } from '@/components/orders/claim-preview-busy';
import { adminPrompt } from '@/lib/admin/confirm';
import Link from 'next/link';
import {
  FULFILLMENT_HOLD_LABELS,
  fulfillmentHoldBadgeLabel,
  fulfillmentHoldGuidance,
  type FulfillmentHoldReason,
  type OrderFulfillmentHold,
  type OrderFulfillmentHoldList,
} from '@/lib/admin/fulfillment-holds';
import { formatOrderDateTime } from '@/lib/orders';
import { statusTone } from '@/lib/admin/status-tone';

/** 사유별 해제 확인창 안내. 해제하면 발주확인·출고지시 대상이 된다는 결과와 적을 내용을 말한다. */
const RELEASE_PROMPT_MESSAGES: Record<FulfillmentHoldReason, string> = {
  test_payment: '실제 돈이 결제되지 않은 테스트 결제입니다. 해제하면 이 주문이 발주확인·출고지시 대상이 됩니다. 결제를 따로 받았거나 출고해야 하는 이유를 적어주세요.',
  provider_canceled: '결제사에서 취소된 금액이 있습니다. 해제하면 이 주문이 발주확인·출고지시 대상이 됩니다. 고객과 합의한 내용 등 출고해야 하는 이유를 적어주세요.',
  deposit_reversed: '은행이 가상계좌 입금을 취소한 결제입니다. 보통은 시스템이 다시 입금되면 보류를 풀고 입금이 없으면 주문을 자동 취소하므로 해제할 필요가 없습니다. 해제하면 시스템이 이 주문을 더 처리하지 않고 발주확인·출고지시 대상이 됩니다. 토스페이먼츠 상점관리자에서 입금을 다시 확인한 내용(확인 일시·금액 등)을 적어주세요.',
  escrow_cancel_requested: '구매자가 구매안전서비스(에스크로)에서 취소를 신청한 결제입니다. 해제하면 이 주문이 발주확인·출고지시 대상이 됩니다. 고객과 합의한 내용 등 출고해야 하는 이유를 적어주세요.',
};

/** 보류 배지 색. 출고를 막는 보류는 사유 색(위험), 이미 발송된 주문의 보류는 경고색이다. */
const holdTone = (hold: OrderFulfillmentHold) => statusTone('fulfillmentHold', hold.outboundBlocked ? hold.reason : 'shipped');

/** 목록 행·상태 칸에 붙는 출고 보류 배지. 사유가 둘이면 둘 다 보인다. */
export function OrderFulfillmentHoldBadges({ holds }: { holds: readonly OrderFulfillmentHold[] }) {
  if (!holds.length) return null;
  return <>{holds.map(hold => <AdminStatusBadge key={hold.reason} data-fulfillment-hold={hold.reason}
    data-fulfillment-hold-blocking={hold.outboundBlocked ? '' : undefined}
    title={fulfillmentHoldGuidance(hold)} tone={holdTone(hold)}>
    {fulfillmentHoldBadgeLabel(hold)}
  </AdminStatusBadge>)}</>;
}

/**
 * 주문 상세·처리 패널의 출고 보류 안내(원장 PAY-050·CLM-051). 보류 중에는 DB가 발주확인·출고지시·발송을 막는다.
 * 사유별로 다음 행동을 안내하고, 주문 관리 권한(sales.manage)이면 사유를 적어 해제할 수 있다.
 */
export function OrderFulfillmentHoldNotice({ orderId, holds, canManage }: {
  orderId: string; holds: readonly OrderFulfillmentHold[]; canManage: boolean;
}) {
  /* 보류가 없는 대부분의 주문은 라우터·전이 훅을 붙이지 않는다(정적 렌더·팝업 밖에서도 그대로 그려진다). */
  return holds.length ? <HeldOrderNotice canManage={canManage} holds={holds} orderId={orderId} /> : null;
}

function HeldOrderNotice({ orderId, holds, canManage }: {
  orderId: string; holds: readonly OrderFulfillmentHold[]; canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  useClaimPreviewBusy(pending);

  async function release(reason: FulfillmentHoldReason) {
    const note = await adminPrompt({
      title: `출고 보류 해제 · ${FULFILLMENT_HOLD_LABELS[reason]}`,
      message: RELEASE_PROMPT_MESSAGES[reason],
      confirmLabel: '보류 해제',
      destructive: true,
      input: { label: '해제 사유', placeholder: '예: 고객과 통화해 남은 금액으로 출고하기로 함', minLength: 5, maxLength: 500 },
    });
    if (note === null) return;
    startTransition(async () => {
      const outcome = await releaseOrderFulfillmentHoldAction({ orderId, reason, note, operationId: crypto.randomUUID() });
      setResult(outcome.ok ? { ok: true, text: outcome.message } : { ok: false, text: outcome.error });
      if (outcome.ok) router.refresh();
    });
  }

  const blocking = holds.some(hold => hold.outboundBlocked);
  return <AdminNotice role="status" tone={blocking ? 'danger' : 'warning'}
    title={blocking ? '출고 보류 중인 주문입니다' : '발송 뒤 결제 확인이 필요한 주문입니다'}>
    <div className="flex flex-col gap-3" data-order-fulfillment-hold="">
      <p className="text-sm">{blocking
        ? '보류가 풀릴 때까지 자동·수동 발주확인, 출고지시 내보내기, 발송 전 배송 건의 운송장 등록·발송 처리와 교환 재출고가 막힙니다. 이미 발송된 배송 건의 배송완료는 막지 않습니다.'
        : '이미 발송된 주문이라 배송완료 처리는 막지 않습니다. 교환 재출고만 막힙니다.'}</p>
      <ul className="flex flex-col gap-2.5">
        {holds.map(hold => <li className="flex flex-col items-start gap-1.5" key={hold.reason}>
          <span className="flex flex-wrap items-center gap-2">
            <AdminStatusBadge tone={holdTone(hold)}>{FULFILLMENT_HOLD_LABELS[hold.reason]}</AdminStatusBadge>
            {hold.placedAt ? <time className="text-xs text-muted-foreground tabular-nums" dateTime={hold.placedAt}>{formatOrderDateTime(hold.placedAt)}</time> : null}
          </span>
          <p className="text-sm leading-relaxed wrap-anywhere">{fulfillmentHoldGuidance(hold)}</p>
          {canManage ? <Button disabled={pending} onClick={() => { void release(hold.reason); }} size="sm" variant="outline">
            {pending ? '처리 중' : '사유 적고 보류 해제'}
          </Button> : null}
        </li>)}
      </ul>
      {result ? <p className={result.ok ? 'text-sm text-success' : 'text-sm text-destructive'} role={result.ok ? 'status' : 'alert'}>{result.text}</p> : null}
    </div>
  </AdminNotice>;
}

/**
 * 주문 목록 위 '출고 보류 주문' 묶음(운영 할 일의 출고 보류 건수가 여기로 온다). 오래된 순 최대 20건을 보이고, 주문번호를 누르면
 * 목록 위 상세 팝업에서 사유·다음 행동·해제를 본다. 보류가 없으면 그리지 않는다.
 */
export function OrderFulfillmentHoldList({ list, hrefFor }: {
  list: OrderFulfillmentHoldList | undefined; hrefFor: (orderId: string) => string;
}) {
  if (!list?.total) return null;
  return <section aria-label="출고 보류 주문" data-order-fulfillment-hold-list="">
    <AdminNotice role="status" tone={statusTone('fulfillmentHold', 'blocked')} title={`출고 보류 주문 ${list.total.toLocaleString('ko-KR')}건 · 발주확인·출고지시에서 빠져 있습니다`}>
      <div className="flex flex-col gap-2">
        <ul className="flex flex-col gap-1.5">
          {list.items.map(item => <li className="flex flex-wrap items-center gap-2" key={item.orderId}>
            <Link className="font-medium tabular-nums underline-offset-4 hover:underline" href={hrefFor(item.orderId)}>{item.orderNumber ?? item.orderId}</Link>
            <OrderFulfillmentHoldBadges holds={item.holds} />
          </li>)}
        </ul>
        {list.total > list.items.length ? <p className="text-xs text-muted-foreground">오래된 {list.items.length}건만 보입니다. 처리하면 다음 건이 올라옵니다.</p> : null}
      </div>
    </AdminNotice>
  </section>;
}

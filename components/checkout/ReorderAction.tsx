'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  restoreCanceledOrderToCartAction,
  type RestoreCanceledOrderToCartResult,
  type RestoreOrderSkippedLine,
} from '@/app/checkout/reorder-actions';
import { submitOrderCancellation } from '@/components/orders/OrderCancellation';
import type { CheckoutReorderMode } from '@/lib/checkout';

/*
 * 결제가 닫힌 주문을 한 번에 정리하고 다시 주문하게 한다.
 *
 * 1) 취소는 기존 고객 취소 경로(/api/orders/[orderId]/cancel)를 그대로 쓴다. 이 버튼은
 *    즉시 취소가 확실한 주문(checkoutReorderMode)에만 보이지만, 그 사이 상태가 바뀌어
 *    청약철회 요청으로 접수되면 장바구니를 건드리지 않고 그 사실만 알린다.
 * 2) DB가 취소를 확정한 주문만 서버 액션이 품목을 장바구니에 다시 담는다.
 * 3) 모두 담기면 주문서(/checkout)로 보낸다. 장바구니는 경로가 바뀌면 서버에서 다시
 *    동기화된다(CartProvider).
 */

type CancelResult = Awaited<ReturnType<typeof submitOrderCancellation>>;

export type ReorderOutcome =
  | { readonly kind: 'restored' }
  | { readonly kind: 'partial'; readonly skipped: readonly RestoreOrderSkippedLine[] }
  | { readonly kind: 'nothing_restored'; readonly skipped: readonly RestoreOrderSkippedLine[] }
  | { readonly kind: 'cancel_requested' }
  | { readonly kind: 'cancel_blocked' }
  | { readonly kind: 'cancel_failed' }
  | { readonly kind: 'restore_failed' };

export interface ReorderDependencies {
  readonly cancel: (orderId: string) => Promise<CancelResult>;
  readonly restore: (orderId: string) => Promise<RestoreCanceledOrderToCartResult>;
}

const defaultDependencies: ReorderDependencies = {
  cancel: (orderId) => submitOrderCancellation(orderId, 'change_of_mind'),
  restore: (orderId) => restoreCanceledOrderToCartAction(orderId),
};

export async function runReorder(
  orderId: string,
  mode: CheckoutReorderMode,
  deps: ReorderDependencies = defaultDependencies,
): Promise<ReorderOutcome> {
  if (mode === 'cancel_then_reorder') {
    let canceled: CancelResult;
    try {
      canceled = await deps.cancel(orderId);
    } catch {
      return { kind: 'cancel_failed' };
    }
    if (canceled === 'requested') return { kind: 'cancel_requested' };
    if (canceled === 'not_cancelable' || canceled === 'deadline_expired') return { kind: 'cancel_blocked' };
    if (canceled !== 'canceled' && canceled !== 'already_canceled') return { kind: 'cancel_failed' };
  }

  let restored: RestoreCanceledOrderToCartResult;
  try {
    restored = await deps.restore(orderId);
  } catch {
    return { kind: 'restore_failed' };
  }
  if (!restored.ok) return { kind: 'restore_failed' };
  if (restored.restoredLines === 0) return { kind: 'nothing_restored', skipped: restored.skipped };
  if (restored.skipped.length > 0) return { kind: 'partial', skipped: restored.skipped };
  return { kind: 'restored' };
}

const SKIP_REASON_LABELS: Record<RestoreOrderSkippedLine['reason'], string> = {
  out_of_stock: '재고 부족',
  unavailable: '판매 중지',
  failed: '담지 못함',
};

function skippedSummary(skipped: readonly RestoreOrderSkippedLine[]) {
  return skipped.map((line) => `${line.name}(${SKIP_REASON_LABELS[line.reason]})`).join(', ');
}

interface ReorderActionProps {
  readonly orderId: string;
  readonly mode: CheckoutReorderMode;
}

export function ReorderAction({ orderId, mode }: ReorderActionProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<ReorderOutcome | null>(null);

  async function start() {
    setPending(true);
    setOutcome(null);
    const result = await runReorder(orderId, mode);
    if (result.kind === 'restored') {
      router.push('/checkout');
      return;
    }
    setOutcome(result);
    setPending(false);
    /* 주문 상태가 예상과 달랐던 경우에만 서버 상태를 다시 그린다. 취소가 끝난 뒤의
       담기 결과는 화면이 바뀌면 사라지므로 새로 그리지 않고 안내를 남긴다. */
    if (result.kind === 'cancel_requested' || result.kind === 'cancel_blocked') router.refresh();
  }

  const label = mode === 'cancel_then_reorder' ? '이 주문 취소하고 다시 주문하기' : '같은 굿즈 다시 담기';

  if (outcome) {
    return (
      <div className="checkout-reorder" aria-live="polite">
        {outcome.kind === 'partial' ? (
          <>
            <p role="status">일부 굿즈만 장바구니에 다시 담았어요. 담지 못한 굿즈: {skippedSummary(outcome.skipped)}</p>
            <Link className="btn btn-holo" href="/checkout">주문서로 가기</Link>
            <Link className="btn btn-ghost" href="/cart">장바구니 보기</Link>
          </>
        ) : outcome.kind === 'nothing_restored' ? (
          <>
            <p role="alert">
              {mode === 'cancel_then_reorder' ? '주문은 취소됐어요. ' : ''}
              다시 담을 수 있는 굿즈가 없어요{outcome.skipped.length ? `: ${skippedSummary(outcome.skipped)}` : ''}.
            </p>
            <Link className="btn btn-holo" href="/shop">굿즈샵 둘러보기</Link>
          </>
        ) : outcome.kind === 'cancel_requested' ? (
          <>
            <p role="status">취소 요청을 접수했어요. 처리 상태는 주문 상세에서 확인해주세요.</p>
            <Link className="btn btn-holo" href={`/orders/${orderId}`}>주문 상세 보기</Link>
          </>
        ) : outcome.kind === 'cancel_blocked' ? (
          <p role="alert">주문 상태가 바뀌어 지금은 이 주문을 취소할 수 없어요. 바뀐 상태를 불러오고 있어요.</p>
        ) : outcome.kind === 'restore_failed' ? (
          <>
            <p role="alert">
              {mode === 'cancel_then_reorder' ? '주문은 취소됐어요. ' : ''}
              굿즈를 장바구니에 다시 담지 못했어요. 굿즈샵에서 다시 담아주세요.
            </p>
            <Link className="btn btn-holo" href="/shop">굿즈샵 둘러보기</Link>
          </>
        ) : (
          <>
            <p role="alert">주문을 취소하지 못했어요. 잠시 후 다시 시도해주세요.</p>
            <button className="btn btn-holo" type="button" onClick={() => void start()}>{label}</button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="checkout-reorder">
      <button className="btn btn-holo" type="button" disabled={pending} onClick={() => void start()}>
        {pending ? '처리하고 있어요' : label}
      </button>
    </div>
  );
}

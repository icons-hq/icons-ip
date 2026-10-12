'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  restoreCanceledOrderToCartAction,
  type RestoreCanceledOrderToCartResult,
  type RestoreOrderCouponResult,
  type RestoreOrderSkippedLine,
} from '@/app/checkout/reorder-actions';
import { submitOrderCancellation } from '@/components/orders/OrderCancellation';
import type { CheckoutReorderMode } from '@/lib/checkout';
import { krwAmountWords } from '@/lib/format';

/*
 * 결제가 닫힌 주문을 한 번에 정리하고 다시 주문하게 한다.
 *
 * 1) 취소는 기존 고객 취소 경로(/api/orders/[orderId]/cancel)를 그대로 쓴다. 이 버튼은
 *    즉시 취소가 확실한 주문(checkoutReorderMode)에만 보이지만, 그 사이 상태가 바뀌어
 *    청약철회 요청으로 접수되면 장바구니를 건드리지 않고 그 사실만 알린다.
 * 2) DB가 취소를 확정한 주문만 서버 액션이 품목을 장바구니에 다시 담고, 원 주문의
 *    쿠폰을 장바구니에 다시 선택한다.
 * 3) 모두 담기고 다시 챙길 혜택이 없으면 주문서(/checkout)로 보낸다. 쿠폰이 이번 주문에
 *    할인되지 않거나 적립금을 쓴 주문이면 자동으로 넘기지 않고 사실대로 안내한다 — 모르고
 *    정가로 결제하지 않게 한다. 쿠폰을 장바구니에서 해결할 수 있으면(다시 고르기·사용
 *    조건 확인) 장바구니를 먼저 권하고, 다시 고를 수 없는 쿠폰(만료·사용 완료 등)이면
 *    장바구니로 돌려보내지 않는다. 장바구니는 경로가 바뀌면 서버에서 다시 동기화된다
 *    (CartProvider).
 */

type CancelResult = Awaited<ReturnType<typeof submitOrderCancellation>>;

/**
 * 원 주문 쿠폰에 대해 고객에게 알릴 것.
 * - `reselect`: 다시 적용하지 못했다. 장바구니에서 다시 고를 수 있다.
 * - `conditions_unmet`: 지금 담긴 굿즈가 사용 조건에 맞지 않아 할인되지 않는다.
 * - `unavailable`: 만료·사용 완료 등으로 다시 고를 수 없다.
 */
export type ReorderCouponNotice = 'reselect' | 'conditions_unmet' | 'unavailable';

/** 새 주문에서 고객이 직접 다시 챙겨야 하는 원 주문의 혜택. */
export interface ReorderBenefitsToReapply {
  /** 원 주문의 쿠폰이 이번 주문에 할인되지 않는 이유. 다시 적용됐거나 쓰지 않았으면 null. */
  readonly coupon: ReorderCouponNotice | null;
  /** 원 주문에서 사용한 적립금(원). 주문서 입력은 비어 있다. */
  readonly storeCredit: number;
}

const COUPON_NOTICES: Partial<Record<RestoreOrderCouponResult, ReorderCouponNotice>> = {
  not_restored: 'reselect',
  conditions_unmet: 'conditions_unmet',
  unavailable: 'unavailable',
};

export type ReorderOutcome =
  | { readonly kind: 'restored'; readonly reapply: ReorderBenefitsToReapply | null }
  | {
      readonly kind: 'partial';
      readonly skipped: readonly RestoreOrderSkippedLine[];
      readonly reapply: ReorderBenefitsToReapply | null;
    }
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
  const coupon = COUPON_NOTICES[restored.coupon] ?? null;
  const storeCredit = Math.max(0, restored.storeCreditUsed);
  const reapply = coupon || storeCredit > 0 ? { coupon, storeCredit } : null;
  if (restored.skipped.length > 0) return { kind: 'partial', skipped: restored.skipped, reapply };
  return { kind: 'restored', reapply };
}

/** 고객이 다시 챙길 것이 없을 때만 안내 없이 주문서로 넘긴다. */
export function reorderNavigatesToCheckout(outcome: ReorderOutcome): boolean {
  return outcome.kind === 'restored' && outcome.reapply === null;
}

const SKIP_REASON_LABELS: Record<RestoreOrderSkippedLine['reason'], string> = {
  out_of_stock: '재고 부족',
  sold_out: '품절',
  unavailable: '지금 담을 수 없음',
  failed: '담지 못함',
};

function skippedSummary(skipped: readonly RestoreOrderSkippedLine[]) {
  return skipped.map((line) => `${line.name}(${SKIP_REASON_LABELS[line.reason]})`).join(', ');
}

const COUPON_NOTICE_COPY: Record<ReorderCouponNotice, string> = {
  reselect: '이전 주문에 쓴 쿠폰은 다시 적용되지 않았어요. 장바구니에서 쿠폰을 다시 골라주세요.',
  conditions_unmet: '이전 주문에 쓴 쿠폰은 지금 담긴 굿즈로는 사용 조건(최소 주문 금액 등)에 맞지 않아 할인되지 않아요. 장바구니에서 굿즈와 쿠폰을 확인해주세요.',
  unavailable: '이전 주문에 쓴 쿠폰은 만료·사용 완료·사용 중단 등으로 지금 쓸 수 없어 이번 주문에는 적용되지 않아요.',
};

/** 장바구니에서 해결할 수 있는 쿠폰 안내. 이때만 장바구니를 먼저 권한다. */
const CART_FIRST_COUPON_LINKS: Partial<Record<ReorderCouponNotice, string>> = {
  reselect: '장바구니에서 쿠폰 고르기',
  conditions_unmet: '장바구니에서 쿠폰 확인하기',
};

function ReapplyNotice({ reapply }: { reapply: ReorderBenefitsToReapply }) {
  return (
    <>
      {reapply.coupon && <p role="alert">{COUPON_NOTICE_COPY[reapply.coupon]}</p>}
      {reapply.storeCredit > 0 && (
        <p role="alert">이전 주문에 쓴 적립금 {krwAmountWords(reapply.storeCredit)}은 주문서에서 다시 입력해주세요.</p>
      )}
    </>
  );
}

/** 다시 담기 결과 안내. 주문서로 바로 넘기지 않는 모든 결과를 여기서 그린다. */
export function ReorderOutcomeNotice({
  outcome,
  orderId,
  mode,
  onRetry,
}: {
  outcome: ReorderOutcome;
  orderId: string;
  mode: CheckoutReorderMode;
  onRetry?: () => void;
}) {
  const label = mode === 'cancel_then_reorder' ? '이 주문 취소하고 다시 주문하기' : '같은 굿즈 다시 담기';
  const canceledPrefix = mode === 'cancel_then_reorder' ? '주문은 취소됐어요. ' : '';
  /* 쿠폰을 고르고 조건을 확인하는 곳은 장바구니다 — 장바구니에서 해결할 수 있는 쿠폰
     안내일 때만 장바구니를 먼저 권한다. 다시 고를 수 없는 쿠폰은 주문서를 먼저 권한다. */
  const benefitLinks = (reapply: ReorderBenefitsToReapply | null) => {
    const cartFirst = reapply?.coupon ? CART_FIRST_COUPON_LINKS[reapply.coupon] : undefined;
    return cartFirst ? (
      <>
        <Link className="btn btn-holo" href="/cart">{cartFirst}</Link>
        <Link className="btn btn-ghost" href="/checkout">주문서로 가기</Link>
      </>
    ) : (
      <>
        <Link className="btn btn-holo" href="/checkout">주문서로 가기</Link>
        <Link className="btn btn-ghost" href="/cart">장바구니 보기</Link>
      </>
    );
  };

  return (
    <div className="checkout-reorder" aria-live="polite">
      {outcome.kind === 'restored' ? (
        <>
          <p role="status">{canceledPrefix}굿즈를 장바구니에 다시 담았어요.</p>
          {outcome.reapply && <ReapplyNotice reapply={outcome.reapply} />}
          {benefitLinks(outcome.reapply)}
        </>
      ) : outcome.kind === 'partial' ? (
        <>
          <p role="status">일부 굿즈만 장바구니에 다시 담았어요. 담지 못한 굿즈: {skippedSummary(outcome.skipped)}</p>
          {outcome.reapply && <ReapplyNotice reapply={outcome.reapply} />}
          {benefitLinks(outcome.reapply)}
        </>
      ) : outcome.kind === 'nothing_restored' ? (
        <>
          <p role="alert">
            {canceledPrefix}
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
            {canceledPrefix}
            굿즈를 장바구니에 다시 담지 못했어요. 굿즈샵에서 다시 담아주세요.
          </p>
          <Link className="btn btn-holo" href="/shop">굿즈샵 둘러보기</Link>
        </>
      ) : (
        <>
          <p role="alert">주문을 취소하지 못했어요. 잠시 후 다시 시도해주세요.</p>
          <button className="btn btn-holo" type="button" onClick={onRetry}>{label}</button>
        </>
      )}
    </div>
  );
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
    if (reorderNavigatesToCheckout(result)) {
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
    return <ReorderOutcomeNotice mode={mode} onRetry={() => void start()} orderId={orderId} outcome={outcome} />;
  }

  return (
    <div className="checkout-reorder">
      <button className="btn btn-holo" type="button" disabled={pending} onClick={() => void start()}>
        {pending ? '처리하고 있어요' : label}
      </button>
    </div>
  );
}

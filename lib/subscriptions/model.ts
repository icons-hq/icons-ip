import { parseGoodsTransactionDisplay, parseGoodsTransactionSelection, type GoodsTransactionDisplay, type GoodsTransactionSelection } from '../goods-transaction';
import { isUuid } from '../uuid';
import { parseSubscriptionSchedule, subscriptionSlotTiming, type SubscriptionSchedule } from './schedule';

export const SUBSCRIPTION_PLAN_STATES = ['draft', 'awaiting_first_payment', 'active', 'paused', 'needs_confirmation', 'canceled'] as const;
export type SubscriptionPlanState = typeof SUBSCRIPTION_PLAN_STATES[number];
export const SUBSCRIPTION_CYCLE_STATES = ['draft', 'ready', 'prepared', 'dispatching', 'unknown', 'needs_review', 'approved', 'declined', 'canceled', 'skipped'] as const;
export type SubscriptionCycleState = typeof SUBSCRIPTION_CYCLE_STATES[number];
export const SUBSCRIPTION_PAUSE_REASONS = ['customer_paused', 'payment_failed', 'stock_unavailable', 'goods_unavailable',
  'schedule_missed', 'account_unavailable', 'card_unavailable', 'delivery_unavailable', 'terms_changed', 'payment_review'] as const;
export type SubscriptionPauseReason = typeof SUBSCRIPTION_PAUSE_REASONS[number];

export interface SubscriptionLease {
  readonly token: string;
  readonly fence: number;
  readonly expiresAt: string;
}

export interface SubscriptionCycleInput {
  readonly planState: SubscriptionPlanState;
  readonly cycleState: SubscriptionCycleState;
  readonly scheduledAt: string;
  readonly dispatchedAt: string | null;
  readonly accountAllowed: boolean;
  readonly credentialReady: boolean;
  readonly termsAccepted: boolean;
  readonly sourceCurrent: boolean;
}

export type SubscriptionWorkDecision =
  | { readonly kind: 'noop'; readonly reason: 'terminal' | 'not_due' | 'plan_stopped' }
  | { readonly kind: 'inspect' }
  | { readonly kind: 'pause'; readonly reason: SubscriptionPauseReason }
  | { readonly kind: 'needs_confirmation' }
  | { readonly kind: 'quote' | 'dispatch' };

/** 서버/SQL 경계가 다시 확인할 결정표. 이미 보낸 결제는 해지/계정 fence 후에도 조회한다. */
export function decideSubscriptionWork(input: SubscriptionCycleInput, now: Date): SubscriptionWorkDecision {
  if (['approved', 'declined', 'canceled', 'skipped'].includes(input.cycleState)) return { kind: 'noop', reason: 'terminal' };
  if (input.dispatchedAt !== null || ['dispatching', 'unknown', 'needs_review'].includes(input.cycleState)) return { kind: 'inspect' };
  if (!['active', 'awaiting_first_payment'].includes(input.planState)) return { kind: 'noop', reason: 'plan_stopped' };
  if (!input.accountAllowed) return { kind: 'pause', reason: 'account_unavailable' };
  if (!input.credentialReady) return { kind: 'pause', reason: 'card_unavailable' };
  if (!input.termsAccepted || !input.sourceCurrent) return { kind: 'needs_confirmation' };
  const timing = subscriptionSlotTiming(input.scheduledAt, now);
  if (timing === 'future') return { kind: 'noop', reason: 'not_due' };
  if (timing === 'missed') return { kind: 'pause', reason: 'schedule_missed' };
  return { kind: input.cycleState === 'prepared' ? 'dispatch' : 'quote' };
}

export function subscriptionLeaseMatches(current: SubscriptionLease | null, expected: SubscriptionLease, now: Date): boolean {
  return current !== null && isUuid(current.token) && current.token === expected.token
    && Number.isSafeInteger(current.fence) && current.fence > 0 && current.fence === expected.fence
    && Number.isFinite(Date.parse(current.expiresAt)) && Number.isFinite(now.getTime())
    && Date.parse(current.expiresAt) > now.getTime();
}

export interface SubscriptionRenewalTerms {
  readonly version: 1;
  readonly currency: 'KRW';
  readonly selection: readonly GoodsTransactionSelection[];
  readonly schedule: SubscriptionSchedule;
  readonly addressRevision: string;
  readonly onlineTotal: number;
  readonly collectShippingTotal: number;
  readonly goods: ReadonlyArray<Omit<GoodsTransactionDisplay['lines'][number], 'lineId'>>;
  readonly shipping: GoodsTransactionDisplay['shipping'];
}

/** 가격 표시 시각/임시 line ID를 동의 내용에 섞지 않는다. 조건·T·D는 모두 결속한다. */
export function subscriptionRenewalTerms(input: {
  display: GoodsTransactionDisplay; selection: readonly GoodsTransactionSelection[];
  schedule: SubscriptionSchedule; addressRevision: string;
}): SubscriptionRenewalTerms {
  const display = parseGoodsTransactionDisplay(input.display); const selection = parseGoodsTransactionSelection(input.selection);
  const schedule = parseSubscriptionSchedule(input.schedule);
  if (!display || !selection || !schedule || !isUuid(input.addressRevision) || display.userCouponId !== null
    || display.totals.couponDiscountTotal !== 0 || display.totals.storeCreditTotal !== 0 || !display.paymentMethods.card) {
    throw new Error('invalid_subscription_renewal_terms');
  }
  const sort = <T,>(rows: readonly T[]) => [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'));
  const goods = display.lines.map(line => ({ goodId: line.goodId, variantId: line.variantId, qty: line.qty,
    regularUnitPrice: line.regularUnitPrice, unitPrice: line.unitPrice, volumeUnitDiscount: line.volumeUnitDiscount,
    subtotal: line.subtotal, volumeDiscountTotal: line.volumeDiscountTotal, netSubtotal: line.netSubtotal,
    couponDiscount: line.couponDiscount, storeCreditDiscount: line.storeCreditDiscount,
    paidGoodsTotal: line.paidGoodsTotal, volumePolicyId: line.volumePolicyId }));
  return { version: 1, currency: 'KRW', selection: sort(selection), schedule, addressRevision: input.addressRevision,
    onlineTotal: display.totals.onlineTotal, collectShippingTotal: display.totals.collectShippingTotal,
    goods: sort(goods), shipping: sort(display.shipping.map(group => ({ ...group, components: sort(group.components) }))) };
}

export function subscriptionTermsNeedConfirmation(accepted: SubscriptionRenewalTerms, current: SubscriptionRenewalTerms): boolean {
  return JSON.stringify(accepted) !== JSON.stringify(current);
}

export const SUBSCRIPTION_PLAN_LABELS: Record<SubscriptionPlanState, string> = {
  draft: '신청 준비', awaiting_first_payment: '첫 결제 확인 중', active: '정기배송 중',
  paused: '일시정지', needs_confirmation: '변경 내용 확인 필요', canceled: '해지',
};

export const SUBSCRIPTION_CYCLE_LABELS: Record<SubscriptionCycleState, string> = {
  draft: '견적 준비', ready: '결제 예정', prepared: '결제 준비', dispatching: '결제 확인 중', unknown: '결제 확인 중',
  needs_review: '결제 검토 필요', approved: '결제 완료', declined: '결제 실패', canceled: '취소', skipped: '미청구',
};

export const SUBSCRIPTION_REASON_LABELS: Record<SubscriptionPauseReason, string> = {
  customer_paused: '직접 일시정지했어요.', payment_failed: '카드 결제에 실패했어요. 카드를 확인한 뒤 다음 일정을 선택해 주세요.',
  stock_unavailable: '재고가 부족해 결제하지 않았어요.', goods_unavailable: '현재 구매할 수 없는 굿즈가 있어요.',
  schedule_missed: '예정된 결제일이 지나 새 일정 확인이 필요해요.', account_unavailable: '현재 계정에서 새 결제를 시작할 수 없어요.',
  card_unavailable: '사용할 수 있는 등록카드가 없어요.', delivery_unavailable: '배송 조건 확인이 필요해요.',
  terms_changed: '금액이나 배송 조건이 바뀌었어요.', payment_review: '이번 결제 결과를 확인하고 있어요.',
};

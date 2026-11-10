import { transactionDisplay, transactionInput } from './cart-transaction';
import type { GoodsSubscription, SubscriptionCycle } from '@/lib/subscriptions/customer';
import type { AdminSubscriptionRow } from '@/lib/admin/subscriptions';
export const subscriptionId = (n: number) => `b1716000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const subscriptionCycle: SubscriptionCycle = { id: subscriptionId(3), number: 1, state: 'approved', scheduledAt: '2026-10-14T03:00:00Z',
  orderId: subscriptionId(4), orderStatus: 'paid', amount: 16000, settledAt: '2026-10-14T03:00:01Z', reason: null };
export const subscriptionPlan: GoodsSubscription = { id: subscriptionId(1), state: 'active', revision: 2, termsId: subscriptionId(2), pauseReason: null,
  nextRunAt: '2026-11-14T00:00:00Z', consentedAt: '2026-10-14T03:00:00Z', canceledAt: null, createdAt: '2026-10-14T03:00:00.123456Z', updatedAt: '2026-10-14T03:00:00.123456Z',
  draftExpiresAt: '2026-10-14T03:10:00.123456Z', firstCycleId: subscriptionId(3), firstQuoteId: subscriptionId(5), policyTermsVersion: 'goods-subscription-v1',
  schedule: { unit: 'month', interval: 1, anchorDate: '2026-10-14', time: '09:00', monthEnd: false },
  selection: [{ goodId: 'transaction-good', variantId: transactionInput.items[0].variantId!, qty: 2, inputRevision: 0, inputValues: {} }],
  firstDisplay: transactionDisplay, renewalDisplay: transactionDisplay, card: { id: subscriptionId(6), state: 'active', issuerCode: '61', number: '43301234****123*', revision: 1 },
  address: transactionInput.address, deliveryChoices: transactionInput.deliveryChoices, addressRevision: subscriptionId(7), cycles: [subscriptionCycle] };
export const adminSubscriptionRow: AdminSubscriptionRow = { id: subscriptionPlan.id, ownerId: subscriptionId(10), buyerName: '합성 구매자', state: 'active', revision: 2,
  createdAt: subscriptionPlan.createdAt, updatedAt: subscriptionPlan.updatedAt, nextRunAt: subscriptionPlan.nextRunAt, reason: null, schedule: subscriptionPlan.schedule,
  renewalOnlineTotal: 16000, renewalCollectTotal: 3000, goodsLabel: '합성 정기배송 상품 2개', cycleCount: 2, paidCycleCount: 1, paidOnlineTotal: 16000,
  latestCycle: { id: subscriptionId(11), number: 2, state: 'ready', orderId: null, dispatchedAt: null, nextCheckAt: null, reason: null } };

import { expect, it } from 'vitest';
import { subscriptionPlan, subscriptionCycle, subscriptionId } from '../../test/fixtures/goods-subscriptions';
import { parseGoodsSubscription, parseSubscriptionCard, parseSubscriptionCyclePage, parseSubscriptionPlanPage } from './customer';
it('고객 DTO는 허용한 표시값만 재구성하고 키·provider binding을 전달하지 않는다', () => {
  const value = parseGoodsSubscription({ ...subscriptionPlan, authKey: 'secret', envelope: {}, binding: {} });
  expect(value).toEqual(subscriptionPlan); expect(value).not.toHaveProperty('authKey');
  expect(parseSubscriptionCard({ ...subscriptionPlan.card, number: '1234567890123456' })).toBeNull();
  expect(parseGoodsSubscription({ ...subscriptionPlan, addressRevision: 'not UUID' })).toBeNull();
});
it('100건 초과 전체 건수라도 50건 페이지를 받고 마이크로초 커서를 보존한다', () => {
  const value = { rows: [subscriptionPlan], total: 105, hasMore: true, nextCursor: { updatedAt: subscriptionPlan.updatedAt, id: subscriptionPlan.id } };
  expect(parseSubscriptionPlanPage(value)).toEqual(value);
  expect(parseSubscriptionPlanPage({ ...value, nextCursor: null })).toBeNull();
  expect(parseSubscriptionPlanPage({ ...value, rows: Array(101).fill(subscriptionPlan) })).toBeNull();
});
it('회차 cursor는 내림차순 마지막 행과 일치해야 하며 과거 회차도 표시한다', () => {
  const recent = { ...subscriptionCycle, id: subscriptionId(100), number: 66 };
  expect(parseSubscriptionCyclePage({ rows: [recent, subscriptionCycle], total: 66, hasMore: true, nextBeforeNumber: 1 })).not.toBeNull();
  expect(parseSubscriptionCyclePage({ rows: [recent], total: 66, hasMore: true, nextBeforeNumber: 65 })).toBeNull();
  expect(parseSubscriptionCyclePage({ rows: [subscriptionCycle, recent], total: 66, hasMore: false, nextBeforeNumber: null })).toBeNull();
});

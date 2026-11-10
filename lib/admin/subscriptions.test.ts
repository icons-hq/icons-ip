import { expect, it } from 'vitest';
import { adminSubscriptionRow } from '../../test/fixtures/goods-subscriptions';
import { adminSubscriptionsHref, normalizeAdminSubscriptionFilters, parseAdminSubscriptionData, parseAdminSubscriptionRow, subscriptionExportRows } from './subscriptions';
it('화면 검색 조건과 페이지를 정규화하고 링크에 같은 조건을 보존한다', () => {
  const filters = normalizeAdminSubscriptionFilters({ state: 'active', query: '  상품 & 가  ', page: '3' });
  expect(filters).toEqual({ state: 'active', query: '상품 & 가', page: 3 });
  expect(new URL(adminSubscriptionsHref(filters, 4), 'https://example.test').searchParams.get('query')).toBe('상품 & 가');
  expect(normalizeAdminSubscriptionFilters({ state: 'bogus', page: '-1' })).toEqual({ state: null, query: '', page: 1 });
});
it('운영 DTO는 주소·카드·binding 원문을 넘기지 않고 금액형 오류를 거절한다', () => {
  expect(parseAdminSubscriptionRow({ ...adminSubscriptionRow, envelope: {}, address: { phone: 'secret' } })).toEqual(adminSubscriptionRow);
  expect(parseAdminSubscriptionRow({ ...adminSubscriptionRow, renewalOnlineTotal: '16000' })).toBeNull();
  expect(parseAdminSubscriptionData({ rows: [adminSubscriptionRow], total: 105, page: 3, pageSize: 50, asOf: adminSubscriptionRow.updatedAt }, { state: null, query: '', page: 2 })).toBeNull();
});
it('파일은 온라인 금액·별도 착불·결제완료 누계의 서로 다른 열을 보존한다', () => {
  const values = subscriptionExportRows([adminSubscriptionRow])[0];
  expect(values.slice(7, 12)).toEqual([16000, 3000, 2, 1, 16000]); expect(values).not.toContain('customerKey');
});

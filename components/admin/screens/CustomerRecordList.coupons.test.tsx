import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/app/admin/coupon-revoke-actions', () => ({ revokeUserCouponsAction: vi.fn() }));
import { CustomerRecordList } from './CustomerRecordList';

const rows = [
  { id: 'bf702800-0000-4000-8000-000000000001', createdAt: '2026-11-18T01:00:00Z', title: '보유 쿠폰', code: 'HOLD-1', status: 'active', expiresAt: '2026-12-18T01:00:00Z' },
  { id: 'bf702800-0000-4000-8000-000000000002', createdAt: '2026-11-18T01:00:00Z', title: '쓴 쿠폰', code: 'USED-1', status: 'used', expiresAt: null },
  { id: 'bf702800-0000-4000-8000-000000000003', createdAt: '2026-11-18T01:00:00Z', title: '회수 쿠폰', code: 'REV-1', status: 'revoked', expiresAt: '2026-11-18T00:00:00Z' },
];

it('쿠폰 탭은 회수 권한이 있을 때 보유 쿠폰 줄에만 회수 버튼을 보이고 회수됨을 따로 표시한다', () => {
  const html = renderToStaticMarkup(<CustomerRecordList tab="coupons" items={rows} canRevokeCoupons />);
  expect(html).toContain('쿠폰 회수 보유 쿠폰');
  expect(html).not.toContain('쿠폰 회수 쓴 쿠폰');
  expect(html).not.toContain('쿠폰 회수 회수 쿠폰');
  expect(html).toContain('회수됨');
  /* 회수된 줄의 만료 시각은 회수 때 당겨 둔 값이라 보이지 않는다. */
  expect(html.match(/만료 ·/g)).toHaveLength(1);
});

it('회수 권한이 없으면 버튼이 없다', () => {
  expect(renderToStaticMarkup(<CustomerRecordList tab="coupons" items={rows} />)).not.toContain('쿠폰 회수');
});

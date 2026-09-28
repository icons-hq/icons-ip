import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ShippingRegionExpiryNotice } from './ShippingRegionExpiryNotice';

it('만료 임박·종료 상태와 설정 동선을 표시한다', () => {
  const html = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [
    { id: 'one', name: '기존 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' },
    { id: 'two', name: '현재 정책', version: 2, endsAt: '2026-10-01T00:00:00Z', status: 'expiring' },
  ] }} />);
  expect(html).toContain('정책 만료');
  expect(html).toContain('7일 이내 만료');
  expect(html).toContain('href="/admin/settings/shipping-regions"');
  expect(html).toContain('기존 정책');
  expect(html).toContain('현재 정책');
});

it('경고가 없으면 영역을 숨기고 조회 실패는 별도로 알린다', () => {
  expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [] }} />)).toBe('');
  expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], unavailable: true }} />)).toContain('만료 여부를 확인할 수 없으므로');
});

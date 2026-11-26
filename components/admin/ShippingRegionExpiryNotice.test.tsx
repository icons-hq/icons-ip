import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { ShippingRegionExpiryNotice } from './ShippingRegionExpiryNotice';

it('곧 끝나는·끝난 설정과 설정 화면 링크를 보이고, 내부 버전 번호는 보이지 않는다', () => {
  const html = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [
    { originName:'김포',carrierLabel:'한진택배', id: 'one', name: '기존 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' },
    { originName:'남양주',carrierLabel:'우체국택배', id: 'two', name: '현재 정책', version: 2, endsAt: '2026-10-01T00:00:00Z', status: 'expiring' },
  ] }} />);
  expect(html).toContain('기간 끝남');
  expect(html).toContain('7일 안에 끝남');
  for (const old of ['정책 만료', '7일 이내 만료', '버전', '지역 배송 정책', '지역 정책이']) expect(html, old).not.toContain(old);
  expect(html).toContain('href="/admin/settings/shipping-regions"');
  expect(html).toContain('김포');
  expect(html).toContain('남양주');
  expect(html).toContain('우체국택배');
  expect(html).toContain('기존 정책');
  expect(html).toContain('현재 정책');
});

it('경고가 없으면 영역을 숨기고 조회 실패는 별도로 알린다', () => {
  expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [] }} />)).toBe('');
  expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], unavailable: true }} />)).toContain('적용 기간이 끝났는지 알 수 없으니');
});

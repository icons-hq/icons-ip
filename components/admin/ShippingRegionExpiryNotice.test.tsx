import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ShippingRegionExpiryNotice } from './ShippingRegionExpiryNotice';

it('곧 끝나는·끝난 설정과 설정 화면 링크를 보이고, 내부 버전 번호는 보이지 않는다', () => {
  const html = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [
    { originName:'김포',carrierLabel:'한진택배', originId: 'origin-1', id: 'one', name: '기존 정책', version: 1, endsAt: '2026-09-27T00:00:00Z', status: 'expired' },
    { originName:'남양주',carrierLabel:'우체국택배', originId: 'origin-2', id: 'two', name: '현재 정책', version: 2, endsAt: '2026-10-01T00:00:00Z', status: 'expiring' },
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

describe('새 주문이 막힌 출고지 (S5-1)', () => {
  const warning = (status: 'expired' | 'expiring', originId: string) => ({ originName: '김포', carrierLabel: '한진택배', originId, id: `w-${originId}-${status}`, name: '기존 설정', version: 1, endsAt: '2026-09-27T00:00:00Z', status });
  it('막힌 출고지는 이름과 까닭을 한 줄로 말하고 지역별 추가배송비 화면으로 데려간다', () => {
    const html = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], blocked: [
      { originId: 'origin-1', originName: '김포', reason: 'ended' },
      { originId: 'origin-2', originName: '남양주', reason: 'next_scheduled', nextStartsAt: '2026-12-03T00:00:00Z' },
      { originId: 'origin-3', originName: '파주', reason: 'carrier_off' },
      { originId: 'origin-4', originName: '인천', reason: 'carrier_mismatch' },
    ] }} />);
    expect(html).toContain('새 주문 막힘');
    expect(html).toContain('김포 · 지역별 추가배송비 설정이 끝나 새 주문이 막혀 있습니다.');
    expect(html).toContain('남양주 · 지역별 추가배송비 설정이 끝나 새 주문이 막혀 있습니다. 다음 설정이');
    expect(html).toContain('파주 · 기본 택배사가 없거나 ‘사용 안 함’이라');
    expect(html).toContain('인천 · 출고지의 기본 택배사가');
    expect(html).toContain('새 설정을 적용하면 주문을 다시 받습니다');
    expect(html).toContain('href="/admin/settings/shipping-regions"');
    /* 기간이 끝나는 출고지가 없으면 그 안내(끝나기 전에 다음 설정을...)는 말하지 않는다. */
    expect(html).not.toContain('끝나기 전에 다음 설정을 만들어 적용해주세요');
    expect(html).not.toMatch(/정책|버전/);
  });
  it('이미 기간 끝남으로 알린 출고지는 같은 까닭이라 다시 적지 않고, 7일 안에 끝남은 막힘과 별개다', () => {
    const ended = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [warning('expired', 'origin-1')], blocked: [{ originId: 'origin-1', originName: '김포', reason: 'ended' }] }} />);
    expect(ended).toContain('기간 끝남');
    expect(ended).not.toContain('새 주문 막힘');
    expect(ended).not.toContain('새 설정을 적용하면 주문을 다시 받습니다');
    const expiring = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [warning('expiring', 'origin-1')], blocked: [{ originId: 'origin-1', originName: '김포', reason: 'ended' }] }} />);
    expect(expiring).toContain('7일 안에 끝남');
    expect(expiring).toContain('새 주문 막힘');
  });
  it('막힌 출고지만 있어도 영역이 보이고, 아무것도 없으면 숨긴다', () => {
    expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], blocked: [] }} />)).toBe('');
    expect(renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], blocked: [{ originId: 'origin-1', originName: '김포', reason: 'ended' }] }} />)).toContain('지역별 추가배송비 확인');
    /* 만료 조회를 읽지 못해도 막힌 출고지는 따로 말한다. */
    const both = renderToStaticMarkup(<ShippingRegionExpiryNotice state={{ warnings: [], unavailable: true, blocked: [{ originId: 'origin-1', originName: '김포', reason: 'ended' }] }} />);
    expect(both).toContain('적용 기간이 끝났는지 알 수 없으니');
    expect(both).toContain('새 주문 막힘');
  });
});

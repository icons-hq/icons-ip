import { describe, expect, it } from 'vitest';
import {
  adminShippingHref,
  adminShippingTab,
  adminShippingTransitDays,
  adminShippingTransitLabel,
  isAdminShippingStale,
  normalizeAdminShippingFilters,
} from './shipping';

const NOW = new Date('2026-08-18T06:00:00.000Z');

describe('배송현황 콘솔 필터', () => {
  it('알 수 없는 탭·페이지·기간은 기본값으로 접는다', () => {
    expect(normalizeAdminShippingFilters({
      tab: 'not-a-tab',
      page: '0',
      from: '2026-13-01',
      to: 'nope',
    })).toEqual({ tab: 'transit', from: null, to: null, query: '', page: 1 });
  });

  /* 뒤집힌 기간은 RPC가 check_violation으로 거절한다. 화면이 오류로 죽는 대신
     조건을 버려야 목록이 뜬다. */
  it('시작일이 종료일보다 늦으면 기간 조건을 통째로 버린다', () => {
    const filters = normalizeAdminShippingFilters({ from: '2026-08-10', to: '2026-08-01' });
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it('100자를 넘는 검색어는 RPC에 닿기 전에 버린다', () => {
    expect(normalizeAdminShippingFilters({ query: 'ㄱ'.repeat(101) }).query).toBe('');
  });

  it('링크는 탭과 페이지를 항상 실어 딥링크를 유지한다', () => {
    const filters = normalizeAdminShippingFilters({ tab: 'delivered', query: 'maple' });
    expect(adminShippingHref(filters, { page: 3 }))
      .toBe('/admin/sales/shipping?tab=delivered&query=maple&page=3');
  });

  it('탭은 사다리의 상태 한 칸을 가리킨다', () => {
    expect(adminShippingTab('transit').status).toBe('shipping');
    expect(adminShippingTab('delivered').status).toBe('delivered');
  });
});

describe('배송 경과일', () => {
  it('발송 시각부터 일 단위로 센다', () => {
    expect(adminShippingTransitDays('2026-08-15T06:00:00.000Z', NOW)).toBe(3);
    expect(adminShippingTransitLabel('2026-08-15T06:00:00.000Z', NOW)).toBe('3일');
  });

  /* 발송 기록이 없는 주문을 0일로 접으면 오래 떠 있는 배송이 목록에서 가장
     안전해 보인다. 없는 값은 없다고 적는다. */
  it('발송 기록이 없으면 경과일을 지어내지 않는다', () => {
    expect(adminShippingTransitDays(null, NOW)).toBeNull();
    expect(adminShippingTransitLabel(null, NOW)).toBe('미기록');
    expect(isAdminShippingStale(null, NOW)).toBe(false);
  });

  it('시계 오차로 들어온 미래 발송 시각을 음수로 흘리지 않는다', () => {
    expect(adminShippingTransitDays('2026-08-20T06:00:00.000Z', NOW)).toBe(0);
  });

  it('3일을 넘긴 배송을 강조 대상으로 표시한다', () => {
    expect(isAdminShippingStale('2026-08-16T06:00:00.000Z', NOW)).toBe(false);
    expect(isAdminShippingStale('2026-08-15T06:00:00.000Z', NOW)).toBe(true);
  });
});

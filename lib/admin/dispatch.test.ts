import { describe, expect, it } from 'vitest';
import {
  adminDispatchElapsedLabel,
  adminDispatchHref,
  adminDispatchItemLabel,
  adminDispatchItemSummary,
  adminDispatchTab,
  normalizeAdminDispatchFilters,
} from './dispatch';
import type { AdminOrderItemRecord } from './orders';

function item(overrides: Partial<AdminOrderItemRecord> = {}): AdminOrderItemRecord {
  return { id: 'i1', name: '홍실 아크릴 블록', type: '아크릴 블록', qty: 1, unitPrice: 27000, ...overrides };
}

describe('발주·발송 콘솔 필터', () => {
  it('알 수 없는 탭·페이지·기간은 기본값으로 접는다', () => {
    expect(normalizeAdminDispatchFilters({
      tab: 'not-a-tab',
      page: '0',
      from: '2026-13-01',
      to: 'nope',
    })).toEqual({ tab: 'new', from: null, to: null, query: '', page: 1 });
  });

  /* 뒤집힌 기간은 RPC가 check_violation으로 거절한다. 화면이 오류로 죽는 대신
     조건을 버려야 목록이 뜬다. */
  it('시작일이 종료일보다 늦으면 기간 조건을 통째로 버린다', () => {
    const filters = normalizeAdminDispatchFilters({ from: '2026-08-10', to: '2026-08-01' });
    expect(filters.from).toBeNull();
    expect(filters.to).toBeNull();
  });

  it('100자를 넘는 검색어는 RPC에 닿기 전에 버린다', () => {
    expect(normalizeAdminDispatchFilters({ query: 'ㄱ'.repeat(101) }).query).toBe('');
    expect(normalizeAdminDispatchFilters({ query: 'ㄱ'.repeat(100) }).query).toBe('ㄱ'.repeat(100));
  });

  it('링크는 탭과 페이지를 항상 실어 딥링크를 유지한다', () => {
    const filters = normalizeAdminDispatchFilters({ query: 'maple', from: '2026-08-01' });
    expect(adminDispatchHref(filters, { page: 3 }))
      .toBe('/admin/sales/dispatch?tab=new&from=2026-08-01&query=maple&page=3');
  });

  it('탭은 사다리의 상태 한 칸을 가리킨다', () => {
    expect(adminDispatchTab('new').status).toBe('paid');
  });
});

describe('굿즈 요약', () => {
  it('대표 품목과 나머지 건수, 수량 합을 나눠 낸다', () => {
    const summary = adminDispatchItemSummary([
      item({ id: 'i1', name: '홍실 아크릴 블록', qty: 2 }),
      item({ id: 'i2', name: '화산강림 스탠드', qty: 3 }),
      item({ id: 'i3', name: '포스터', qty: 1 }),
    ]);

    expect(summary).toEqual({ leadName: '홍실 아크릴 블록', otherCount: 2, totalQty: 6 });
    expect(adminDispatchItemLabel(summary)).toBe('홍실 아크릴 블록 외 2건');
  });

  it('단일 품목에는 "외 N건"을 붙이지 않는다', () => {
    expect(adminDispatchItemLabel(adminDispatchItemSummary([item({ qty: 4 })])))
      .toBe('홍실 아크릴 블록');
  });

  /* 품목 조회가 비어도 행은 떠야 한다. 발주확인은 주문 단위 조작이라 품목이
     비었다는 사실 자체가 운영자가 봐야 할 신호다. */
  it('품목이 없는 주문도 행을 만들 수 있게 접는다', () => {
    expect(adminDispatchItemSummary([])).toEqual({
      leadName: '품목 없음',
      otherCount: 0,
      totalQty: 0,
    });
  });
});

describe('경과시간', () => {
  const created = '2026-08-18T00:00:00.000Z';

  it.each([
    ['30초 뒤', '2026-08-18T00:00:30.000Z', '방금'],
    ['40분 뒤', '2026-08-18T00:40:00.000Z', '40분'],
    ['5시간 뒤', '2026-08-18T05:00:00.000Z', '5시간'],
    ['3일 뒤', '2026-08-21T00:00:00.000Z', '3일'],
  ])('%s는 %s를 %s로 표기한다', (_label, now, expected) => {
    expect(adminDispatchElapsedLabel(created, new Date(now))).toBe(expected);
  });

  /* 하루를 넘긴 주문이 전부 "1일"로 보이면 3일 묵은 적체를 찾을 수 없다. */
  it('하루를 넘긴 주문은 일 단위로 계속 커진다', () => {
    expect(adminDispatchElapsedLabel(created, new Date('2026-08-19T00:00:00.000Z'))).toBe('1일');
    expect(adminDispatchElapsedLabel(created, new Date('2026-08-25T00:00:00.000Z'))).toBe('7일');
  });

  /* 시계 오차로 미래 타임스탬프가 들어와도 음수를 내보내지 않는다. */
  it('미래 시각은 방금으로 접고 깨진 값은 하이픈으로 접는다', () => {
    expect(adminDispatchElapsedLabel(created, new Date('2026-08-17T00:00:00.000Z'))).toBe('방금');
    expect(adminDispatchElapsedLabel('not-a-date', new Date(created))).toBe('-');
  });
});

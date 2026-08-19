import { describe, expect, it } from 'vitest';
import {
  ADMIN_DISPATCH_DELAY_DAYS,
  adminDispatchConfirmedDays,
  adminDispatchConfirmedDaysLabel,
  adminDispatchDelayThreshold,
  adminDispatchElapsedLabel,
  adminDispatchHref,
  adminDispatchItemLabel,
  adminDispatchItemSummary,
  adminDispatchTab,
  isAdminDispatchDelayed,
  normalizeAdminDispatchDelayForm,
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
    expect(adminDispatchTab('ready').status).toBe('confirmed');
  });

  /* 발송지연은 상태가 아니라 같은 confirmed를 오래 묵은 것만 남긴 뷰다. 새 enum
     값을 만들면 발송처리 때 되돌려야 하는 전이가 생긴다(#251). */
  it('발송지연 탭은 새 상태가 아니라 confirmed의 부분집합이다', () => {
    expect(adminDispatchTab('delayed').status).toBe('confirmed');
    expect(adminDispatchTab('delayed')).toHaveProperty('delayedOnly', true);
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

describe('발주확인 경과일과 발송지연', () => {
  const now = new Date('2026-08-18T06:00:00.000Z');

  it('발주확인 시각부터 일 단위로 센다', () => {
    expect(adminDispatchConfirmedDays('2026-08-14T06:00:00.000Z', now)).toBe(4);
    expect(adminDispatchConfirmedDaysLabel('2026-08-14T06:00:00.000Z', now)).toBe('4일');
  });

  /* 사다리 도입 전 행은 confirmed_at이 비어 있다. 0일로 접으면 방금 발주확인한
     주문과 구분되지 않고, 지연 목록에서도 가장 안전해 보인다. */
  it('발주확인 기록이 없으면 경과일을 지어내지 않는다', () => {
    expect(adminDispatchConfirmedDays(null, now)).toBeNull();
    expect(adminDispatchConfirmedDaysLabel(null, now)).toBe('미기록');
    expect(isAdminDispatchDelayed(null, now)).toBe(false);
  });

  it('시계 오차로 들어온 미래 발주확인 시각을 음수로 흘리지 않는다', () => {
    expect(adminDispatchConfirmedDays('2026-08-20T06:00:00.000Z', now)).toBe(0);
  });

  it('임계값 이상 묵은 주문만 지연으로 본다', () => {
    expect(ADMIN_DISPATCH_DELAY_DAYS).toBe(3);
    expect(isAdminDispatchDelayed('2026-08-16T06:00:00.000Z', now)).toBe(false);
    expect(isAdminDispatchDelayed('2026-08-15T06:00:00.000Z', now)).toBe(true);
  });

  /* 며칠을 지연으로 볼지는 운영 정책이다. 경계 계산을 앱에 두면 정책이 바뀌어도
     마이그레이션이 필요 없다 — DB 함수는 절대 시각만 받는다. */
  it('지연 경계를 절대 시각으로 낸다', () => {
    expect(adminDispatchDelayThreshold(now).toISOString()).toBe('2026-08-15T06:00:00.000Z');
  });
});

describe('지연 메모 폼', () => {
  const ORDER_ID = '11111111-1111-4111-8111-111111111111';

  function form(values: Record<string, string>) {
    const formData = new FormData();
    for (const [key, value] of Object.entries(values)) formData.set(key, value);
    return formData;
  }

  it('사유와 발송 예정일을 함께 저장한다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: ' 작가 재입고 지연 ',
      expectedShipDate: '2026-08-20',
    }))).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, reason: '작가 재입고 지연', expectedShipDate: '2026-08-20' },
    });
  });

  /* 모르는 날짜를 지어내면 CS에서 그대로 약속이 된다. 비우는 것이 정상 경로다. */
  it('발송 예정일은 비워 둘 수 있다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: '재고 확인 중',
      expectedShipDate: '',
    }))).toMatchObject({ ok: true, value: { expectedShipDate: null } });
  });

  /* 해제 수단이 없으면 운영자가 사유를 '해결'로 덮어쓰고 지연 목록이 줄지 않는다. */
  it('사유를 비우면 메모 해제로 읽고 예정일도 함께 버린다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: ORDER_ID,
      reason: '   ',
      expectedShipDate: '2026-08-20',
    }))).toEqual({
      ok: true,
      value: { orderId: ORDER_ID, reason: null, expectedShipDate: null },
    });
  });

  /* 운영자가 적은 날짜가 조용히 사라지면 저장된 줄 안다. */
  it('깨진 주문 id와 날짜는 버리지 않고 되돌린다', () => {
    expect(normalizeAdminDispatchDelayForm(form({
      orderId: 'not-a-uuid',
      reason: '재고 확인 중',
      expectedShipDate: '2026-02-30',
    }))).toEqual({
      ok: false,
      errors: {
        orderId: '주문을 찾을 수 없습니다.',
        expectedShipDate: '발송 예정일을 YYYY-MM-DD 형식으로 입력해주세요.',
      },
    });
  });
});

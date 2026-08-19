import { describe, expect, it } from 'vitest';
import {
  adminDefectClaimLabel,
  adminDefectClaimWindow,
  adminSettledHref,
  normalizeAdminSettledFilters,
} from './settled';

const DELIVERED = '2026-05-20T06:00:00.000Z';

describe('하자 클레임 잔여 기한', () => {
  /* 기산점은 done_at이 아니라 delivered_at이다 — 확정일은 자동 잡이 찍은 운영
     시각이고, 법정 기산점은 재화를 공급받은 날이다(#189). */
  it('공급받은 날부터 3개월을 기준으로 남은 기간을 낸다', () => {
    const window = adminDefectClaimWindow(DELIVERED, new Date('2026-08-18T06:00:00.000Z'));

    expect(window.deadline?.toISOString()).toBe('2026-08-20T06:00:00.000Z');
    expect(window.daysRemaining).toBe(2);
    expect(window.open).toBe(true);
    expect(adminDefectClaimLabel(window)).toBe('가능 · 2일 남음');
  });

  it('3개월이 지난 주문은 기한 종료로 표기한다', () => {
    const window = adminDefectClaimWindow(DELIVERED, new Date('2026-09-01T06:00:00.000Z'));

    expect(window.daysRemaining).toBe(0);
    expect(window.open).toBe(false);
    expect(adminDefectClaimLabel(window)).toBe('기한 종료');
  });

  /* 추측한 기산점으로 "기한 지남"을 띄우면 정당한 클레임을 거절하는 근거가 된다.
     공급 기록이 없으면 판단하지 않고 원장을 보라고 말한다. */
  it('공급일이 없으면 기한을 지어내지 않는다', () => {
    const window = adminDefectClaimWindow(null, new Date('2026-09-01T06:00:00.000Z'));

    expect(window.deadline).toBeNull();
    expect(window.daysRemaining).toBeNull();
    expect(window.open).toBe(false);
    expect(adminDefectClaimLabel(window)).toBe('공급일 미기록 · 원장 확인 필요');
  });
});

describe('거래확정 내역 필터', () => {
  it('잘못된 페이지·기간을 기본값으로 접는다', () => {
    expect(normalizeAdminSettledFilters({ page: '-3', from: '2026-02-30' }))
      .toEqual({ from: null, to: null, query: '', page: 1 });
  });

  it('뒤집힌 기간은 조건을 통째로 버린다', () => {
    expect(normalizeAdminSettledFilters({ from: '2026-08-10', to: '2026-08-01' }))
      .toMatchObject({ from: null, to: null });
  });

  it('링크는 페이지를 항상 실어 딥링크를 유지한다', () => {
    const filters = normalizeAdminSettledFilters({ query: 'maple', to: '2026-08-18' });
    expect(adminSettledHref(filters, { page: 2 }))
      .toBe('/admin/sales/settled?to=2026-08-18&query=maple&page=2');
  });
});

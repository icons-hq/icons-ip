import { describe, expect, it } from 'vitest';
import {
  adminPercentLabel,
  adminRepeatRate,
  adminShareOfTotal,
  adminStatsHref,
  adminStatsRange,
  normalizeAdminStatsFilters,
} from './stats';

describe('normalizeAdminStatsFilters', () => {
  it('프리셋 기간만 받아들인다', () => {
    expect(normalizeAdminStatsFilters({ days: '7' }).days).toBe(7);
    expect(normalizeAdminStatsFilters({ days: '90' }).days).toBe(90);
  });

  /* 임의 기간은 CSV와 함께 후속이다. 검증 없이 넘기면 DB가 거절한다. */
  it('프리셋이 아닌 값은 기본 30일로 되돌린다', () => {
    expect(normalizeAdminStatsFilters({ days: '365' }).days).toBe(30);
    expect(normalizeAdminStatsFilters({ days: '-1' }).days).toBe(30);
    expect(normalizeAdminStatsFilters({}).days).toBe(30);
  });

  it('IP 필터의 공백을 다듬는다', () => {
    expect(normalizeAdminStatsFilters({ ip: '  hwasan  ' }).ipId).toBe('hwasan');
  });
});

describe('adminStatsRange', () => {
  /*
   * 끝을 "지금"이 아니라 다음 KST 자정으로 잡는다. DB 버킷이 KST 일자라
   * 오후에 열면 오늘 버킷이 반쯤 잘려 보인다.
   */
  it('오늘 KST 자정 다음날까지를 끝으로 잡는다', () => {
    const range = adminStatsRange(7, new Date('2026-08-18T05:00:00.000Z'));
    expect(range.to).toBe('2026-08-18T15:00:00.000Z');
  });

  it('시작은 기간 첫날의 KST 자정이다', () => {
    const range = adminStatsRange(7, new Date('2026-08-18T05:00:00.000Z'));
    /* 2026-08-18 KST에서 6일 전인 08-12 자정(KST) = 08-11T15:00Z */
    expect(range.from).toBe('2026-08-11T15:00:00.000Z');
  });

  it('KST 자정 직후에 열어도 오늘이 창 안에 있다', () => {
    /* 2026-08-18T15:10Z = KST 2026-08-19 00:10 */
    const range = adminStatsRange(7, new Date('2026-08-18T15:10:00.000Z'));
    expect(range.to).toBe('2026-08-19T15:00:00.000Z');
  });
});

describe('adminStatsHref', () => {
  it('기본 기간은 URL에 남기지 않는다', () => {
    expect(adminStatsHref('/admin/stats/sales', { days: 30, ipId: '' }))
      .toBe('/admin/stats/sales');
  });

  it('기간과 IP를 함께 유지한다', () => {
    expect(adminStatsHref('/admin/stats/sales', { days: 7, ipId: 'hwasan' }))
      .toBe('/admin/stats/sales?days=7&ip=hwasan');
  });
});

describe('adminShareOfTotal', () => {
  it('소수 첫째 자리까지 구성비를 낸다', () => {
    expect(adminShareOfTotal(23000, 69000)).toBe(33.3);
  });

  /*
   * "무통장 0%"와 "판매 없음"은 다른 사실이다. 0%로 적으면 운영자가 결제수단을
   * 껐다고 읽는다.
   */
  it('분모가 0이면 비율이 아니라 값 없음이다', () => {
    expect(adminShareOfTotal(0, 0)).toBeNull();
    expect(adminPercentLabel(adminShareOfTotal(0, 0))).toBe('—');
    expect(adminPercentLabel(33.3)).toBe('33.3%');
  });
});

describe('adminRepeatRate', () => {
  it('구매자 대비 재구매자 비율이다', () => {
    expect(adminRepeatRate(1, 2)).toBe(50);
  });

  it('구매자가 없으면 비율이 없다', () => {
    expect(adminRepeatRate(0, 0)).toBeNull();
  });
});

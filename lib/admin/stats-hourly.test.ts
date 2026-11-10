import { describe, expect, it } from 'vitest';
import { adminSalesHourRange, adminSalesHourState, adminSalesHourlyHref, adminSalesHourlyTime, normalizeAdminSalesHourlyFilters, parseAdminSalesHourlyReport, SalesHourlyReadError } from './stats-hourly';
import { salesHourlyFixture } from './stats-hourly.test-fixtures';

const filters = normalizeAdminSalesHourlyFilters({});
describe('시간대별 판매 조회 계약', () => {
  it('기존 기간/전년 조건을 섞지 않고 비교일·IP·정시를 읽는다', () => {
    expect(filters).toEqual({ comparisonDate: null, ipId: '', cutoff: null });
    expect(normalizeAdminSalesHourlyFilters({ compareDate: [], ip: [], cutoff: [] })).toEqual(filters);
    const selected = normalizeAdminSalesHourlyFilters({ compareDate: ['2026-10-07', '2026-10-01'], ip: ' abc ', cutoff: '2026-10-14T07:00:00+09:00', from: '2026-01-01', compare: 'year' });
    expect(selected).toEqual({ comparisonDate: '2026-10-07', ipId: 'abc', cutoff: '2026-10-13T22:00:00.000Z' });
    expect(Object.fromEntries(new URL(adminSalesHourlyHref(selected), 'https://example.test').searchParams)).toEqual({ compareDate: '2026-10-07', ip: 'abc', cutoff: '2026-10-13T22:00:00.000Z' });
  });
  it.each([{ compareDate: '2026-02-30' }, { compareDate: '0000-01-01' }, { compareDate: '2026-2-1' }, { cutoff: '2026-10-14T07:15:00+09:00' }, { cutoff: '2026-02-30T07:00:00+09:00' }, { cutoff: '2026-10-14T07:00:00+09:30' }, { cutoff: 'invalid' }, { ip: 'a'.repeat(65) }])('잘못된 입력은 기본값으로 조용히 조회하지 않는다: %j', params => {
    expect(normalizeAdminSalesHourlyFilters(params).error).toBeTruthy();
  });
  it('완료 구간의 관측 0과 이후 null·누적·전체 합계를 보존한다', () => {
    const value = parseAdminSalesHourlyReport(salesHourlyFixture(), filters);
    expect(value.hours[1]).toMatchObject({ orderCount: 0, revenue: 0, cumulativeOrderCount: 1, cumulativeRevenue: 1000 });
    expect(value.hours[7]).toMatchObject({ orderCount: null, cumulativeOrderCount: null });
    expect(value.summary).toEqual({ current: { orderCount: 3, revenue: 4000 }, comparison: { orderCount: 3, revenue: 2300 } });
    expect(adminSalesHourState(6, value)).toBe('집계 완료'); expect(adminSalesHourState(7, value)).toBe('집계 대기'); expect(adminSalesHourState(8, value)).toBe('미도래');
  });
  it('00시 마감에서는 오늘 관측 없음과 전날 마지막 1시간을 분리한다', () => {
    const value = parseAdminSalesHourlyReport(salesHourlyFixture(0), { ...filters, cutoff: '2026-10-13T15:00:00.000Z' });
    expect(value.summary.current).toBeNull(); expect(value.todayGoods).toEqual([]); expect(value.lastHourGoods).toHaveLength(1);
    expect(adminSalesHourlyTime(value.lastHourFrom)).toBe('2026-10-13 23:00:00');
    expect(adminSalesHourlyTime(value.comparisonLastHourFrom)).toBe('2026-10-06 23:00:00');
    expect(adminSalesHourState(3, value)).toBe('마감 이후'); expect(adminSalesHourRange(23)).toBe('23:00 ~ 24:00');
  });
  it('행·합계·기간·필터·같은 시점 중 하나라도 어긋나면 거부한다', () => {
    const broken: unknown[] = [null, { ...salesHourlyFixture(), hours: [] }, { ...salesHourlyFixture(), date: '2026-10-13' }, { ...salesHourlyFixture(), ipId: 'wrong-ip' }, { ...salesHourlyFixture(), comparisonDate: '2026-10-06' }, { ...salesHourlyFixture(), cutoff: '2026-10-14T07:01:00+09:00' }];
    const futureZero = salesHourlyFixture(); futureZero.hours[23].orderCount = 0; broken.push(futureZero);
    const cumulative = salesHourlyFixture(); cumulative.hours[6].cumulativeRevenue = 1; broken.push(cumulative);
    const total = salesHourlyFixture(); total.summary.current!.revenue = 1; broken.push(total);
    const duplicated = salesHourlyFixture(); duplicated.todayGoods.push({ ...duplicated.todayGoods[0], rank: 2 }); broken.push(duplicated);
    const midnightGoods = salesHourlyFixture(0); midnightGoods.todayGoods = salesHourlyFixture().todayGoods; broken.push(midnightGoods);
    for (const item of broken) expect(() => parseAdminSalesHourlyReport(item, filters)).toThrow(SalesHourlyReadError);
  });
  it('응답의 추가 고객/주문 필드를 화면 경계에 전달하지 않는다', () => {
    const raw = salesHourlyFixture();
    const value = parseAdminSalesHourlyReport({ ...raw, customerEmail: 'not-for-ui@example.test', todayGoods: raw.todayGoods.map(row => ({ ...row, orderId: 'private-order' })) }, filters);
    expect(JSON.stringify(value)).not.toContain('customerEmail'); expect(JSON.stringify(value)).not.toContain('private-order');
  });
});

import { describe, expect, it } from 'vitest';
import { nextSubscriptionSlot, parseSubscriptionSchedule, subscriptionSlotAt, subscriptionSlotTiming, type SubscriptionSchedule } from './schedule';

const monthly: SubscriptionSchedule = { unit: 'month', interval: 1, anchorDate: '2026-01-31', time: '09:00', monthEnd: false };

describe('KST 정기배송 일정', () => {
  it('1월31일 기준을 보존하여 2월말 뒤 다시 3월31일로 돌아간다', () => {
    expect([0, 1, 2, 3].map(slot => subscriptionSlotAt(monthly, slot))).toEqual([
      '2026-01-31T00:00:00.000Z', '2026-02-28T00:00:00.000Z', '2026-03-31T00:00:00.000Z', '2026-04-30T00:00:00.000Z',
    ]);
  });
  it('윤년·연말·명시한 매월 말일을 처리한다', () => {
    expect(subscriptionSlotAt({ ...monthly, anchorDate: '2028-01-31' }, 1)).toBe('2028-02-29T00:00:00.000Z');
    expect(subscriptionSlotAt({ ...monthly, anchorDate: '2026-11-30', interval: 3 }, 1)).toBe('2027-02-28T00:00:00.000Z');
    expect(subscriptionSlotAt({ ...monthly, anchorDate: '2026-02-28', monthEnd: true }, 1)).toBe('2026-03-31T00:00:00.000Z');
    expect(subscriptionSlotAt({ ...monthly, anchorDate: '2026-02-28', monthEnd: false }, 1)).toBe('2026-03-28T00:00:00.000Z');
  });
  it('주 단위는 KST 일자와 시각을 유지한다', () => {
    const weekly: SubscriptionSchedule = { unit: 'week', interval: 2, anchorDate: '2026-12-25', time: '00:30', monthEnd: false };
    expect(subscriptionSlotAt(weekly, 1)).toBe('2027-01-07T15:30:00.000Z');
    expect(subscriptionSlotAt(weekly, 2)).toBe('2027-01-21T15:30:00.000Z');
  });
  it('재개는 처리 시각 이후 원래 기준의 다음 회차 하나를 선택한다', () => {
    expect(nextSubscriptionSlot(monthly, new Date('2026-03-05T00:00:00Z'))).toEqual({ slot: 2, at: '2026-03-31T00:00:00.000Z' });
    expect(nextSubscriptionSlot(monthly, new Date('2026-03-31T00:00:00Z'))).toEqual({ slot: 3, at: '2026-04-30T00:00:00.000Z' });
    expect(nextSubscriptionSlot(monthly, new Date('2026-01-01T00:00:00Z'))).toEqual({ slot: 0, at: '2026-01-31T00:00:00.000Z' });
    expect(nextSubscriptionSlot({ ...monthly, unit: 'week', interval: 4 }, new Date('2026-03-05T00:00:00Z')))
      .toEqual({ slot: 2, at: '2026-03-28T00:00:00.000Z' });
  });
  it('지연 허용 경계를 넘은 회차는 미실행으로 분리한다', () => {
    expect(subscriptionSlotTiming('2026-10-14T00:00:00Z', new Date('2026-10-13T23:59:59Z'))).toBe('future');
    expect(subscriptionSlotTiming('2026-10-14T00:00:00Z', new Date('2026-10-15T00:00:00Z'))).toBe('due');
    expect(subscriptionSlotTiming('2026-10-14T00:00:00Z', new Date('2026-10-15T00:00:00.001Z'))).toBe('missed');
  });
  it.each([{ anchorDate: '2026-02-30' }, { anchorDate: '2026-13-01' }, { time: '24:00' },
    { interval: 4 }, { unit: 'week', interval: 3 }, { unit: 'week', monthEnd: true }, { extra: true }])('잘못된 일정 %j를 거절한다', change => {
    expect(parseSubscriptionSchedule({ ...monthly, ...change })).toBeNull();
  });
  it('실행량을 늘리는 무한 회차/잘못된 시각을 허용하지 않는다', () => {
    expect(() => subscriptionSlotAt(monthly, 1201)).toThrow('invalid_subscription_schedule');
    expect(() => subscriptionSlotAt(monthly, -1)).toThrow('invalid_subscription_schedule');
    expect(() => nextSubscriptionSlot(monthly, new Date('invalid'))).toThrow('invalid_subscription_schedule');
  });
});

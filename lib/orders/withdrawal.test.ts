import { describe, expect, it } from 'vitest';
import {
  orderWithdrawalDaysRemaining,
  orderWithdrawalDeadline,
  orderWithdrawalDeadlinePassed,
} from './withdrawal';

const DELIVERED = '2026-08-01T06:00:00.000Z';

describe('청약철회 기한 계산', () => {
  it('변심은 공급받은 날부터 7일, 하자는 3개월이다', () => {
    expect(orderWithdrawalDeadline(DELIVERED, 'change_of_mind')?.toISOString())
      .toBe('2026-08-08T06:00:00.000Z');
    expect(orderWithdrawalDeadline(DELIVERED, 'defect')?.toISOString())
      .toBe('2026-11-01T06:00:00.000Z');
  });

  /* delivered_at은 shipping→delivered 전이가 찍는다. 그 전 주문에 기한을 지어내면
     아직 시작하지 않은 창을 화면이 카운트다운한다(#250). */
  it('공급 전 주문에는 기한이 없다', () => {
    expect(orderWithdrawalDeadline(null, 'change_of_mind')).toBeNull();
    expect(orderWithdrawalDaysRemaining(null, 'defect', new Date(DELIVERED))).toBeNull();
    expect(orderWithdrawalDeadlinePassed(null, 'change_of_mind', new Date('2030-01-01T00:00:00.000Z')))
      .toBe(false);
  });

  /* SQL은 `deadline < at`이다. 경계 시각 정각은 아직 유효하다 — 부등호가 갈리면
     구매자가 열려 있다고 읽은 창을 서버가 닫는다. */
  it('경계 시각 정각은 아직 지나지 않은 것으로 본다', () => {
    expect(orderWithdrawalDeadlinePassed(DELIVERED, 'change_of_mind', new Date('2026-08-08T06:00:00.000Z')))
      .toBe(false);
    expect(orderWithdrawalDeadlinePassed(DELIVERED, 'change_of_mind', new Date('2026-08-08T06:00:00.001Z')))
      .toBe(true);
  });

  /* Postgres의 `interval '3 months'`는 그 달의 마지막 날로 자른다. JS 기본
     동작(다음 달로 넘김)을 그대로 쓰면 화면이 DB보다 하루 긴 기한을 약속한다. */
  it('3개월 덧셈은 월말을 넘기지 않고 잘라낸다', () => {
    expect(orderWithdrawalDeadline('2026-01-31T06:00:00.000Z', 'defect')?.toISOString())
      .toBe('2026-04-30T06:00:00.000Z');
    expect(orderWithdrawalDeadline('2026-11-30T06:00:00.000Z', 'defect')?.toISOString())
      .toBe('2027-02-28T06:00:00.000Z');
  });

  it('남은 일수는 올림해 하루가 남지 않은 창을 0일로 접지 않는다', () => {
    expect(orderWithdrawalDaysRemaining(DELIVERED, 'change_of_mind', new Date('2026-08-01T06:00:00.000Z')))
      .toBe(7);
    // 마감까지 2시간 — 아직 요청할 수 있다.
    expect(orderWithdrawalDaysRemaining(DELIVERED, 'change_of_mind', new Date('2026-08-08T04:00:00.000Z')))
      .toBe(1);
    expect(orderWithdrawalDaysRemaining(DELIVERED, 'change_of_mind', new Date('2026-08-09T06:00:00.000Z')))
      .toBe(0);
  });

  it('깨진 타임스탬프는 기한 없음으로 접는다', () => {
    expect(orderWithdrawalDeadline('not-a-date', 'defect')).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { coinReasonLabel, formatCoinDelta, isCoinReason, kstTodayIsoDate } from './coins';

describe('coinReasonLabel', () => {
  it('원장 사유를 참여자 언어로 옮긴다', () => {
    expect(coinReasonLabel('attendance')).toBe('출석 체크 적립');
    expect(coinReasonLabel('exchange')).toBe('카드팩 교환 사용');
  });

  /* 사용자-facing 표면에서 '가챠·뽑기·충전' 금지(CONTEXT.md). */
  it('교환 문구에 금지 어휘를 쓰지 않는다', () => {
    const label = coinReasonLabel('exchange');
    expect(label).not.toContain('가챠');
    expect(label).not.toContain('뽑기');
    expect(label).not.toContain('충전');
  });

  it('모르는 사유도 줄을 잃지 않는다', () => {
    expect(coinReasonLabel('mystery')).toBe('코인 변동');
    expect(isCoinReason('mystery')).toBe(false);
  });
});

describe('formatCoinDelta', () => {
  /* 적립과 사용이 한 목록에 섞이므로 부호 없이는 색으로만 구분해야 한다. */
  it('부호를 항상 붙인다', () => {
    expect(formatCoinDelta(1)).toBe('+1');
    expect(formatCoinDelta(-30)).toBe('−30');
    expect(formatCoinDelta(0)).toBe('+0');
  });

  it('네 자리부터 천 단위를 끊는다', () => {
    expect(formatCoinDelta(1200)).toBe('+1,200');
    expect(formatCoinDelta(-1200)).toBe('−1,200');
  });

  it('음수 기호는 하이픈이 아니라 U+2212 다', () => {
    expect(formatCoinDelta(-1).charCodeAt(0)).toBe(0x2212);
  });
});

describe('kstTodayIsoDate', () => {
  /* attendance_check_in 이 (now() at time zone 'Asia/Seoul')::date 로 판정한다.
     UTC 로 재면 한국 사용자에게 오전 9시 리셋으로 보인다. */
  it('KST 자정 경계로 날짜를 센다', () => {
    expect(kstTodayIsoDate(new Date('2026-08-30T14:59:59.000Z'))).toBe('2026-08-30');
    expect(kstTodayIsoDate(new Date('2026-08-30T15:00:00.000Z'))).toBe('2026-08-31');
  });

  it('coin_attendance.attended_on 과 같은 YYYY-MM-DD 서식이다', () => {
    expect(kstTodayIsoDate(new Date('2026-01-05T00:00:00.000Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

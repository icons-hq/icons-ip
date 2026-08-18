import { describe, expect, it } from 'vitest';
import {
  consoleDatePresetRange,
  consoleDatePresets,
  isConsoleDateRangeActive,
  kstToday,
  shiftKstDay,
  shiftKstMonth,
} from './date-presets';

/** KST 정오에 해당하는 UTC 시각. 하루 경계에서 멀어 프리셋 계산이 안정적이다. */
function kstNoon(day: string) {
  return new Date(`${day}T03:00:00.000Z`);
}

describe('kstToday', () => {
  it('UTC 날짜가 아니라 KST 날짜를 돌려준다', () => {
    /* UTC 15:00은 이미 다음 날 KST 자정이다. UTC를 그대로 쓰면 하루가 밀린다. */
    expect(kstToday(new Date('2026-08-17T15:00:00.000Z'))).toBe('2026-08-18');
    expect(kstToday(new Date('2026-08-17T14:59:59.999Z'))).toBe('2026-08-17');
  });

  it('연말 자정 경계에서 해가 바뀐다', () => {
    expect(kstToday(new Date('2025-12-31T14:59:59.999Z'))).toBe('2025-12-31');
    expect(kstToday(new Date('2025-12-31T15:00:00.000Z'))).toBe('2026-01-01');
  });
});

describe('shiftKstDay', () => {
  it('월말과 연말을 넘어가며 일수를 더한다', () => {
    expect(shiftKstDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftKstDay('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftKstDay('2026-01-03', -6)).toBe('2025-12-28');
    expect(shiftKstDay('2025-12-31', 1)).toBe('2026-01-01');
  });

  it('형식이 아닌 값은 조용히 통과시키지 않는다', () => {
    expect(() => shiftKstDay('2026-8-1', -1)).toThrow(RangeError);
  });
});

describe('shiftKstMonth', () => {
  it('대상 월에 없는 날짜는 말일로 당긴다', () => {
    /* 2월 31일은 없다. 보정하지 않으면 Date가 3월로 넘겨 "1개월 전"이 미래가 된다. */
    expect(shiftKstMonth('2026-03-31', -1)).toBe('2026-02-28');
    expect(shiftKstMonth('2024-03-31', -1)).toBe('2024-02-29');
    expect(shiftKstMonth('2026-05-31', -1)).toBe('2026-04-30');
  });

  it('연 경계를 넘어도 같은 날짜를 유지한다', () => {
    expect(shiftKstMonth('2026-01-15', -1)).toBe('2025-12-15');
    expect(shiftKstMonth('2026-01-15', -3)).toBe('2025-10-15');
    expect(shiftKstMonth('2026-02-15', -3)).toBe('2025-11-15');
  });
});

describe('consoleDatePresetRange', () => {
  it('오늘 프리셋은 하루만 잡는다', () => {
    expect(consoleDatePresetRange('today', kstNoon('2026-08-18')))
      .toEqual({ from: '2026-08-18', to: '2026-08-18' });
  });

  it('1주 프리셋은 오늘을 포함한 7일이다', () => {
    expect(consoleDatePresetRange('week', kstNoon('2026-08-18')))
      .toEqual({ from: '2026-08-12', to: '2026-08-18' });
  });

  it('월말 기준일에서도 1개월·3개월이 실제 존재하는 날짜가 된다', () => {
    expect(consoleDatePresetRange('month', kstNoon('2026-03-31')))
      .toEqual({ from: '2026-02-28', to: '2026-03-31' });
    expect(consoleDatePresetRange('quarter', kstNoon('2026-03-31')))
      .toEqual({ from: '2025-12-31', to: '2026-03-31' });
  });

  it('연초 기준일에서 전년도로 넘어간다', () => {
    const now = kstNoon('2026-01-01');
    expect(consoleDatePresetRange('week', now)).toEqual({ from: '2025-12-26', to: '2026-01-01' });
    expect(consoleDatePresetRange('month', now)).toEqual({ from: '2025-12-01', to: '2026-01-01' });
    expect(consoleDatePresetRange('quarter', now)).toEqual({ from: '2025-10-01', to: '2026-01-01' });
  });

  it('KST 자정 직후 기준 시각은 이미 새 날짜로 계산한다', () => {
    expect(consoleDatePresetRange('today', new Date('2026-08-17T15:00:00.000Z')))
      .toEqual({ from: '2026-08-18', to: '2026-08-18' });
  });
});

describe('consoleDatePresets', () => {
  it('요청한 순서대로 라벨과 기간을 만든다', () => {
    const presets = consoleDatePresets(['today', 'quarter'], kstNoon('2026-08-18'));

    expect(presets.map((preset) => preset.label)).toEqual(['오늘', '3개월']);
    expect(presets[1].range).toEqual({ from: '2026-05-18', to: '2026-08-18' });
  });
});

describe('isConsoleDateRangeActive', () => {
  it('양끝이 모두 같을 때만 활성으로 본다', () => {
    const range = { from: '2026-08-12', to: '2026-08-18' };

    expect(isConsoleDateRangeActive(range, range)).toBe(true);
    expect(isConsoleDateRangeActive(range, { from: '2026-08-12', to: null })).toBe(false);
    expect(isConsoleDateRangeActive(range, null)).toBe(false);
  });
});

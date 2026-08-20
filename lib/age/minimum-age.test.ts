import { describe, expect, it } from 'vitest';
import {
  MINIMUM_SIGNUP_AGE,
  MINIMUM_AGE_POLICY_VERSION,
  koreanAge,
  meetsMinimumSignupAge,
} from './minimum-age';

/** KST 자정 기준으로 판정한다는 계약을 테스트에서도 그대로 쓴다. */
function kstNoon(date: string) {
  return new Date(`${date}T12:00:00+09:00`);
}

describe('한국식 만 나이', () => {
  it('생일 당일에 한 살 오른다', () => {
    expect(koreanAge('2012-08-20', kstNoon('2026-08-19'))).toBe(13);
    expect(koreanAge('2012-08-20', kstNoon('2026-08-20'))).toBe(14);
  });

  /*
   * 2/29생은 평년에 생일이 없다. 한국 민법 통설은 3월 1일 도래로 본다.
   * 2월 28일에 성인이 되는 쪽으로 계산하면 판정이 하루 이르다 — 미성년을
   * 하루 먼저 통과시키는 방향이라 보수적 선택이 아니다.
   */
  it('2월 29일생은 평년에 3월 1일 도래한다', () => {
    expect(koreanAge('2012-02-29', kstNoon('2026-02-28'))).toBe(13);
    expect(koreanAge('2012-02-29', kstNoon('2026-03-01'))).toBe(14);
  });

  it('윤년에는 2월 29일 당일에 도래한다', () => {
    expect(koreanAge('2012-02-29', kstNoon('2028-02-29'))).toBe(16);
  });

  /*
   * 서버가 UTC로 돌아도 판정 기준은 KST다. UTC 자정 직후는 KST로 이미 같은 날
   * 오전 9시이고, UTC 15:00은 KST로 이미 다음 날이다. 두 경계 모두 KST 날짜를
   * 따라야 이용자가 자기 나라 달력으로 이해하는 결과와 어긋나지 않는다.
   */
  it('판정 기준 시간대는 KST다 — 서버 타임존과 무관하다', () => {
    /* UTC 2026-08-19 15:00 = KST 2026-08-20 00:00 → 이미 생일 당일 */
    expect(koreanAge('2012-08-20', new Date('2026-08-19T15:00:00Z'))).toBe(14);
    /* UTC 2026-08-19 14:59 = KST 2026-08-19 23:59 → 아직 전날 */
    expect(koreanAge('2012-08-20', new Date('2026-08-19T14:59:00Z'))).toBe(13);
  });

  it('미래 생년월일은 음수 나이가 된다 — 별도 검증이 걸러야 할 입력이다', () => {
    expect(koreanAge('2030-01-01', kstNoon('2026-08-20'))).toBeLessThan(0);
  });
});

describe('가입 최소 연령', () => {
  it('v1 기준은 만 14세다', () => {
    expect(MINIMUM_SIGNUP_AGE).toBe(14);
  });

  it('정책 버전이 증거에 남길 수 있는 형태다', () => {
    expect(MINIMUM_AGE_POLICY_VERSION).toMatch(/^minimum_age_14@\d{4}-\d{2}-\d{2}$/);
  });

  it('경계일 당일부터 가입할 수 있다', () => {
    expect(meetsMinimumSignupAge('2012-08-21', kstNoon('2026-08-20'))).toBe(false);
    expect(meetsMinimumSignupAge('2012-08-20', kstNoon('2026-08-20'))).toBe(true);
  });

  /* 법정대리인 동의 경로를 제공하지 않으므로 만 14세 미만은 예외 없이 거부다(ADR-0009). */
  it('만 14세 미만은 예외 없이 거부한다', () => {
    expect(meetsMinimumSignupAge('2020-01-01', kstNoon('2026-08-20'))).toBe(false);
  });

  it('형식이 잘못된 값은 통과시키지 않는다 — 판정 불가는 거부다', () => {
    for (const value of ['', '2012-13-01', '2012-02-30', 'not-a-date', '12-08-20']) {
      expect(meetsMinimumSignupAge(value, kstNoon('2026-08-20')), value).toBe(false);
    }
  });
});

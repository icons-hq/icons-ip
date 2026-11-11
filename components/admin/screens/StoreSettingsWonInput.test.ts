import { describe, expect, it } from 'vitest';
import { normalizeWonInput, wonInputValid } from './StoreSettingsWonInput';

describe('WonInput 금액 정리', () => {
  it('쉼표·공백·통화 표시만 뺀다', () => {
    expect(normalizeWonInput('5,000')).toBe('5000');
    expect(normalizeWonInput(' ₩50,000원 ')).toBe('50000');
  });

  it('소수점·음수는 숫자를 이어 붙이지 않고 남겨 잘못된 값으로 표시한다', () => {
    expect(normalizeWonInput('5,000.00')).toBe('5000.00');
    expect(normalizeWonInput('-5000')).toBe('-5000');
    expect(wonInputValid('5000.00')).toBe(false);
    expect(wonInputValid('-5000')).toBe(false);
  });

  it('빈 값과 정수는 맞는 값이다', () => {
    expect(wonInputValid('')).toBe(true);
    expect(wonInputValid('5000')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { krw, krwAmountWords } from './format';

describe('krw', () => {
  it('접두 기호와 천 단위 구분을 붙인다', () => {
    expect(krw(12000)).toBe('₩12,000');
    expect(krw(0)).toBe('₩0');
    expect(krw(1234567)).toBe('₩1,234,567');
  });
});

describe('krwAmountWords', () => {
  it('서술이 뒤에 붙는 자리를 위해 원 접미로 쓴다', () => {
    expect(krwAmountWords(12000)).toBe('12,000원');
    expect(krwAmountWords(0)).toBe('0원');
  });

  it('krw와 같은 금액을 표기만 달리한다', () => {
    for (const value of [0, 990, 12000, 1234567]) {
      expect(krwAmountWords(value)).toBe(`${krw(value).slice(1)}원`);
    }
  });
});

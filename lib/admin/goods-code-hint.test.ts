import { describe, expect, it } from 'vitest';
import { looksLikeBarcode } from './goods-code-hint';

describe('looksLikeBarcode', () => {
  it('검증 숫자가 맞는 8·12·13·14자리 숫자를 바코드로 본다', () => {
    for (const value of ['8800353088562', '8800353088555', ' 8800353086155 ', '96385074', '036000291452', '18800353088569']) expect(looksLikeBarcode(value)).toBe(true);
  });
  it('자동 코드·ERP 코드·검증 숫자가 틀린 숫자는 바코드로 보지 않는다', () => {
    for (const value of ['HSQ-0060', 'HSQ0408010007', '000123', '8800353088563', '880035308856', '8800353088562-01', '', null, undefined]) expect(looksLikeBarcode(value)).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { shippingFeeLabel } from './shipping';

describe('stored shipping fee label', () => {
  it('formats the amount already charged without applying current policy', () => {
    expect(shippingFeeLabel(0)).toBe('무료');
    expect(shippingFeeLabel(4700)).toBe('₩4,700');
    expect(shippingFeeLabel(9800)).toBe('₩9,800');
  });
});

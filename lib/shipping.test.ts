import { describe, expect, it } from 'vitest';
import { FREE_SHIPPING_THRESHOLD, SHIPPING_FEE, shippingFeeFor } from './shipping';

describe('배송비 정책', () => {
  it('기본 배송비와 무료 임계를 상수로 고정한다', () => {
    expect(SHIPPING_FEE).toBe(3000);
    expect(FREE_SHIPPING_THRESHOLD).toBe(50000);
  });

  it('임계 미만은 기본 배송비, 임계 이상은 무료다', () => {
    expect(shippingFeeFor(FREE_SHIPPING_THRESHOLD - 1)).toBe(SHIPPING_FEE);
    expect(shippingFeeFor(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(shippingFeeFor(FREE_SHIPPING_THRESHOLD + 1)).toBe(0);
  });

  it('담긴 굿즈가 없으면 배송 자체가 없어 0이다', () => {
    expect(shippingFeeFor(0)).toBe(0);
    expect(shippingFeeFor(-1)).toBe(0);
  });
});

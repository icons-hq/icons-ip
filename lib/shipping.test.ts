import { describe, expect, it } from 'vitest';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FEE,
  freeShippingRemainder,
  shippingFeeFor,
  shippingFeeLabel,
} from './shipping';

describe('shipping policy', () => {
  it('pins the launch policy values', () => {
    expect(SHIPPING_FEE).toBe(3000);
    expect(FREE_SHIPPING_THRESHOLD).toBe(50000);
  });

  it('charges the flat fee below the free shipping threshold', () => {
    expect(shippingFeeFor(1)).toBe(SHIPPING_FEE);
    expect(shippingFeeFor(48000)).toBe(SHIPPING_FEE);
    expect(shippingFeeFor(FREE_SHIPPING_THRESHOLD - 1)).toBe(SHIPPING_FEE);
  });

  it('waives the fee at and above the threshold', () => {
    expect(shippingFeeFor(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(shippingFeeFor(120000)).toBe(0);
  });

  it('treats an empty cart as free so an empty summary never shows a fee', () => {
    expect(shippingFeeFor(0)).toBe(0);
    expect(shippingFeeFor(-1)).toBe(0);
  });

  it('reports how much is left until free shipping', () => {
    expect(freeShippingRemainder(0)).toBe(FREE_SHIPPING_THRESHOLD);
    expect(freeShippingRemainder(48000)).toBe(2000);
    expect(freeShippingRemainder(FREE_SHIPPING_THRESHOLD)).toBe(0);
    expect(freeShippingRemainder(80000)).toBe(0);
  });

  it('labels a waived fee as free and anything else as currency', () => {
    expect(shippingFeeLabel(0)).toBe('무료');
    expect(shippingFeeLabel(SHIPPING_FEE)).toBe('₩3,000');
  });
});

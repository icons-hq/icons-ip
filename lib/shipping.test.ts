import { describe, expect, it } from 'vitest';
import {
  getShippingPolicy,
  freeShippingRemainder,
  shippingFeeFor,
  shippingFeeLabel,
} from './shipping';

const SHIPPING_FEE = 3000;
const FREE_SHIPPING_THRESHOLD = 50000;

describe('shipping policy', () => {
  it('reads the current launch policy through the policy lookup', () => {
    expect(getShippingPolicy()).toEqual({ baseFee: 3000, freeThreshold: 50000 });
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

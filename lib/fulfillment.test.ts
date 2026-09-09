import { describe, expect, it } from 'vitest';
import { parseShippingQuote, parseShippingQuoteItems, shippingPolicyDescription } from './fulfillment';

describe('shipping quote contract', () => {
  it('accepts server groups and rejects inconsistent or missing totals', () => {
    const group={originId:'00000000-0000-4000-8000-000000042201',originCode:'gimpo',originName:'김포',policySubtotal:20000,baseFee:3000,freeThreshold:50000,policyFee:3000,individualFee:5000,totalFee:8000};
    expect(parseShippingQuote({totalFee:8000,groups:[group]})).toEqual({totalFee:8000,groups:[group]});
    expect(parseShippingQuote({totalFee:0,groups:[group]})).toBeNull();
    expect(parseShippingQuote({totalFee:0})).toBeNull();
  });
  it('describes policy/free/individual terms without hardcoded fee rules', () => {
    const policy={originId:'origin',originName:'김포',baseFee:4200,freeThreshold:65000,feeType:'policy' as const,individualFee:0};
    expect(shippingPolicyDescription(policy)).toContain('4,200');
    expect(shippingPolicyDescription({...policy,feeType:'free'})).toBe('무료배송');
    expect(shippingPolicyDescription({...policy,feeType:'individual',individualFee:2700})).toContain('굿즈당 1회');
  });
});

it('retains the cart quantity and 1000-line merge limits', () => {
  const items=Array.from({length:1000},()=>({goodId:'g1',variantId:'00000000-0000-4000-8000-000000000001',qty:2147483647}));
  expect(parseShippingQuoteItems(items)).toEqual(items);
  expect(parseShippingQuoteItems([...items,items[0]])).toBeNull();
  expect(parseShippingQuoteItems([{goodId:'g1',qty:2147483648}])).toBeNull();
});

it('requires a canonical option UUID before quoting a cart', () => {
  expect(parseShippingQuoteItems([{goodId:'g1',qty:1}])).toBeNull();
  expect(parseShippingQuoteItems([{goodId:'g1',variantId:'bad',qty:1}])).toBeNull();
});

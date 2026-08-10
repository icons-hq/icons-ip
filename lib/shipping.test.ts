import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FREE_SHIPPING_THRESHOLD,
  SHIPPING_FEE,
  freeShippingRemainder,
  shippingFeeFor,
  shippingFeeLabel,
} from './shipping';

/*
 * 실제 청구액은 place_order RPC 가 정한다. 앱 상수만 고치고 마이그레이션을 빠뜨리면
 * 공개 법정 고지(/legal/shipping)와 굿즈 상세는 새 값을, 결제는 옛 값을 쓴다.
 * 마지막으로 배송비를 정의한 마이그레이션에서 상수를 읽어 두 값을 묶어 둔다.
 */
function latestShippingPolicyFromMigrations() {
  const dir = join(process.cwd(), 'supabase/migrations');
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql')).sort();

  let fee: number | null = null;
  let threshold: number | null = null;

  for (const name of files) {
    const sql = readFileSync(join(dir, name), 'utf8');
    const feeMatch = sql.match(/c_shipping_fee\s+constant\s+bigint\s*:=\s*(\d+)/);
    const thresholdMatch = sql.match(/c_free_shipping_threshold\s+constant\s+bigint\s*:=\s*(\d+)/);
    if (feeMatch) fee = Number(feeMatch[1]);
    if (thresholdMatch) threshold = Number(thresholdMatch[1]);
  }

  return { fee, threshold };
}

describe('shipping policy', () => {
  it('pins the launch policy values', () => {
    expect(SHIPPING_FEE).toBe(3000);
    expect(FREE_SHIPPING_THRESHOLD).toBe(50000);
  });

  it('keeps the charged amount and the published amount on the same number', () => {
    const { fee, threshold } = latestShippingPolicyFromMigrations();

    /* 상수가 사라졌다면 place_order 가 배송비를 다르게 계산한다는 뜻이다. */
    expect(fee, 'place_order 의 c_shipping_fee 를 찾지 못했다').not.toBeNull();
    expect(threshold, 'place_order 의 c_free_shipping_threshold 를 찾지 못했다').not.toBeNull();

    expect(fee).toBe(SHIPPING_FEE);
    expect(threshold).toBe(FREE_SHIPPING_THRESHOLD);
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

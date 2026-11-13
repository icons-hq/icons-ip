import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COMMERCE_NUMBER_MAX_LENGTH, commerceNumberPattern, commerceReferenceLabel, isCommerceNumber } from './commerce-number';

/*
 * 10/14 회의 1014-116·117: 새 주문부터 주문번호·상품주문번호에 주문 시각(KST 시·분)을 넣는다(20자리).
 * 이미 발급한 16자리 번호와 배송건번호(늘 16자리)도 그대로 받는다. DB `private.is_commerce_number`와 같은
 * 벡터다(supabase/tests/order_number_time.sql).
 */
describe('isCommerceNumber', () => {
  it('주문·상품주문은 옛 16자리와 주문 시각 20자리를 받고 배송건은 16자리만 받는다', () => {
    expect(isCommerceNumber('2026102110000001', 'order')).toBe(true);
    expect(isCommerceNumber('20261112143510000042', 'order')).toBe(true);
    expect(isCommerceNumber('2026102120000001', 'item')).toBe(true);
    expect(isCommerceNumber('20261112143520000042', 'item')).toBe(true);
    expect(isCommerceNumber('2026102130000001', 'shipment')).toBe(true);
    expect(isCommerceNumber('20261112143530000001', 'shipment')).toBe(false);
    expect(isCommerceNumber('20261112000010000001', 'order')).toBe(true);
    expect(isCommerceNumber('20261112235910000001', 'order')).toBe(true);
  });

  it('종류 자리(끝에서 8번째)로 주문·상품주문·배송건을 가른다', () => {
    expect(isCommerceNumber('20261112143520000042', 'order')).toBe(false);
    expect(isCommerceNumber('20261112143510000042', 'item')).toBe(false);
    expect(isCommerceNumber('2026102120000001', 'order')).toBe(false);
    expect(isCommerceNumber('2026102110000001', 'shipment')).toBe(false);
    expect(['20261112143510000042', '20261112143520000042', '2026102130000001'].every(value => isCommerceNumber(value))).toBe(true);
  });

  it('시각 자리는 00:00~23:59만, 길이는 16·20자리만, 문자열만 받는다', () => {
    for (const value of ['20261112240010000001', '20261112236010000001', '2026111214351000004', '202611121435100000042',
      ' 20261112143510000042', '20261112143510000042 ', '202611121435', '2026-11-12-1435-10000042']) {
      expect(isCommerceNumber(value, 'order'), value).toBe(false);
      expect(isCommerceNumber(value), value).toBe(false);
    }
    expect(isCommerceNumber(Number('20261112143510000042'), 'order')).toBe(false);
    expect(isCommerceNumber(null)).toBe(false);
  });

  it('입력칸 최대 길이는 가장 긴 번호(20자리)다', () => {
    expect(COMMERCE_NUMBER_MAX_LENGTH).toBe(20);
    expect(commerceNumberPattern('order').test('2'.repeat(8) + '1435' + '1' + '0'.repeat(7))).toBe(true);
  });
});

describe('commerceReferenceLabel', () => {
  it('발급된 번호는 형식과 관계없이 그대로 쓰고, 번호가 없는 옛 기록만 UUID 뒤 8자리로 적는다', () => {
    const id = '9a3f21c0-1111-4000-8000-000000000abc';
    expect(commerceReferenceLabel(id, '20261112143510000042')).toBe('20261112143510000042');
    expect(commerceReferenceLabel(id, '2026102130000001')).toBe('2026102130000001');
    expect(commerceReferenceLabel('20261112143520000042')).toBe('20261112143520000042');
    expect(commerceReferenceLabel(id, null)).toBe('00000ABC');
    expect(commerceReferenceLabel(id, '20261112243510000042')).toBe('00000ABC');
  });
});

describe('번호 형식 판정은 한 곳에서만 한다', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const sources = (dir: string): string[] => readdirSync(join(root, dir)).flatMap(name => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });

  /* 주문번호·상품주문번호를 16자리 정규식으로 따로 검사하면 주문 시각 20자리 번호를 거절한다(회신·검색·입력 검증). */
  it('앱 코드는 주문·상품주문 16자리 정규식을 직접 쓰지 않고 isCommerceNumber·commerceNumberPattern을 쓴다', () => {
    const legacyOnly = /(?:\[0-9\]|\\d)\{8\}(?:[12]|\[12\]|\[123\])(?:\[0-9\]|\\d)\{7\}/;
    const offenders = ['app', 'components', 'lib']
      .flatMap(sources)
      .filter(path => path !== join('lib', 'commerce-number.ts') && legacyOnly.test(readFileSync(join(root, path), 'utf8')));
    expect(offenders).toEqual([]);
  });
});

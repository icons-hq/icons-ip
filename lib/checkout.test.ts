import { describe, expect, it } from 'vitest';
import {
  checkoutAddressErrors,
  checkoutOrderName,
  checkoutOrderState,
  mapPlaceOrderError,
  normalizeCheckoutAddress,
  normalizeCheckoutKey,
  normalizeOrderReference,
} from './checkout';

describe('normalizeCheckoutAddress', () => {
  it('trims fulfillment fields and stores phone digits only', () => {
    expect(normalizeCheckoutAddress({
      recipientName: '  아이콘즈 팬  ',
      phone: '010-1234-5678',
      postalCode: ' 04799 ',
      address1: ' 서울 성동구 아차산로  ',
      address2: ' 101동 202호 ',
      deliveryNote: ' 문 앞에 놓아주세요 ',
    })).toEqual({
      recipientName: '아이콘즈 팬',
      phone: '01012345678',
      postalCode: '04799',
      address1: '서울 성동구 아차산로',
      address2: '101동 202호',
      deliveryNote: '문 앞에 놓아주세요',
    });
  });

  it.each([
    null,
    {},
    { recipientName: '', phone: '01012345678', postalCode: '04799', address1: '서울' },
    { recipientName: '팬', phone: '123', postalCode: '04799', address1: '서울' },
    { recipientName: '팬', phone: '01012345678', postalCode: '4799', address1: '서울' },
    { recipientName: '팬', phone: '01012345678', postalCode: '04799', address1: '' },
    { recipientName: '팬', phone: '01012345678', postalCode: '04799', address1: '서울', admin: true },
  ])('rejects malformed or expanded address payloads: %j', (value) => {
    expect(normalizeCheckoutAddress(value)).toBeNull();
  });

  it('returns field-specific errors for the shipping form', () => {
    expect(checkoutAddressErrors({
      recipientName: ' ',
      phone: 'abc',
      postalCode: '4799',
      address1: '',
      address2: '가'.repeat(201),
      deliveryNote: '나'.repeat(201),
    })).toEqual({
      recipientName: '받는 분을 입력해주세요.',
      phone: '연락처는 숫자 8~15자리로 입력해주세요.',
      postalCode: '우편번호 5자리를 입력해주세요.',
      address1: '기본 주소를 입력해주세요.',
      address2: '상세 주소는 200자 이하로 입력해주세요.',
      deliveryNote: '배송 메모는 200자 이하로 입력해주세요.',
    });
  });

  it('accepts a form value that the server normalizer can store', () => {
    expect(checkoutAddressErrors({
      recipientName: '아이콘즈 팬',
      phone: '010-1234-5678',
      postalCode: '04799',
      address1: '서울 성동구',
      address2: '',
      deliveryNote: '',
    })).toEqual({});
  });
});

describe('checkout identifiers', () => {
  const uuid = '7ad4c967-3d48-44da-a665-64731ac33f62';

  it('accepts canonical UUID references and rejects arbitrary strings', () => {
    expect(normalizeCheckoutKey(uuid)).toBe(uuid);
    expect(normalizeOrderReference(uuid)).toBe(uuid);
    expect(normalizeCheckoutKey('not-a-uuid')).toBeNull();
    expect(normalizeOrderReference(` ${uuid} `)).toBe(uuid);
  });
});

describe('checkout copy and safe errors', () => {
  it('builds a bounded provider order name without leaking an address', () => {
    expect(checkoutOrderName(['리락쿠마 낮잠 쿠션'])).toBe('리락쿠마 낮잠 쿠션');
    expect(checkoutOrderName(['리락쿠마 낮잠 쿠션', '키링', '피규어'])).toBe('리락쿠마 낮잠 쿠션 외 2건');
    expect(checkoutOrderName(['가'.repeat(120)]).length).toBeLessThanOrEqual(100);
  });

  it('maps database failures to a small client-safe vocabulary', () => {
    expect(mapPlaceOrderError('cart empty')).toBe('empty_cart');
    expect(mapPlaceOrderError('out of stock: secret-good-id')).toBe('out_of_stock');
    expect(mapPlaceOrderError('invalid checkout address')).toBe('invalid_address');
    expect(mapPlaceOrderError('account_suspended')).toBe('account_suspended');
    expect(mapPlaceOrderError('sensitive database failure')).toBe('unavailable');
  });
});

describe('checkoutOrderState', () => {
  const now = Date.parse('2026-07-14T05:00:00.000Z');

  it('keeps provider-approved orders in checking until the webhook confirms the order', () => {
    expect(checkoutOrderState('pending', 'pending', '2026-07-14T05:10:00.000Z', now)).toBe('checking');
    expect(checkoutOrderState('pending', 'paid', '2026-07-14T05:10:00.000Z', now)).toBe('checking');
  });

  it('separates payable, complete, and closed orders', () => {
    expect(checkoutOrderState('pending', null, '2026-07-14T05:10:00.000Z', now)).toBe('payable');
    expect(checkoutOrderState('paid', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('confirmed', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('shipping', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('delivered', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('done', 'paid', null, now)).toBe('complete');
    expect(checkoutOrderState('pending', null, '2026-07-14T04:59:59.000Z', now)).toBe('closed');
    expect(checkoutOrderState('canceled', 'canceled', null, now)).toBe('closed');
  });
});

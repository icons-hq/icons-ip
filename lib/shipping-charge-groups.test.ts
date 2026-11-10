import { describe, expect, it, vi } from 'vitest';
import { chargeId, chargePublicFixtures } from '@/test/fixtures/shipping-charge-groups';
import { hasShippingChargeDetails, parseShippingChargeDetails, parseShippingChargeSnapshot, shippingChargeRegionalSnapshot } from './shipping-charge-groups';
import { parseCheckoutTransactionReceipt } from './checkout-transaction';
import { parseGiftCheckoutOrder } from './gifts-order.server';
import giftPayer from '@/test/fixtures/gift-order-payer.json';
vi.mock('./supabase/server', () => ({ createClient: vi.fn() }));

describe('공개 배송비 묶음그룹 snapshot', () => {
  it('한 물리 출고지의 기본료와 서로 다른 지역 부과 단위를 읽는다', () => {
    const { snapshot, chargeDetails, display } = chargePublicFixtures();
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, display.lines)).toEqual(chargeDetails);
    expect(parseShippingChargeSnapshot(snapshot)).toEqual(snapshot);
    expect(shippingChargeRegionalSnapshot(chargeDetails)).toEqual({ version: 1, regionalFee: 5000, sources: [
      { kind: 'origin', feeUnit: 'per_shipment', fee: 2000 },
      { kind: 'group', groupId: chargeId(2), revision: 1, feeUnit: 'per_charge_group', fee: 3000 },
    ] });
  });
  it.each(['quantity', 'subtotal'] as const)('%s는 snapshot 단독에서 유효 정수이며 전체 receipt에서는 실제 선택 합계에 결속된다', field => {
    const { snapshot, chargeDetails, display } = chargePublicFixtures();
    chargeDetails.groups[0][field]++;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).not.toBeNull();
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, display.lines)).toBeNull();
    expect(parseCheckoutTransactionReceipt({ orderId: chargeId(10), quoteId: chargeId(9), display })).toBeNull();
  });
  it('같은 상품의 여러 옵션·입력 행을 모두 합산하고 그룹 외 선택 행은 제외한다', () => {
    const { snapshot, chargeDetails } = chargePublicFixtures();
    const selection = [
      { goodId: 'good-b', qty: 1, subtotal: 7500 },
      { goodId: 'other-origin', qty: 9, subtotal: 90000 },
      { goodId: 'good-a', qty: 1, subtotal: 15000 },
      { goodId: 'good-c', qty: 1, subtotal: 5000 },
      { goodId: 'good-b', qty: 1, subtotal: 7500 },
    ];
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, selection)).toEqual(chargeDetails);
    selection[4].subtotal++;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, selection)).toBeNull();
    selection[4].subtotal--;
    selection[4].qty++;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, selection)).toBeNull();
  });
  it('중복 선택 행의 수량·금액이 같아도 다른 그룹 회원의 누락을 숨길 수 없다', () => {
    const { snapshot, chargeDetails } = chargePublicFixtures();
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components, [
      { goodId: 'good-b', qty: 1, subtotal: 15000 },
      { goodId: 'good-b', qty: 2, subtotal: 15000 },
    ])).toBeNull();
  });
  it.each(['baseFee', 'regionalFee'] as const)('그룹 %s는 실제 회원의 component 합계와 다를 수 없다', field => {
    const { snapshot, chargeDetails } = chargePublicFixtures(); chargeDetails.groups[0][field]++;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).toBeNull();
  });
  it.each(['unassignedBaseFee', 'originRegionalFee'] as const)('%s는 그룹 외 해당 component 합계와 다를 수 없다', field => {
    const { snapshot, chargeDetails } = chargePublicFixtures(); chargeDetails[field]++;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).toBeNull();
  });
  it('상속 그룹의 지역료는 0이고 실제 배분은 origin 합계에 남긴다', () => {
    const { snapshot, chargeDetails } = chargePublicFixtures();
    chargeDetails.groups[0].regionMode = 'inherit';
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).toBeNull();
    chargeDetails.groups[0].regionalFee = 0; chargeDetails.originRegionalFee = 5000;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).toEqual(chargeDetails);
    chargeDetails.originRegionFeeUnit = null;
    expect(parseShippingChargeDetails(chargeDetails, snapshot.components)).toBeNull();
  });
  it('중복 소속·미선택 원상품·누락 회원·빈 그룹·알 수 없는 버전을 거절한다', () => {
    const { snapshot, chargeDetails } = chargePublicFixtures();
    const mutations = [
      { ...chargeDetails, version: 2 }, { ...chargeDetails, groups: [] },
      { ...chargeDetails, groups: [...chargeDetails.groups, { ...chargeDetails.groups[0], groupId: chargeId(99) }] },
      { ...chargeDetails, groups: [{ ...chargeDetails.groups[0], goodIds: ['unselected-owner', 'good-b'] }] },
      { ...chargeDetails, groups: [{ ...chargeDetails.groups[0], goodIds: ['good-a', 'good-a'] }] },
      { ...chargeDetails, groups: [{ ...chargeDetails.groups[0], goodIds: ['good-a'] }] },
      { ...chargeDetails, groups: [{ ...chargeDetails.groups[0], quantity: 0 }] },
      { ...chargeDetails, groups: [{ ...chargeDetails.groups[0], subtotal: Number.MAX_SAFE_INTEGER + 1 }] },
    ];
    for (const value of mutations) expect(parseShippingChargeDetails(value, snapshot.components)).toBeNull();
  });
  it.each(['ownerGoodId', 'sourceEvidence', 'regionRules', 'chargeGroupContract'])('비공개 %s 키는 어느 공개 계층에도 들어갈 수 없다', key => {
    const { snapshot, chargeDetails } = chargePublicFixtures();
    expect(parseShippingChargeSnapshot({ ...snapshot, [key]: 'PRIVATE' })).toBeNull();
    expect(parseShippingChargeDetails({ ...chargeDetails, [key]: 'PRIVATE' }, snapshot.components)).toBeNull();
    expect(parseShippingChargeDetails({ ...chargeDetails, groups: [{ ...chargeDetails.groups[0], [key]: 'PRIVATE' }] }, snapshot.components)).toBeNull();
  });
  it('0원 override도 계약 source를 보존하며 null/잘못된 marker를 구형으로 보지 않는다', () => {
    const { chargeDetails } = chargePublicFixtures(); chargeDetails.groups[0].regionalFee = 0;
    expect(shippingChargeRegionalSnapshot(chargeDetails).sources[1]).toMatchObject({ kind: 'group', feeUnit: 'per_charge_group', fee: 0 });
    for (const marker of [null, undefined, {}, { version: 99 }]) {
      expect(hasShippingChargeDetails({ chargeDetails: marker })).toBe(true);
      expect(parseShippingChargeSnapshot({ chargeDetails: marker })).toBeNull();
    }
    expect(hasShippingChargeDetails({})).toBe(false);
  });
  it('순환/접근자 객체를 실행하지 않고 거절한다', () => {
    const { snapshot, chargeDetails } = chargePublicFixtures(), getter = vi.fn(() => 'PRIVATE');
    const input = { ...chargeDetails }; Object.defineProperty(input, 'groups', { get: getter, enumerable: true });
    expect(parseShippingChargeDetails(input, snapshot.components)).toBeNull(); expect(getter).not.toHaveBeenCalled();
  });
});

describe('과거 및 새 선물 receipt의 엄격한 호환', () => {
  it('기존 실제 fixture의 형태를 유지하며 receipt에만 안전한 새 details를 읽는다', () => {
    expect(parseGiftCheckoutOrder(giftPayer, giftPayer.order.id)?.kind).toBe('gift');
    const value = structuredClone(giftPayer), shipping = value.receipt.display.shipping[0];
    const goodIds = shipping.components.map(row => row.goodId), selected = value.receipt.display.lines.filter(row => goodIds.includes(row.goodId));
    const chargeDetails = { version: 1, unassignedBaseFee: 0, originRegionalFee: 0, originRegionFeeUnit: null,
      groups: [{ groupId: chargeId(2), revision: 1, mode: 'min', quantity: selected.reduce((sum, row) => sum + row.qty, 0),
        subtotal: selected.reduce((sum, row) => sum + row.subtotal, 0), baseFee: shipping.components.reduce((sum, row) => sum + row.baseFee, 0),
        regionalFee: shipping.components.reduce((sum, row) => sum + row.regionalFee, 0), regionMode: 'override', goodIds }] };
    Object.assign(shipping, { chargeDetails });
    const result = parseGiftCheckoutOrder(value, value.order.id);
    expect(result?.kind).toBe('gift');
    if (result?.kind !== 'gift') throw new Error('fixture');
    expect(result.order.transaction.shipping[0].chargeDetails).toEqual(chargeDetails);
    expect(result.order.address).toBeNull(); expect(result.order.shipments[0].regionalShipping).toBeNull();
    Object.assign(value.order.shipments[0], { chargeDetails });
    expect(parseGiftCheckoutOrder(value, value.order.id)).toBeNull();
  });
});

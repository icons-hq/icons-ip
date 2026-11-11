import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ShippingChargeDetails } from '@/lib/shipping-charge-groups';
import { ShippingChargeDetailsDisplay } from './ShippingChargeDetailsDisplay';

const details: ShippingChargeDetails = {
  version: 1, unassignedBaseFee: 1200, originRegionalFee: 3000, originRegionFeeUnit: 'per_shipment',
  groups: [{ groupId: '00000000-0000-4000-8000-000000000001', revision: 3, mode: 'max', quantity: 4, subtotal: 60000,
    baseFee: 0, regionalFee: 0, regionMode: 'inherit', goodIds: ['keyring', 'doll'] },
  { groupId: '00000000-0000-4000-8000-000000000002', revision: 2, mode: 'min', quantity: 1, subtotal: 10000,
    baseFee: 2500, regionalFee: 4000, regionMode: 'override', goodIds: ['figure'] }],
};

it('기본료 무료와 지역료 상속을 구별하고 추가 합산으로 안내하지 않는다', () => {
  const html = renderToStaticMarkup(<ShippingChargeDetailsDisplay details={details} names={{ keyring: '키링', doll: '인형' }} />);
  expect(html).toContain('선불·착불 배송비 합계에 이미 포함');
  expect(html).toContain('기간 할인 후, 복수구매 할인·쿠폰·적립금 적용 전');
  expect(html).toContain('키링 · 인형');
  expect(html).toContain('묶음 기본 배송비</dt><dd>무료');
  /* 고객 화면은 '출고지'를 말하지 않는다(R26). */
  expect(html).not.toContain('출고지');
  expect(html).toContain('배송 묶음 지역 정책에 포함');
  expect(html).toContain('배송 묶음 지역 추가 배송비: ₩3,000 · 배송 건당 부과');
  expect(html).toContain('₩4,000 · 묶음당 1회');
  expect(html).toContain('묶음 외 기본 배송비: ₩1,200');
  expect(html).not.toContain('버전 3');
  expect(html).not.toContain(details.groups[0].groupId);
});

it('명시된 0원 그룹 지역료는 보존하고 관리자에게 저장 당시 버전을 표시한다', () => {
  const zero: ShippingChargeDetails = { version: 1, unassignedBaseFee: 0, originRegionalFee: 0, originRegionFeeUnit: null,
    groups: [{ ...details.groups[1], baseFee: 0, regionalFee: 0 }] };
  const html = renderToStaticMarkup(<ShippingChargeDetailsDisplay details={zero} admin />);
  expect(html).toContain('₩0 · 묶음당 1회');
  expect(html).toContain('버전 2');
  expect(html).toContain('상품 1');
  expect(html).not.toContain('출고지 지역 추가 배송비:');
  expect(html).not.toContain('묶음 외 기본 배송비:');
});

it('관리자 화면은 출고지 어휘를 그대로 쓴다', () => {
  const html = renderToStaticMarkup(<ShippingChargeDetailsDisplay details={details} admin />);
  expect(html).toContain('출고지 지역 정책에 포함');
  expect(html).toContain('출고지 지역 추가 배송비: ₩3,000 · 출고지 배송 건당 부과');
});

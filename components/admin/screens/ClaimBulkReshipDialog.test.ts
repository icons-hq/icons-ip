import { describe, expect, it } from 'vitest';
import { reshipRowKey, sameClaimContactAddress } from './ClaimBulkReshipDialog';

/*
 * 재출고 일괄(SHEET-052): 같은 요청의 다음 출고지는 앞 재출고로 요청 버전이 바뀌어 최종 주소를 다시 받는다. 처음 확인한
 * 주소와 같을 때만 이어서 보낸다 — 받는 분·연락처·우편번호·주소 어느 하나라도 다르면 보내지 않는다.
 */
const ADDRESS = { recipientName: '합성 고객', phone: '01000000000', postalCode: '12345', address1: '합성시 입고일로 1', address2: '101호' };

describe('재출고 일괄 — 최종 주소 재확인', () => {
  it('앞뒤 공백만 다른 우편번호·기본 주소는 같은 주소다', () => {
    expect(sameClaimContactAddress(ADDRESS, { ...ADDRESS, postalCode: ' 12345 ', address1: '합성시 입고일로 1 ' })).toBe(true);
  });

  it.each([
    ['recipientName', '다른 고객'], ['phone', '01099999999'], ['postalCode', '54321'], ['address1', '합성시 다른로 2'], ['address2', '202호'],
  ] as const)('%s가 바뀌면 보내지 않는다', (field, value) => {
    expect(sameClaimContactAddress(ADDRESS, { ...ADDRESS, [field]: value })).toBe(false);
  });

  it('행 키는 요청과 배송 건(없으면 주문 전체)으로 만든다', () => {
    expect(reshipRowKey('claim', 'shipment')).toBe('claim:shipment');
    expect(reshipRowKey('claim', null)).toBe('claim:order');
  });
});

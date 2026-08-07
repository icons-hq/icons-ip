import { describe, expect, it } from 'vitest';
import { checkoutAddressErrors } from './checkout';
import { POSTCODE_SCRIPT_SRC, composePostcodeAddress } from './postcode';

const base = {
  zonecode: '04799',
  roadAddress: '서울 성동구 왕십리로 83-21',
  jibunAddress: '서울 성동구 성수동1가 656-1',
  userSelectedType: 'R' as const,
  bname: '성수동1가',
  buildingName: '아크로서울포레스트',
};

describe('composePostcodeAddress', () => {
  it('도로명 선택이면 법정동과 건물명을 괄호로 덧붙인다', () => {
    expect(composePostcodeAddress(base)).toEqual({
      postalCode: '04799',
      address1: '서울 성동구 왕십리로 83-21 (성수동1가, 아크로서울포레스트)',
    });
  });

  it('지번 선택이면 지번 주소를 그대로 쓰고 괄호를 붙이지 않는다', () => {
    expect(composePostcodeAddress({ ...base, userSelectedType: 'J' })).toEqual({
      postalCode: '04799',
      address1: '서울 성동구 성수동1가 656-1',
    });
  });

  it('건물명만 있으면 건물명만 괄호에 넣는다', () => {
    expect(composePostcodeAddress({ ...base, bname: '' })?.address1)
      .toBe('서울 성동구 왕십리로 83-21 (아크로서울포레스트)');
  });

  it('동·로·가로 끝나지 않는 법정동은 괄호에 넣지 않는다', () => {
    expect(composePostcodeAddress({ ...base, bname: '성수1', buildingName: '' })?.address1)
      .toBe('서울 성동구 왕십리로 83-21');
  });

  it('결과는 기존 배송지 검증을 그대로 통과한다', () => {
    const composed = composePostcodeAddress(base);
    const errors = checkoutAddressErrors({
      recipientName: '팬',
      phone: '01012345678',
      postalCode: composed?.postalCode ?? '',
      address1: composed?.address1 ?? '',
    });

    expect(errors).toEqual({});
  });

  it('우편번호가 5자리가 아니면 수기 입력으로 되돌린다', () => {
    expect(composePostcodeAddress({ ...base, zonecode: '4799' })).toBeNull();
    expect(composePostcodeAddress({ ...base, zonecode: '' })).toBeNull();
  });

  it('검증 한도를 넘는 주소는 채우지 않는다', () => {
    expect(composePostcodeAddress({
      ...base,
      roadAddress: '가'.repeat(201),
      bname: '',
      buildingName: '',
    })).toBeNull();
  });

  it('선택 결과 자체가 비어 있으면 채우지 않는다', () => {
    expect(composePostcodeAddress({ ...base, roadAddress: '', jibunAddress: '' })).toBeNull();
    expect(composePostcodeAddress(null)).toBeNull();
  });

  it('도로명 주소가 비면 지번 주소로 대체한다', () => {
    expect(composePostcodeAddress({ ...base, roadAddress: '', bname: '', buildingName: '' }))
      .toEqual({ postalCode: '04799', address1: '서울 성동구 성수동1가 656-1' });
  });

  it('검색 스크립트는 개인정보를 실을 수 없는 정적 주소다', () => {
    expect(POSTCODE_SCRIPT_SRC).toBe(
      'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js',
    );
    expect(POSTCODE_SCRIPT_SRC).not.toContain('?');
  });
});

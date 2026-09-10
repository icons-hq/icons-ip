import { describe, expect, it } from 'vitest';
import { readGoodsClaimPolicy } from './goods-claim-policy';
import { EMPTY_GOOD_CLAIM_POLICY, parseGoodClaimPolicy } from '@/lib/goods-claim-policy';
describe('상품 교환 반품 안내비', () => {
  it('이전 폼의 생략과 미확인 공란, 확인된 무료 0원을 구별한다', () => {
    const form = new FormData();
    expect(readGoodsClaimPolicy(form)).toEqual({ errors: {} });
    form.set('claimReturnFee', '');
    expect(readGoodsClaimPolicy(form).value).toEqual(EMPTY_GOOD_CLAIM_POLICY);
    form.set('claimReturnFee', '0'); form.set('claimReturnFreeShippingFee', '6000');
    expect(readGoodsClaimPolicy(form)).toMatchObject({ errors: {}, value: { returnFee: 0, returnFreeShippingFee: 6000, exchangeFee: null } });
    expect(parseGoodClaimPolicy(readGoodsClaimPolicy(form).value)?.returnFee).toBe(0);
  });
  it('제한 사유를 요구하며 음수·소수·범위를 넘는 비용은 저장하지 않는다', () => {
    const form = new FormData(); form.set('claimReturnAllowed', 'false'); form.set('claimRestrictionReason', '\n\t');
    expect(readGoodsClaimPolicy(form).errors.claimRestrictionReason).toBeTruthy();
    form.set('claimRestrictionReason', '개봉 상태에 따른 별도 확인\nCS 접수');
    for (const value of ['-1', '0.5', '1000001', '1e3']) {
      form.set('claimExchangeFee', value);
      expect(readGoodsClaimPolicy(form).errors.claimExchangeFee).toBeTruthy();
    }
    expect(parseGoodClaimPolicy({ ...EMPTY_GOOD_CLAIM_POLICY, exchangeFee: -1 })).toBeNull();
  });
});

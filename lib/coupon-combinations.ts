import { transactionExactKeys, transactionInstant, transactionInteger, transactionRecord } from './goods-transaction-values';
export interface CouponCombinationPolicy { revision: number; stackingEnabled: boolean; maxGoodsCoupons: number; shippingEnabled: boolean }
export interface AdminCouponCombinationPolicy extends CouponCombinationPolicy { evidence: string; updatedAt: string }
export function parseCouponCombinationPolicy(v: unknown): CouponCombinationPolicy | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['revision', 'stackingEnabled', 'maxGoodsCoupons', 'shippingEnabled']) || !transactionInteger(v.revision, 1)
  || typeof v.stackingEnabled !== 'boolean' || typeof v.shippingEnabled !== 'boolean' || !transactionInteger(v.maxGoodsCoupons, 1, 5)) return null;
 return v as unknown as CouponCombinationPolicy;
}
export function parseAdminCouponCombinationPolicy(v: unknown): AdminCouponCombinationPolicy | null {
 if (!transactionRecord(v) || !transactionExactKeys(v, ['revision', 'stackingEnabled', 'maxGoodsCoupons', 'shippingEnabled', 'evidence', 'updatedAt'])
  || typeof v.evidence !== 'string' || v.evidence.length > 1000 || /[\u0000-\u001f\u007f]/u.test(v.evidence) || !transactionInstant(v.updatedAt)) return null;
 const { evidence, updatedAt, ...policy } = v; const parsed = parseCouponCombinationPolicy(policy);
 return parsed ? { ...parsed, evidence, updatedAt } : null;
}
export function couponCombinationError(code?: string, message?: string) {
 if (message === 'coupon_issued_benefit_immutable') return '발급된 쿠폰의 할인 대상과 중복 조건은 바꿀 수 없습니다.';
 return code === 'PT409' ? '다른 작업으로 정책이 바뀌었습니다. 현재 설정을 다시 확인해주세요.' : code === '42501' ? '현재 계정의 권한과 로그인 상태를 확인해주세요.' : code === '22023' ? '쿠폰 수와 설정 근거를 확인해주세요.' : '저장 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해주세요.';
}

import { EMPTY_GOOD_CLAIM_POLICY, type GoodClaimPolicy } from '@/lib/goods-claim-policy';

export const GOODS_CLAIM_POLICY_FIELDS = ['claimReturnAllowed', 'claimExchangeAllowed', 'claimRestrictionReason', 'claimReturnFee', 'claimReturnFreeShippingFee', 'claimExchangeFee'] as const;
export function readGoodsClaimPolicy(form: FormData): { value?: GoodClaimPolicy; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!GOODS_CLAIM_POLICY_FIELDS.some((key) => form.has(key))) return { errors };
  const value = { ...EMPTY_GOOD_CLAIM_POLICY };
  for (const [formKey, key] of [['claimReturnAllowed', 'returnAllowed'], ['claimExchangeAllowed', 'exchangeAllowed']] as const) {
    const input = String(form.get(formKey) ?? '').trim();
    if (!['', 'true', 'false'].includes(input)) errors[formKey] = '조건을 다시 선택해주세요.';
    value[key] = input === '' ? null : input === 'true';
  }
  const reason = String(form.get('claimRestrictionReason') ?? '').trim();
  if (reason.length > 2000 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(reason)) errors.claimRestrictionReason = '제한 사유는 2,000자 이내로 입력해주세요.';
  if ((value.returnAllowed === false || value.exchangeAllowed === false) && !reason) errors.claimRestrictionReason = '제한 사유와 적용 조건을 입력해주세요.';
  value.restrictionReason = reason || null;
  for (const [formKey, key] of [['claimReturnFee', 'returnFee'], ['claimReturnFreeShippingFee', 'returnFreeShippingFee'], ['claimExchangeFee', 'exchangeFee']] as const) {
    const input = String(form.get(formKey) ?? '').trim();
    if (input && (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input)) || Number(input) > 1_000_000)) errors[formKey] = '비용은 0~1,000,000원 정수로 입력하거나 미확인이면 비워주세요.';
    value[key] = input ? Number(input) : null;
  }
  return { value, errors };
}

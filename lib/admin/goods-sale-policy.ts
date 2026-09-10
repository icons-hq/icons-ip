/** Optional keys preserve metadata written by older editors/imports. */
export interface AdminGoodsSalePolicyInput {
  allowCardPayment?: boolean;
  allowBankTransfer?: boolean;
  saleRestriction?: 'none' | 'adult';
  orderQuantityLimitEnabled?: boolean;
  minOrderQty?: number | null;
  maxOrderQty?: number | null;
  memberPurchaseLimitEnabled?: boolean;
  memberLifetimeQtyLimit?: number | null;
}

export const GOODS_SALE_POLICY_FIELDS = [
  'allowCardPayment', 'allowBankTransfer', 'saleRestriction', 'orderQuantityLimitEnabled',
  'minOrderQty', 'maxOrderQty', 'memberPurchaseLimitEnabled', 'memberLifetimeQtyLimit',
] as const;

export function readAdminGoodsSalePolicy(form: FormData) {
  const value: AdminGoodsSalePolicyInput = {};
  const errors: Record<string, string> = {};
  for (const key of ['allowCardPayment', 'allowBankTransfer', 'orderQuantityLimitEnabled', 'memberPurchaseLimitEnabled'] as const) {
    if (!form.has(key)) continue;
    const text = String(form.get(key));
    if (!['true', 'false'].includes(text)) errors[key] = '적용 여부를 선택해주세요.';
    else value[key] = text === 'true';
  }
  for (const key of ['minOrderQty', 'maxOrderQty', 'memberLifetimeQtyLimit'] as const) {
    if (!form.has(key)) continue;
    const text = String(form.get(key) ?? '').trim();
    if (!text) value[key] = null;
    else if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) > 2147483647) {
      errors[key] = '1 이상의 정수로 입력해주세요.';
    } else value[key] = Number(text);
  }
  if (form.has('saleRestriction')) {
    const restriction = String(form.get('saleRestriction'));
    if (restriction !== 'none' && restriction !== 'adult') errors.saleRestriction = '판매 제한 유형을 선택해주세요.';
    else value.saleRestriction = restriction;
  }
  if (value.orderQuantityLimitEnabled) {
    if (value.minOrderQty == null) errors.minOrderQty = '한도를 적용하려면 최소 구매 수량을 입력해주세요.';
    if (value.maxOrderQty == null) errors.maxOrderQty = '한도를 적용하려면 최대 구매 수량을 입력해주세요.';
  }
  if (value.minOrderQty != null && value.maxOrderQty != null && value.minOrderQty > value.maxOrderQty) {
    errors.maxOrderQty = '최대 구매 수량은 최소 구매 수량 이상이어야 합니다.';
  }
  if (value.memberPurchaseLimitEnabled && value.memberLifetimeQtyLimit == null) {
    errors.memberLifetimeQtyLimit = '한도를 적용하려면 회원 누적 구매 수량을 입력해주세요.';
  }
  return { value, errors };
}

export function goodsSalePolicyRpcFields(value: AdminGoodsSalePolicyInput): Record<string, unknown> {
  return Object.fromEntries(([
    ['allowCardPayment', 'allow_card_payment'], ['allowBankTransfer', 'allow_bank_transfer'],
    ['saleRestriction', 'sale_restriction'], ['orderQuantityLimitEnabled', 'order_quantity_limit_enabled'],
    ['minOrderQty', 'min_order_qty'], ['maxOrderQty', 'max_order_qty'],
    ['memberPurchaseLimitEnabled', 'member_purchase_limit_enabled'], ['memberLifetimeQtyLimit', 'member_lifetime_qty_limit'],
  ] as const).filter(([key]) => value[key] !== undefined).map(([key, column]) => [column, value[key]]));
}

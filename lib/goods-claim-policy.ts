export interface GoodClaimPolicy {
  returnAllowed: boolean | null;
  exchangeAllowed: boolean | null;
  restrictionReason: string | null;
  /** Customer-fault return, one-way collection fee. */
  returnFee: number | null;
  /** Customer-fault return after free outbound shipping, total round-trip fee. */
  returnFreeShippingFee: number | null;
  /** Customer-fault exchange, total round-trip fee. */
  exchangeFee: number | null;
}
export const EMPTY_GOOD_CLAIM_POLICY: GoodClaimPolicy = {
  returnAllowed: null, exchangeAllowed: null, restrictionReason: null,
  returnFee: null, returnFreeShippingFee: null, exchangeFee: null,
};

export function parseGoodClaimPolicy(value: unknown): GoodClaimPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (['returnAllowed', 'exchangeAllowed'].some((key) => row[key] !== null && typeof row[key] !== 'boolean')
    || (row.restrictionReason !== null && typeof row.restrictionReason !== 'string')
    || ['returnFee', 'exchangeFee'].some((key) => row[key] !== null && (typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || Number(row[key]) < 0 || Number(row[key]) > 1_000_000))) return null;
  const freeReturn = row.returnFreeShippingFee ?? null;
  if (freeReturn !== null && (typeof freeReturn !== 'number' || !Number.isSafeInteger(freeReturn) || freeReturn < 0 || freeReturn > 1_000_000)) return null;
  return { returnAllowed: row.returnAllowed as boolean | null, exchangeAllowed: row.exchangeAllowed as boolean | null,
    restrictionReason: row.restrictionReason as string | null, returnFee: row.returnFee as number | null,
    returnFreeShippingFee: freeReturn as number | null, exchangeFee: row.exchangeFee as number | null };
}

/**
 * 상품 상세 '교환 · 반품 안내'의 가능/제한 표시(S36-044). 상품의 반품·교환 조건에서 파생한다 — 조건이 하나라도
 * '제한'이면 '교환·반품 제한(사유)', 아니면(미검토 포함, 기본 정책) '교환·반품 가능'이다. 이 표시는 고지일 뿐이라
 * 고객의 신청을 막지 않고, 하자·오배송은 제한할 수 없다는 문장을 함께 둔다(전자상거래법 제17조 제3항).
 */
export type GoodClaimAvailability =
  | { restricted: false; label: '교환·반품 가능' }
  | { restricted: true; label: string; scope: 'both' | 'return' | 'exchange' };
export function goodClaimAvailability(policy: GoodClaimPolicy | null | undefined): GoodClaimAvailability | null {
  if (!policy) return null;
  const returnLimited = policy.returnAllowed === false, exchangeLimited = policy.exchangeAllowed === false;
  if (!returnLimited && !exchangeLimited) return { restricted: false, label: '교환·반품 가능' };
  const reason = policy.restrictionReason?.trim() || '개별 확인';
  return { restricted: true, label: `교환·반품 제한(${reason})`, scope: returnLimited && exchangeLimited ? 'both' : returnLimited ? 'return' : 'exchange' };
}

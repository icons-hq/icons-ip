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

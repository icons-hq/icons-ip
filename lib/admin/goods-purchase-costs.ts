export const PURCHASE_TAX_BASIS_LABELS = {
  included: '세금 포함', excluded: '세금 별도', exempt: '면세',
} as const;
export type PurchaseTaxBasis = keyof typeof PURCHASE_TAX_BASIS_LABELS;
export interface PurchaseCostInput { unitCostKrw: number | null; taxBasis: PurchaseTaxBasis | null }
export interface AdminGoodsPurchaseCost extends PurchaseCostInput {
  variantId: string;
  goodId: string;
  revision: number | null;
  updatedAt: string | null;
}
export interface PurchaseCostChange {
  id: string;
  variantId: string;
  revision: number;
  before: PurchaseCostInput | null;
  after: PurchaseCostInput;
  actorName: string | null;
  changedAt: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function integer(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= 2147483647;
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function parsePurchaseCostInput(value: unknown): PurchaseCostInput | null {
  if (!object(value) || Object.keys(value).some((key) => !['unitCostKrw', 'taxBasis'].includes(key))) return null;
  const rawAmount = typeof value.unitCostKrw === 'string' ? value.unitCostKrw.trim() : value.unitCostKrw;
  const rawBasis = typeof value.taxBasis === 'string' ? value.taxBasis.trim() : value.taxBasis;
  const emptyAmount = rawAmount === '' || rawAmount === null || rawAmount === undefined;
  const emptyBasis = rawBasis === '' || rawBasis === null || rawBasis === undefined;
  if (emptyAmount || emptyBasis) return emptyAmount && emptyBasis ? { unitCostKrw: null, taxBasis: null } : null;
  if (typeof rawAmount !== 'number' && (typeof rawAmount !== 'string' || !/^\d+$/.test(rawAmount))) return null;
  const unitCostKrw = Number(rawAmount);
  if (!integer(unitCostKrw) || typeof rawBasis !== 'string' || !Object.hasOwn(PURCHASE_TAX_BASIS_LABELS, rawBasis)) return null;
  return { unitCostKrw, taxBasis: rawBasis as PurchaseTaxBasis };
}

export function parseAdminPurchaseCosts(value: unknown): AdminGoodsPurchaseCost[] | null {
  if (!Array.isArray(value)) return null;
  const costs: AdminGoodsPurchaseCost[] = [];
  for (const row of value) {
    if (!object(row) || typeof row.variant_id !== 'string' || !UUID.test(row.variant_id)
      || typeof row.good_id !== 'string' || !row.good_id
      || (row.revision !== null && !integer(row.revision, 1)) || (row.updated_at !== null && !instant(row.updated_at))) return null;
    const cost = parsePurchaseCostInput({ unitCostKrw: row.unit_cost_krw, taxBasis: row.tax_basis });
    if (!cost || (row.revision === null && (cost.unitCostKrw !== null || row.updated_at !== null))
      || (row.revision !== null && row.updated_at === null)) return null;
    costs.push({ variantId: row.variant_id, goodId: row.good_id, ...cost, revision: row.revision as number | null,
      updatedAt: row.updated_at as string | null });
  }
  return costs;
}

export function parsePurchaseCostHistory(value: unknown): PurchaseCostChange[] | null {
  if (!Array.isArray(value)) return null;
  const result: PurchaseCostChange[] = [];
  for (const row of value) {
    if (!object(row) || typeof row.id !== 'string' || !UUID.test(row.id) || typeof row.variantId !== 'string' || !UUID.test(row.variantId)
      || !integer(row.revision, 1) || !instant(row.changedAt) || (row.actorName !== null && typeof row.actorName !== 'string')) return null;
    const before = row.before === null ? null : parsePurchaseCostInput(row.before);
    const after = parsePurchaseCostInput(row.after);
    if ((row.before !== null && before === null) || !after) return null;
    result.push({ id: row.id, variantId: row.variantId, revision: row.revision, before, after,
      actorName: row.actorName as string | null, changedAt: row.changedAt });
  }
  return result;
}

export function purchaseCostLabel(cost: PurchaseCostInput | null): string {
  return cost?.unitCostKrw == null || cost.taxBasis === null ? '미설정'
    : `${cost.unitCostKrw.toLocaleString('ko-KR')}원 · ${PURCHASE_TAX_BASIS_LABELS[cost.taxBasis]}`;
}

export const SETTLEMENT_DATE_TYPES = ['soldDate', 'paidOutDate'] as const;
export type SettlementDateType = typeof SETTLEMENT_DATE_TYPES[number];
export type SettlementMode = 'test' | 'live';
export type SettlementCollectionQuery = SettlementQuery & { mode: SettlementMode; account?: string | null };
export type SettlementQuery = { dateType: SettlementDateType; startDate: string; endDate: string };

/** Private ledger input. Never return provider identifiers or these rows to browser clients. */
export interface SettlementRecord {
  mId: string;
  paymentKey: string;
  transactionKey: string;
  orderId: string;
  currency: string;
  method: string;
  amount: string;
  interestFee: string;
  fees: { type: string; fee: string }[];
  supplyAmount: string;
  vat: string;
  payOutAmount: string;
  approvedAt: string;
  soldDate: string;
  paidOutDate: string;
  cancel: null | { cancelAmount: string; canceledAt: string; transactionKey: string };
}

export function isSettlementDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value
    && value >= '2000-01-01' && value <= '2099-12-31';
}

/** Our bounded import range; provider API may accept broader ranges. */
export function parseSettlementQuery(value: unknown): SettlementQuery | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!SETTLEMENT_DATE_TYPES.includes(row.dateType as SettlementDateType)
    || !isSettlementDate(row.startDate) || !isSettlementDate(row.endDate)
    || row.startDate > row.endDate
    || Date.parse(row.endDate) - Date.parse(row.startDate) > 30 * 86_400_000) return null;
  return { dateType: row.dateType as SettlementDateType, startDate: row.startDate, endDate: row.endDate };
}

/** Integer KRW boundaries shared by the strict transaction DTO and its test oracle.
 * Persisted calculations remain authoritative in PostgreSQL. */
export const GOODS_TRANSACTION_INT_MAX = 2_147_483_647;
export const GOODS_TRANSACTION_AMOUNT_MAX = Number.MAX_SAFE_INTEGER;
export const GOODS_TRANSACTION_MIN_PAYABLE = 1_000;
// Matches the current Toss and Korpay gateway attempt validators.
export const GOODS_TRANSACTION_ONLINE_MAX = 999_999_999_999;
export const GOODS_TRANSACTION_SELECTION_MAX_BYTES = 2 * 1024 * 1024;
// The shortest valid compact selection row is 108 UTF-8 bytes; each additional
// row needs one comma. This is a derived payload bound, not a 1,000-row paging
// limit. Existing carts with 1,001 distinct custom-input lines remain supported.
export const GOODS_TRANSACTION_MAX_LINES = Math.floor((GOODS_TRANSACTION_SELECTION_MAX_BYTES - 1) / 109);

export function transactionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function transactionGoodId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= 200 && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}

export function transactionInteger(value: unknown, min = 0, max = GOODS_TRANSACTION_AMOUNT_MAX): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max;
}

export function transactionInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
    && hour <= 23 && minute <= 59 && second <= 59 && (parts[8] === 'Z' || (Number(parts[9]) <= 15 && Number(parts[10]) <= 59))
    && Number.isFinite(Date.parse(value));
}

export function transactionEpochMicros(value: string): bigint {
  if (!transactionInstant(value)) throw new RangeError('invalid_transaction_instant');
  const fraction = /\.(\d{1,6})(?:Z|[+-])/.exec(value)?.[1] ?? '';
  return BigInt(Date.parse(value)) * BigInt(1000) + BigInt(fraction.padEnd(6, '0').slice(3));
}

export function transactionExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/** Non-payable editor state is bounded and kept separate from typed terms. */
export function parseTransactionDraftValues(value: unknown, allowedKeys: readonly string[]): Record<string, string> | null {
  if (!transactionRecord(value) || Object.keys(value).some(key => !allowedKeys.includes(key))
    || Object.values(value).some(item => typeof item !== 'string' || item.length > 128 || /[\u0000-\u001f\u007f]/.test(item))) return null;
  return Object.fromEntries(Object.entries(value)) as Record<string, string>;
}

export function transactionSafeAmount(value: bigint): number {
  if (value < BigInt(0) || value > BigInt(GOODS_TRANSACTION_AMOUNT_MAX)) throw new RangeError('transaction_amount_overflow');
  return Number(value);
}

export function transactionSum(values: readonly number[]): number {
  return transactionSafeAmount(values.reduce((sum, value) => {
    if (!transactionInteger(value)) throw new RangeError('invalid_transaction_amount');
    return sum + BigInt(value);
  }, BigInt(0)));
}

export interface TransactionWeight { id: string; weight: number }

/** Exact largest remainder, with ASCII identity ordering for ties. Zero weights
 * are deliberate: callers must choose subtotal/quantity fallbacks explicitly. */
export function allocateTransactionAmount(total: number, rows: readonly TransactionWeight[]): Record<string, number> {
  if (!transactionInteger(total) || !rows.length || new Set(rows.map(row => row.id)).size !== rows.length
    || rows.some(row => !row.id || !transactionInteger(row.weight))) throw new RangeError('invalid_transaction_allocation');
  const denominator = rows.reduce((sum, row) => sum + BigInt(row.weight), BigInt(0));
  if (denominator === BigInt(0)) {
    if (total !== 0) throw new RangeError('transaction_allocation_zero_weight');
    return Object.fromEntries(rows.map(row => [row.id, 0]));
  }
  const allocated = rows.map(row => {
    const numerator = BigInt(total) * BigInt(row.weight);
    return { id: row.id, amount: numerator / denominator, remainder: numerator % denominator };
  });
  let remaining = BigInt(total) - allocated.reduce((sum, row) => sum + row.amount, BigInt(0));
  allocated.sort((a, b) => a.remainder === b.remainder ? (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) : a.remainder > b.remainder ? -1 : 1);
  for (const row of allocated) {
    if (remaining === BigInt(0)) break;
    row.amount += BigInt(1); remaining -= BigInt(1);
  }
  return Object.fromEntries(allocated.map(row => [row.id, transactionSafeAmount(row.amount)]));
}

import 'server-only';
import { createHash } from 'node:crypto';
import { isTossKeyPairAligned, isTossSecretKey, tossKeyMode } from '@/lib/payments/toss-config.mjs';
import { settlementDecimal } from './decimal';
import { parseSettlementJson, SettlementJsonNumber } from './lossless-json.server';
import { isSettlementDate, parseSettlementQuery, type SettlementMode, type SettlementQuery, type SettlementRecord } from './types';

const ORIGIN = 'https://api.tosspayments.com';
export const SETTLEMENT_PAGE_SIZE = 1_000;
export const SETTLEMENT_MAX_PAGES = 20;
export const SETTLEMENT_REQUEST_TIMEOUT_MS = 65_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
type Failure = 'invalid_request' | 'invalid_response' | 'merchant_mismatch' | 'duplicate_transaction'
  | 'provider_unavailable' | 'provider_credentials' | 'response_too_large' | 'page_limit';
export class SettlementFetchError extends Error {
  constructor(readonly code: Failure) { super(code); this.name = 'SettlementFetchError'; }
}

export interface TossSettlementConfiguration { secretKey: string; mId: string; mode: SettlementMode; scopeHash: string }

/** Optional and OFF by default. Reuses the server payment secret; never provisions credentials. */
export function readTossSettlementConfiguration(): TossSettlementConfiguration | null {
  if (process.env.TOSS_SETTLEMENT_SYNC_ENABLED !== 'true') return null;
  const secretKey = process.env.TOSS_SECRET_KEY?.trim() ?? '';
  const clientKey = process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim() ?? '';
  const mId = process.env.TOSS_SETTLEMENT_MID?.trim() ?? '';
  if (!isTossSecretKey(secretKey) || !isTossKeyPairAligned(clientKey, secretKey) || !identifier(mId, 14)) return null;
  const mode = tossKeyMode(secretKey);
  if (!mode || (mode === 'live' && process.env.VERCEL_ENV !== 'production')) return null;
  // Private worker binding only: a resumed import cannot silently switch merchant or credentials.
  const scopeHash = createHash('sha256').update(`toss\0${mode}\0${mId}\0${secretKey}`).digest('hex');
  return { secretKey, mId, mode, scopeHash };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function identifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= maximum && /^[\x21-\x7e]+$/.test(value);
}
function timestamp(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  return isSettlementDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}
const decimal = (value: unknown) => settlementDecimal(value instanceof SettlementJsonNumber ? value.raw : value);

/** Whitelist only statement fields. Discards card, account, phone, customer, and cancelReason. */
export function parseTossSettlementRecord(value: unknown, expectedMid: string): SettlementRecord {
  const row = object(value);
  const invalid = (): never => { throw new SettlementFetchError('invalid_response'); };
  if (!row || !identifier(row.mId, 14)) return invalid();
  if (row.mId !== expectedMid) throw new SettlementFetchError('merchant_mismatch');
  if (!identifier(row.paymentKey, 200) || !identifier(row.transactionKey, 64)
    || typeof row.orderId !== 'string' || !/^[A-Za-z0-9_-]{6,64}$/.test(row.orderId)
    || typeof row.currency !== 'string' || !/^[A-Z]{3}$/.test(row.currency)
    || typeof row.method !== 'string' || !row.method.trim() || row.method.length > 40 || /[\x00-\x1f\x7f]/.test(row.method)
    || !timestamp(row.approvedAt) || !isSettlementDate(row.soldDate) || !isSettlementDate(row.paidOutDate)
    || !Array.isArray(row.fees) || row.fees.length > 100) return invalid();
  const amount = decimal(row.amount), interestFee = decimal(row.interestFee);
  const supplyAmount = decimal(row.supplyAmount), vat = decimal(row.vat), payOutAmount = decimal(row.payOutAmount);
  if (amount === null || interestFee === null || supplyAmount === null || vat === null || payOutAmount === null) return invalid();
  const fees = row.fees.map(item => {
    const fee = object(item);
    if (!fee || typeof fee.type !== 'string' || !/^[A-Z_]{1,40}$/.test(fee.type)) return invalid();
    const feeAmount = decimal(fee.fee);
    return feeAmount === null ? invalid() : { type: fee.type, fee: feeAmount };
  }).sort((a, b) => a.type.localeCompare(b.type, 'en') || a.fee.localeCompare(b.fee, 'en'));
  let cancel: SettlementRecord['cancel'] = null;
  if (row.cancel !== null && row.cancel !== undefined) {
    const cancellation = object(row.cancel);
    if (!cancellation || !timestamp(cancellation.canceledAt) || !identifier(cancellation.transactionKey, 64)
      || cancellation.transactionKey !== row.transactionKey) return invalid();
    const cancelAmount = decimal(cancellation.cancelAmount);
    if (cancelAmount === null) return invalid();
    cancel = { cancelAmount, canceledAt: cancellation.canceledAt, transactionKey: cancellation.transactionKey };
  }
  return { mId: row.mId, paymentKey: row.paymentKey, transactionKey: row.transactionKey, orderId: row.orderId,
    currency: row.currency, method: row.method, amount, interestFee, fees, supplyAmount, vat, payOutAmount,
    approvedAt: row.approvedAt, soldDate: row.soldDate, paidOutDate: row.paidOutDate, cancel };
}

async function responseText(response: Response): Promise<string> {
  const length = response.headers.get('content-length');
  if (length && /^\d+$/.test(length) && Number(length) > MAX_RESPONSE_BYTES) {
    try { await response.body?.cancel(); } catch { /* Preserve the bounded-response failure. */ }
    throw new SettlementFetchError('response_too_large');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new SettlementFetchError('invalid_response');
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new SettlementFetchError('response_too_large'); }
      parts.push(result.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts));
  } finally { reader.releaseLock(); }
}

export interface SettlementPage {
  records: SettlementRecord[];
  sourceCount: number;
  /** Private import deduplication across pages, including adjacent-day rows. */
  sourceTransactionKeys: string[];
  page: number;
  sourceHash: string;
  recordsHash: string;
  terminal: boolean;
}

/** One page per worker step keeps the >=60s provider budget independent of total import size. */
export async function fetchTossSettlementPage(
  configuration: TossSettlementConfiguration,
  query: SettlementQuery,
  page: number,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {},
): Promise<SettlementPage> {
  const parsed = parseSettlementQuery(query);
  if (!parsed || !Number.isInteger(page) || page < 1 || page > SETTLEMENT_MAX_PAGES + 1
    || !isTossSecretKey(configuration.secretKey) || !identifier(configuration.mId, 14)) throw new SettlementFetchError('invalid_request');
  const url = new URL('/v1/settlements', ORIGIN);
  for (const [key, value] of Object.entries(parsed)) url.searchParams.set(key, value);
  // The official date-only API does not specify endpoint inclusivity. Read one
  // adjacent day on each side, then select exact requested calendar dates below.
  // Termination and page budgets use the provider's count, never filtered rows.
  const adjacent = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
  const providerStartDate = adjacent(parsed.startDate, -1), providerEndDate = adjacent(parsed.endDate, 1);
  url.searchParams.set('startDate', providerStartDate); url.searchParams.set('endDate', providerEndDate);
  url.searchParams.set('page', String(page)); url.searchParams.set('size', String(SETTLEMENT_PAGE_SIZE));
  const timeout = AbortSignal.timeout(SETTLEMENT_REQUEST_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  try {
    const response = await (options.fetch ?? fetch)(url, {
      method: 'GET', cache: 'no-store', redirect: 'error', signal,
      headers: { Authorization: `Basic ${Buffer.from(`${configuration.secretKey}:`).toString('base64')}`, Accept: 'application/json' },
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new SettlementFetchError(response.status === 401 || response.status === 403 ? 'provider_credentials' : 'provider_unavailable');
    }
    const source = await responseText(response);
    let decoded: unknown;
    try { decoded = parseSettlementJson(source); } catch { throw new SettlementFetchError('invalid_response'); }
    if (!Array.isArray(decoded) || decoded.length > SETTLEMENT_PAGE_SIZE) throw new SettlementFetchError('invalid_response');
    if (page > SETTLEMENT_MAX_PAGES && decoded.length > 0) throw new SettlementFetchError('page_limit');
    const observed = decoded.map(row => parseTossSettlementRecord(row, configuration.mId));
    if (new Set(observed.map(row => row.transactionKey)).size !== observed.length) throw new SettlementFetchError('duplicate_transaction');
    if (observed.some(row => row[parsed.dateType] < providerStartDate || row[parsed.dateType] > providerEndDate)) throw new SettlementFetchError('invalid_response');
    const records = observed.filter(row => row[parsed.dateType] >= parsed.startDate && row[parsed.dateType] <= parsed.endDate);
    return { records, sourceCount: observed.length, sourceTransactionKeys: observed.map(row => row.transactionKey), page, sourceHash: createHash('sha256').update(source).digest('hex'),
      recordsHash: createHash('sha256').update(JSON.stringify(records)).digest('hex'), terminal: observed.length < SETTLEMENT_PAGE_SIZE };
  } catch (error) {
    if (error instanceof SettlementFetchError) throw error;
    // Do not expose credentials, raw provider error text, URLs, or response bodies.
    throw new SettlementFetchError('provider_unavailable');
  }
}

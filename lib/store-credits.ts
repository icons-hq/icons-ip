/** 주문 할인용 적립금. 무료 코인·카드팩 원장과 값을 공유하지 않는다. */
export interface StoreCreditPolicy {
  enabled: boolean;
  earnKind: 'rate_bps' | 'fixed' | null;
  earnValue: number | null;
  earnMaxPerOrder: number | null;
  maxBalance: number | null;
  validityDays: number | null;
  minUse: number | null;
  maxUse: number | null;
  restoreGraceDays: number | null;
  refundEarnedCreditMode: 'offset_future_credits' | null;
  evidence: string;
}
export interface StoreCreditPolicyRecord extends StoreCreditPolicy { version: number; updatedAt: string }
export interface StoreCreditEntry {
  id: string; kind: string; amount: number; availableDelta: number; reservedDelta: number;
  debtDelta: number; orderId: string | null; lotId: string | null; actorId: string | null;
  reason: string; expiresAt: string | null; createdAt: string;
}
export interface StoreCreditHistory {
  userId: string; enabled: boolean; available: number; reserved: number; debt: number;
  total: number; page: number; pageSize: number; items: StoreCreditEntry[];
}
export interface StoreCreditCheckoutQuote {
  enabled: boolean; available: number; reserved: number; debt: number;
  minUse: number | null; maxUse: number; requestedAmount: number;
  valid: boolean; reason: string | null;
}
export interface StoreCreditBalanceValues { available: number; reserved: number; debt: number }
const MAX_AMOUNT = 999_999_999_999; // Existing goods payment technical ceiling.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function money(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_AMOUNT; }
function signedMoney(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT; }
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function instant(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)); }
function nullableUuid(value: unknown): value is string | null { return value === null || typeof value === 'string' && UUID_PATTERN.test(value); }
export function parseStoreCreditBalanceValues(value: unknown): StoreCreditBalanceValues | null {
  if (!record(value) || !money(value.available) || !money(value.reserved) || !money(value.debt)) return null;
  return { available: value.available, reserved: value.reserved, debt: value.debt };
}
function balances(value: Record<string, unknown>): boolean { return typeof value.enabled === 'boolean' && Boolean(parseStoreCreditBalanceValues(value)); }

export function parseStoreCreditCheckoutQuote(value: unknown): StoreCreditCheckoutQuote | null {
  if (!record(value) || !balances(value) || !(value.minUse === null || money(value.minUse)) || !money(value.maxUse)
    || !money(value.requestedAmount) || typeof value.valid !== 'boolean'
    || !(value.reason === null || typeof value.reason === 'string' && value.reason.trim().length > 0)) return null;
  const quote = value as unknown as StoreCreditCheckoutQuote;
  if (quote.maxUse > quote.available || (!quote.enabled && (quote.maxUse !== 0 || quote.reason !== 'store_credit_disabled'))
    || (quote.enabled && quote.minUse === null) || (!quote.valid && quote.reason === null)
    || (quote.requestedAmount === 0 && !quote.valid)) return null;
  if (quote.valid && quote.requestedAmount > 0 && (!quote.enabled || quote.reason !== null || quote.debt !== 0
    || quote.requestedAmount < (quote.minUse ?? 0) || quote.requestedAmount > quote.maxUse)) return null;
  if (quote.debt > 0 && quote.maxUse !== 0) return null;
  return quote;
}

export function parseStoreCreditHistory(value: unknown): StoreCreditHistory | null {
  if (!record(value) || !balances(value) || typeof value.userId !== 'string' || !UUID_PATTERN.test(value.userId)
    || !count(value.total) || !count(value.page) || value.page < 1 || value.page > 1_000_000
    || !count(value.pageSize) || value.pageSize < 1 || value.pageSize > 100 || !Array.isArray(value.items)
    || value.items.length > value.pageSize || value.items.length > value.total) return null;
  for (const entry of value.items) {
    if (!record(entry) || typeof entry.id !== 'string' || !/^[1-9][0-9]*$/.test(entry.id)
      || typeof entry.kind !== 'string' || !Object.hasOwn(ENTRY_LABELS, entry.kind)
      || !signedMoney(entry.amount) || !signedMoney(entry.availableDelta) || !signedMoney(entry.reservedDelta) || !signedMoney(entry.debtDelta)
      || !nullableUuid(entry.orderId) || !nullableUuid(entry.lotId) || !nullableUuid(entry.actorId)
      || typeof entry.reason !== 'string' || entry.reason.length > 1000 || !instant(entry.createdAt)
      || !(entry.expiresAt === null || instant(entry.expiresAt))) return null;
  }
  return value as unknown as StoreCreditHistory;
}

export function parseStoreCreditPolicyRecord(value: unknown): StoreCreditPolicyRecord | null {
  if (!record(value) || typeof value.enabled !== 'boolean' || !count(value.version) || value.version < 1 || !instant(value.updatedAt)
    || ![null, 'rate_bps', 'fixed'].includes(value.earnKind as string | null)
    || ![null, 'offset_future_credits'].includes(value.refundEarnedCreditMode as string | null)
    || typeof value.evidence !== 'string' || value.evidence.length > 2000) return null;
  for (const key of ['earnValue', 'earnMaxPerOrder', 'maxBalance', 'validityDays', 'minUse', 'maxUse', 'restoreGraceDays']) {
    if (value[key] !== null && !money(value[key])) return null;
    if (value.enabled && value[key] === null) return null;
  }
  const policy = value as unknown as StoreCreditPolicyRecord;
  if (policy.enabled && (!policy.earnKind || !policy.refundEarnedCreditMode || !policy.evidence.trim())) return null;
  if (policy.validityDays !== null && (policy.validityDays < 1 || policy.validityDays > 36_500)
    || policy.restoreGraceDays !== null && policy.restoreGraceDays > 36_500
    || policy.minUse !== null && policy.maxUse !== null && policy.minUse > policy.maxUse
    || policy.earnKind === 'rate_bps' && policy.earnValue !== null && policy.earnValue > 10_000) return null;
  return policy;
}
export function normalizeStoreCreditAmount(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value)) return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT ? amount : null;
}
export function parseStoreCreditPolicyInput(form: FormData): { ok: true; policy: StoreCreditPolicy } | { ok: false; error: string } {
  const read = (key: string) => typeof form.get(key) === 'string' ? String(form.get(key)).trim() : '';
  const values: Record<string, number | null> = {};
  for (const key of ['earnValue', 'earnMaxPerOrder', 'maxBalance', 'validityDays', 'minUse', 'maxUse', 'restoreGraceDays']) {
    const raw = read(key);
    values[key] = raw === '' ? null : normalizeStoreCreditAmount(raw);
    if (raw !== '' && values[key] === null) return { ok: false, error: '정책 수치는 0 이상의 원 단위 정수로 입력해주세요.' };
  }
  const kind = read('earnKind');
  const mode = read('refundEarnedCreditMode');
  if (kind && !['rate_bps', 'fixed'].includes(kind) || mode && mode !== 'offset_future_credits') return { ok: false, error: '적립 방식과 환불 회수 기준을 확인해주세요.' };
  const policy: StoreCreditPolicy = {
    enabled: form.get('enabled') === 'on' || form.get('enabled') === 'true',
    earnKind: kind as StoreCreditPolicy['earnKind'] || null, earnValue: values.earnValue,
    earnMaxPerOrder: values.earnMaxPerOrder, maxBalance: values.maxBalance, validityDays: values.validityDays,
    minUse: values.minUse, maxUse: values.maxUse, restoreGraceDays: values.restoreGraceDays,
    refundEarnedCreditMode: mode as StoreCreditPolicy['refundEarnedCreditMode'] || null, evidence: read('evidence'),
  };
  if (policy.evidence.length > 2000) return { ok: false, error: '정책 근거는 2,000자 이내로 입력해주세요.' };
  if ((policy.earnKind === 'rate_bps' && policy.earnValue !== null && policy.earnValue > 10_000)
    || (policy.validityDays !== null && (policy.validityDays < 1 || policy.validityDays > 36_500))
    || (policy.restoreGraceDays !== null && policy.restoreGraceDays > 36_500)
    || (policy.minUse !== null && policy.maxUse !== null && policy.minUse > policy.maxUse)) {
    return { ok: false, error: '적립률·유효기간·사용 하한과 상한을 확인해주세요.' };
  }
  if (policy.enabled && (!policy.earnKind || !policy.refundEarnedCreditMode || !policy.evidence
    || Object.values(values).some(value => value === null))) {
    return { ok: false, error: '모든 정책 수치와 환불 회수 기준·근거를 설정해야 활성화할 수 있습니다.' };
  }
  return { ok: true, policy };
}
const ENTRY_LABELS: Record<string, string> = {
  grant: '적립', adjustment_credit: '운영 지급', adjustment_debit: '운영 차감',
  expire: '유효기간 만료', reserve: '주문 사용 대기', consume: '주문 사용 확정',
  restore: '주문 취소·환불 복원', earned_reversal: '환불 주문 적립 회수',
  debt_offset: '환불 적립금 상계', restoration_expired: '복원 후 유효기간 만료',
};
export function storeCreditEntryLabel(kind: string): string { return ENTRY_LABELS[kind] ?? '적립금 변동'; }
export function storeCreditErrorMessage(reason: string | null): string {
  if (reason?.includes('admin_required')) return '현재 관리자 권한이 없습니다. 계정을 다시 확인해주세요.';
  if (reason?.includes('store_credit_disabled')) return '적립금 정책을 준비 중입니다.';
  if (reason?.includes('store_credit_expiry_invalid')) return '정책 유효기간 안에 있는 미래 만료 일시를 입력해주세요.';
  if (reason?.includes('store_credit_balance_limit')) return '지급 후 잔액이 보유 적립금 상한을 초과합니다.';
  if (reason?.includes('store_credit_insufficient')) return '사용 가능한 적립금이 부족합니다.';
  if (reason?.includes('store_credit_debt')) return '환불로 회수할 적립금이 있어 사용이 제한됩니다.';
  if (reason?.includes('store_credit_amount')) return '사용 하한·상한과 굿즈 결제 잔액을 확인해주세요.';
  if (reason?.includes('conflict')) return '다른 작업으로 내용이 변경됐습니다. 최신 내역을 확인해주세요.';
  return '적립금을 처리하지 못했습니다. 최신 잔액을 확인한 뒤 다시 시도해주세요.';
}

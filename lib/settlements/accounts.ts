import { isUuid } from '@/lib/uuid';
export interface SettlementAccountIdentity { accountId: string; integration: 'toss_payment' | 'toss_billing' }
export interface SettlementAccountOption extends SettlementAccountIdentity { mode: 'test' | 'live'; label: string }
export function settlementAccountKey(account: SettlementAccountIdentity): string { return account.accountId; }
export function parseSettlementAccountKey(value: unknown): string | null {
  return value === 'current' ? 'current' : typeof value === 'string' && isUuid(value) && value === value.toLowerCase() ? value : null;
}
export function parseSettlementAccountIdentity(value: unknown): SettlementAccountIdentity | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (parseSettlementAccountKey(row.accountId) === null || row.accountId === 'current' || !['toss_payment', 'toss_billing'].includes(String(row.integration))) return null;
  return { accountId: row.accountId as string, integration: row.integration as SettlementAccountIdentity['integration'] };
}
export function settlementAccountMatches(left: SettlementAccountIdentity, right: SettlementAccountIdentity): boolean {
  return left.integration === right.integration && left.accountId === right.accountId;
}
export function settlementAccountLabel(account: SettlementAccountIdentity): string {
  return `${account.integration === 'toss_billing' ? '정기결제' : '일반 결제'} · 계정 ${account.accountId.slice(0, 8)}`;
}

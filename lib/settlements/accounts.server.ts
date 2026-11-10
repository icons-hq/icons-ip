import 'server-only';
import { createHash } from 'node:crypto';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { billingProfilesFromEnvironment } from '@/lib/subscriptions/billing-profiles.server';
import { readTossSettlementConfiguration, type TossSettlementConfiguration } from './toss-settlements.server';
import { parseSettlementAccountIdentity, parseSettlementAccountKey, settlementAccountMatches,
  type SettlementAccountIdentity, type SettlementAccountOption } from './accounts';
import { isUuid } from '@/lib/uuid';
export interface PrivateSettlementAccount extends SettlementAccountIdentity { profileId: string | null; merchantId: string; mode: 'test' | 'live' }
export type AccountSettlementConfiguration = TossSettlementConfiguration & { account: PrivateSettlementAccount | null };
interface AccountRpc { rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }> }
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
function parsePrivateAccount(value: unknown): PrivateSettlementAccount | null {
  const publicPart = parseSettlementAccountIdentity(value);if (!publicPart || !object(value) || !['test', 'live'].includes(String(value.mode))
    || typeof value.merchantId !== 'string' || !/^[\x21-\x7e]{1,14}$/.test(value.merchantId)
    || (publicPart.integration === 'toss_payment' ? value.profileId !== null : !isUuid(value.profileId))) return null;
  return { ...publicPart, profileId: value.profileId as string | null, merchantId: value.merchantId, mode: value.mode as 'test' | 'live' };
}
/** GET uses the current key for the immutable identity from a service-only RPC. */
export async function readAccountSettlementConfiguration(key?: string | null, expected?: SettlementAccountIdentity & { mode: 'test' | 'live' }, supplied?: AccountRpc): Promise<AccountSettlementConfiguration | null> {
  if (key && !parseSettlementAccountKey(key)) return null;
  if (!key || key === 'current') {
    if (expected) return null;
    const config = readTossSettlementConfiguration();return config ? { ...config, account: null } : null;
  }
  let account: PrivateSettlementAccount | null;
  try {
    const client = supplied ?? createServiceClient();const { data, error } = await client.rpc('service_get_pg_settlement_account', { p_account_id: key });
    account = error ? null : parsePrivateAccount(data);
  } catch { return null; }
  if (!account || account.accountId !== key || expected && (!settlementAccountMatches(account, expected) || account.mode !== expected.mode)) return null;
  if (account.integration === 'toss_payment') {
    const config = readTossSettlementConfiguration();return config && config.mId === account.merchantId && config.mode === account.mode ? { ...config, account } : null;
  }
  if (process.env.TOSS_SETTLEMENT_SYNC_ENABLED !== 'true') return null;
  const registry = billingProfilesFromEnvironment(), identity = { profileId: account.profileId!, merchantId: account.merchantId, environment: account.mode };
  const secretKey = registry?.secret(identity);if (!secretKey) return null;
  const scopeHash = createHash('sha256').update(JSON.stringify(['toss_billing', account.accountId, identity.profileId, identity.merchantId, identity.environment])).digest('hex');
  return { account, secretKey, mId: identity.merchantId, mode: identity.environment, scopeHash };
}
export async function loadSettlementAccounts(): Promise<SettlementAccountOption[] | null> {
  try {
    const { data, error } = await (await createClient()).rpc('admin_list_pg_settlement_accounts');
    if (error || !Array.isArray(data)) return null;
    const rows: SettlementAccountOption[] = [];
    for (const value of data) {
      const identity = parseSettlementAccountIdentity(value);if (!identity || !object(value) || !['test', 'live'].includes(String(value.mode)) || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100) return null;
      rows.push({ ...identity, mode: value.mode as 'test' | 'live', label: value.label });
    }
    const regular = readTossSettlementConfiguration();
    if (regular) {
      const { data: knownId, error: lookupError } = await createServiceClient().rpc('service_find_regular_pg_settlement_account', { p_mid: regular.mId, p_mode: regular.mode });
      if (lookupError || knownId !== null && !isUuid(knownId)) return null;
      if (knownId === null) rows.unshift({ accountId: 'current', integration: 'toss_payment', mode: regular.mode, label: `일반 결제 · ${regular.mode === 'test' ? '테스트' : '실거래'} · 현재 연결` });
      else { const known = rows.find(row => row.accountId === knownId);if (!known) return null;rows.splice(rows.indexOf(known), 1);rows.unshift(known); }
    }
    if (new Set(rows.map(row => row.accountId)).size !== rows.length) return null;
    return rows;
  } catch { return null; }
}

import 'server-only';
import { unstable_rethrow } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { PgSettlementFilters } from './console';
import { parsePgSettlementReport, pgSettlementRpcQuery } from './report';
import { readAccountSettlementConfiguration } from './accounts.server';

export async function loadPgSettlementReport(filters: PgSettlementFilters) {
  if (filters.rangeError) return null;
  try {
    const client = await createClient();
    const { data, error } = await client.rpc('admin_get_pg_settlement_report', { p_query: pgSettlementRpcQuery(filters) });
    return error ? null : parsePgSettlementReport(data, filters);
  } catch (error) { unstable_rethrow(error); return null; }
}
export async function pgSettlementConnectionState(account?: string | null) {
  const config = await readAccountSettlementConfiguration(account);
  return { enabled: config !== null, mode: config?.mode ?? null };
}

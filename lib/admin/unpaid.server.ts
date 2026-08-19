import 'server-only';

import { normalizeBankDepositConfidence } from '@/lib/payments/bank-deposit-feed';
import { createClient } from '@/lib/supabase/server';
import {
  ADMIN_UNPAID_PAGE_SIZE,
  type AdminBankDepositRow,
  type AdminUnpaidConsoleData,
  type AdminUnpaidFilters,
  type AdminUnpaidOrderRow,
} from './unpaid';

interface UnpaidRow {
  order_id: string;
  buyer_name: string | null;
  buyer_id: string;
  recipient_name: string | null;
  total: number;
  created_at: string;
  expires_at: string | null;
  extended_at: string | null;
  deposit_code: string;
  item_summary: string | null;
  attempt_state: string | null;
  total_count: number;
}

interface DepositRow {
  deposit_id: string;
  source: string;
  external_id: string;
  deposited_at: string;
  depositor_name: string;
  amount: number;
  raw_reference: string | null;
  suggested_order_id: string | null;
  suggested_order_code: string | null;
  suggested_confidence: string | null;
}

/**
 * 미입금 무통장 주문 목록.
 *
 * staff RLS만으로는 주문·품목·프로필을 한 번에 읽을 수 없어 전용 RPC를 쓴다.
 * 주소·연락처는 일부러 싣지 않는다 — 입금 대조에 필요한 정보가 아니고, 목록
 * 화면에 개인정보를 늘어놓을 이유가 없다.
 */
export async function getAdminUnpaidOrders(
  filters: AdminUnpaidFilters,
): Promise<AdminUnpaidConsoleData> {
  const supabase = await createClient();
  const [{ data, error }, { data: depositData, error: depositError }] = await Promise.all([
    supabase.rpc('admin_unpaid_bank_transfer_orders', {
      p_query: filters.query || null,
      p_limit: ADMIN_UNPAID_PAGE_SIZE,
      p_offset: (filters.page - 1) * ADMIN_UNPAID_PAGE_SIZE,
    }),
    supabase.rpc('admin_bank_deposit_queue', { p_status: 'unmatched', p_limit: 30 }),
  ]);

  if (error) throw new Error(`Failed to load unpaid orders: ${error.message}`);
  if (depositError) throw new Error(`Failed to load bank deposits: ${depositError.message}`);

  const rows = (data ?? []) as UnpaidRow[];
  const deposits: AdminBankDepositRow[] = ((depositData ?? []) as DepositRow[]).map((row) => ({
    id: row.deposit_id,
    source: row.source,
    externalId: row.external_id,
    depositedAt: row.deposited_at,
    depositorName: row.depositor_name,
    amount: row.amount,
    rawReference: row.raw_reference,
    suggestedOrderId: row.suggested_order_id,
    suggestedOrderCode: row.suggested_order_code,
    suggestedConfidence: normalizeBankDepositConfidence(row.suggested_confidence),
  }));
  const unpaid: AdminUnpaidOrderRow[] = rows.map((row) => ({
    id: row.order_id,
    buyerName: row.buyer_name?.trim() || `fan_${row.buyer_id.slice(0, 6)}`,
    buyerId: row.buyer_id,
    recipientName: row.recipient_name?.trim() ?? '',
    total: row.total,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    extendedAt: row.extended_at,
    depositCode: row.deposit_code,
    itemSummary: row.item_summary ?? '',
    attemptState: row.attempt_state,
  }));

  return {
    filters,
    pageSize: ADMIN_UNPAID_PAGE_SIZE,
    rows: unpaid,
    total: rows[0]?.total_count ?? 0,
    deposits,
  };
}

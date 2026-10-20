import 'server-only';
import { createClient } from '../supabase/server';
import { parseRefundTransferPage, REFUND_TRANSFERS_PAGE_SIZE } from './refund-transfers';

export async function loadRefundTransfers(page: number) {
  const client = await createClient();
  const { data, error } = await client.rpc('admin_list_bank_transfer_refunds', {
    p_limit: REFUND_TRANSFERS_PAGE_SIZE, p_offset: (page - 1) * REFUND_TRANSFERS_PAGE_SIZE,
  });
  const result = error ? null : parseRefundTransferPage(data, page);
  if (!result) throw new Error('환불 송금 대기 목록을 불러오지 못했습니다.');
  return result;
}

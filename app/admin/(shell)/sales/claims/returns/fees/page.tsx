import { redirect } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { claimFeeQueueFilters, claimFeeQueueHref, parseClaimFeeQueue } from '@/lib/admin/claim-fees';
import { ClaimFeesScreen } from '@/components/admin/screens/ClaimFeesScreen';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 await requireAdminScreenAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
 const filters = claimFeeQueueFilters(await searchParams), supabase = await createClient(), { data, error } = await supabase.rpc('admin_list_claim_fees_numbered', { p_state: filters.state, p_page: filters.page });
 const queue = error ? null : parseClaimFeeQueue(data);
 if (!queue) throw new Error('배송비 청구 내역을 불러오지 못했습니다.');
 const last = Math.max(1, Math.ceil(queue.total / queue.pageSize));
 if (queue.page > last) redirect(claimFeeQueueHref(queue.state, last));
 /* 같은 주문의 여러 청구를 구분하도록 '요청' 칸에 요청번호를 함께 보인다. 읽기 전용이고, 읽지 못하면 번호 없이 유형만 보인다(목록은 그대로 열린다). */
 const references: Record<string, number> = {};
 const claimIds = [...new Set(queue.rows.map(row => row.claimId))];
 if (claimIds.length) {
  try {
   const { data: rows } = await supabase.from('order_cancellation_requests').select('id,reference').in('id', claimIds);
   for (const entry of rows ?? []) { const reference = Number(entry.reference); if (typeof entry.id === 'string' && Number.isSafeInteger(reference) && reference > 0) references[entry.id] = reference; }
  } catch { /* 번호를 읽지 못해도 목록은 연다 */ }
 }
 return <ClaimFeesScreen data={queue} references={references} />;
}

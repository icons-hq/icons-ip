import { redirect } from 'next/navigation';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { claimFeeQueueFilters, claimFeeQueueHref, parseClaimFeeQueue } from '@/lib/admin/claim-fees';
import { ClaimFeesScreen } from '@/components/admin/screens/ClaimFeesScreen';
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
 await requireAdminScreenAccess('/admin/sales/claims/returns', { capability: 'sales.manage' });
 const filters = claimFeeQueueFilters(await searchParams), { data, error } = await (await createClient()).rpc('admin_list_claim_fees_numbered', { p_state: filters.state, p_page: filters.page });
 const queue = error ? null : parseClaimFeeQueue(data);
 if (!queue) throw new Error('배송비 청구 목록을 불러오지 못했습니다.');
 const last = Math.max(1, Math.ceil(queue.total / queue.pageSize));
 if (queue.page > last) redirect(claimFeeQueueHref(queue.state, last));
 return <ClaimFeesScreen data={queue} />;
}

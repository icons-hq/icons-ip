import Link from 'next/link';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { parseClaimFeePolicy } from '@/lib/orders/claim-fees';
import { CLAIM_FEE_LIST_LABEL, CLAIM_FEE_SETTINGS_LABEL, CLAIM_FEES_PATH } from '@/lib/admin/claim-fees';
import { ClaimFeePolicyForm } from '@/components/admin/ClaimFeePolicyForm';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';
export default async function Page() {
 const auth = await requireAdminScreenAccess('/admin/sales/claims/returns', { capability: 'sales.manage' }), client = await createClient();
 const [result, session] = await Promise.all([client.rpc('admin_get_claim_fee_policy'), client.auth.getSession()]);
 const policy = result.error ? null : parseClaimFeePolicy(result.data);
 if (!policy) throw new Error('배송비 청구 설정을 불러오지 못했습니다.');
 const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
 return <section className="flex min-w-0 flex-col gap-4"><AdminPageHeader title={CLAIM_FEE_SETTINGS_LABEL} actions={<>
   <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href={CLAIM_FEES_PATH}>{CLAIM_FEE_LIST_LABEL}</Link>
   <Link className={buttonVariants({ size: 'sm', variant: 'outline' })} data-slot="button" href="/admin/sales/claims/returns">반품 관리</Link>
  </>} />
  <AdminSectionCard title="반품·교환 배송비 청구"><ClaimFeePolicyForm key={`${auth.user.id}:${sessionId}`} initial={policy} actorId={auth.user.id} sessionId={sessionId} /></AdminSectionCard></section>;
}

import Link from 'next/link';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { parseClaimFeePolicy } from '@/lib/orders/claim-fees';
import { ClaimFeePolicyForm } from '@/components/admin/ClaimFeePolicyForm';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
export default async function Page() {
 const auth = await requireAdminScreenAccess('/admin/sales/claims/returns', { capability: 'sales.manage' }), client = await createClient();
 const [result, session] = await Promise.all([client.rpc('admin_get_claim_fee_policy'), client.auth.getSession()]);
 const policy = result.error ? null : parseClaimFeePolicy(result.data);
 if (!policy) throw new Error('배송비 청구 정책을 불러오지 못했습니다.');
 const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
 return <section className="wc-admin-kit"><AdminPageHeader title="반품·교환 배송비 정책" description="고객 합의에 따른 별도 청구·입금 확인·반환을 관리합니다." actions={<Link href="/admin/sales/claims/returns">반품 관리</Link>} />
  <AdminSectionCard title={policy.enabled ? '새 배송비 청구 활성' : '새 배송비 청구 꺼짐'}><ClaimFeePolicyForm key={`${auth.user.id}:${sessionId}`} initial={policy} actorId={auth.user.id} sessionId={sessionId} /></AdminSectionCard></section>;
}

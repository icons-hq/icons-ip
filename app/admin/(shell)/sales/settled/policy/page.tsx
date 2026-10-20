import Link from 'next/link';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { PURCHASE_CONFIRMATION_POLICY_PATH, parsePurchaseConfirmationPolicy } from '@/lib/purchase-confirmation';
import { PurchaseConfirmationPolicyForm } from '@/components/admin/PurchaseConfirmationPolicyForm';
import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
export default async function Page() {
  const auth = await requireAdminScreenAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' });
  const client = await createClient();
  const [result, session] = await Promise.all([client.rpc('admin_get_purchase_confirmation_policy'), client.auth.getSession()]);
  const policy = result.error ? null : parsePurchaseConfirmationPolicy(result.data);
  if (!policy) throw new Error('구매확정 정책을 불러오지 못했습니다.');
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <section className="wc-admin-kit"><AdminPageHeader title="구매확정 정책" description="자동 확정·구매자 연장 기간을 설정합니다." actions={<Link href="/admin/sales/settled">거래확정 내역</Link>} />
    <AdminSectionCard title={policy.autoEnabled ? '자동 구매확정 활성' : '자동 구매확정 꺼짐'}><PurchaseConfirmationPolicyForm key={`${auth.user.id}:${sessionId}`} initial={policy} actorId={auth.user.id} sessionId={sessionId} /></AdminSectionCard></section>;
}

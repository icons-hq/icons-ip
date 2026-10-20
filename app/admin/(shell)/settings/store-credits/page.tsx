import { AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { StoreCreditPolicyForm } from '@/components/admin/screens/StoreCreditForms';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminStoreCreditPolicy } from '@/lib/admin/store-credits.server';
import { loadCustomerRewardPolicy } from '@/lib/admin/customer-rewards.server';
import { CustomerRewardPolicyForm } from '@/components/admin/CustomerRewardPolicyForm';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';

export default async function Page() {
  const auth = await requireAdminScreenAccess('/admin/settings/store-credits', { adminOnly: true });
  const client = await createClient();
  const [policy, rewards, session] = await Promise.all([loadAdminStoreCreditPolicy(), loadCustomerRewardPolicy(), client.auth.getSession()]);
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <section className="wc-admin-kit">
    <AdminPageHeader title="적립금 정책" description="주문 할인용 적립금의 지급·사용·만료·환불 기준을 설정합니다. 정책 변경과 단건 조정은 관리자만 할 수 있습니다." />
    <AdminSectionCard title={policy.enabled ? '활성 정책' : '비활성 정책'}><StoreCreditPolicyForm policy={policy} operationId={crypto.randomUUID()} /></AdminSectionCard>
    <AdminSectionCard title="등급·리뷰 보상"><CustomerRewardPolicyForm key={`${auth.user.id}:${sessionId}`} initial={rewards} actorId={auth.user.id} sessionId={sessionId} /></AdminSectionCard>
  </section>;
}

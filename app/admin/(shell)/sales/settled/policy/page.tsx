import Link from 'next/link';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import { getPurchaseConfirmationPolicy } from '@/lib/admin/purchase-confirmation-policy.server';
import { PURCHASE_CONFIRMATION_POLICY_PATH } from '@/lib/purchase-confirmation';
import { PurchaseConfirmationPolicyForm } from '@/components/admin/PurchaseConfirmationPolicyForm';
import { AdminNotice, AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { buttonVariants } from '@/components/admin/kit/ui/button';

export default async function Page() {
  const auth = await requireAdminScreenAccess(PURCHASE_CONFIRMATION_POLICY_PATH, { capability: 'sales.manage' });
  const [policy, session] = await Promise.all([getPurchaseConfirmationPolicy(), (await createClient()).auth.getSession()]);
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <section className="flex min-w-0 flex-col gap-6">
    <AdminPageHeader title="거래확정 정책" description="배송완료 뒤 며칠째에 자동으로 거래확정할지 정합니다."
      actions={<Link className={buttonVariants({ variant: 'outline' })} data-slot="button" href="/admin/sales/settled">거래확정 내역</Link>} />
    {policy
      ? <AdminSectionCard title={policy.autoEnabled ? '자동 거래확정 켜짐' : '자동 거래확정 꺼짐'}>
        <PurchaseConfirmationPolicyForm key={`${auth.user.id}:${sessionId}`} initial={policy} actorId={auth.user.id} sessionId={sessionId} />
      </AdminSectionCard>
      /* 읽지 못해도 오류 화면으로 던지지 않는다 — 머리와 돌아갈 길을 남기고 그 자리에서 다음 할 일을 말한다. */
      : <AdminNotice tone="danger" role="alert" title="거래확정 정책을 불러오지 못했습니다.">새로고침해도 같으면 개발 담당자에게 알려주세요.</AdminNotice>}
  </section>;
}

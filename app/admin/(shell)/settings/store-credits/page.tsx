import { AdminPageHeader, AdminSectionCard, AdminStatusBadge } from '@/components/admin/console/AdminKit';
import { statusTone } from '@/lib/admin/status-tone';
import { StoreCreditPolicyForm } from '@/components/admin/screens/StoreCreditForms';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { loadAdminStoreCreditPolicy } from '@/lib/admin/store-credits.server';
import { loadCustomerRewardPolicy } from '@/lib/admin/customer-rewards.server';
import { CustomerRewardPolicyForm } from '@/components/admin/CustomerRewardPolicyForm';
import { createClient } from '@/lib/supabase/server';
import { inquiryDraftSessionId } from '@/lib/admin/inquiry-drafts';
import type { StoreCreditPolicyRecord } from '@/lib/store-credits';

const won = (value: number) => `${value.toLocaleString('ko-KR')}원`;

/** 저장된 정책을 한 줄로 — 고객이 실제로 받는 조건을 입력칸을 훑지 않고 읽는다. 비어 있는 값은 말하지 않는다. */
function policyFacts(policy: StoreCreditPolicyRecord) {
  const earn = policy.earnValue === null ? null
    : policy.earnKind === 'rate_bps' ? `상품 금액의 ${(policy.earnValue / 100).toLocaleString('ko-KR', { maximumFractionDigits: 2 })}% 적립`
      : policy.earnKind === 'fixed' ? `주문당 ${won(policy.earnValue)} 적립` : null;
  return [
    earn,
    policy.earnMaxPerOrder === null ? null : `주문당 최대 ${won(policy.earnMaxPerOrder)}`,
    policy.validityDays === null ? null : `유효기간 ${policy.validityDays.toLocaleString('ko-KR')}일`,
    policy.minUse === null || policy.maxUse === null ? null : `1회 ${won(policy.minUse)}~${won(policy.maxUse)} 사용`,
  ].filter(Boolean).join(' · ');
}

export default async function Page() {
  const auth = await requireAdminScreenAccess('/admin/settings/store-credits', { adminOnly: true });
  const client = await createClient();
  const [policy, rewards, session] = await Promise.all([loadAdminStoreCreditPolicy(), loadCustomerRewardPolicy(), client.auth.getSession()]);
  const sessionId = session.data.session?.user.id === auth.user.id ? inquiryDraftSessionId(session.data.session.access_token) : null;
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="적립금 정책" description="주문 할인용 적립금의 지급·사용·만료·환불 기준을 설정합니다. 정책 변경과 단건 조정은 관리자만 할 수 있습니다." />
    <AdminSectionCard summary={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><AdminStatusBadge tone={statusTone('setting', policy.enabled ? 'active' : 'inactive')}>{policy.enabled ? '사용 중' : '비활성'}</AdminStatusBadge><span className="tabular-nums">{policyFacts(policy)}</span></span>} title={policy.enabled ? '활성 정책' : '비활성 정책'}><StoreCreditPolicyForm policy={policy} operationId={crypto.randomUUID()} /></AdminSectionCard>
    <AdminSectionCard title="등급·리뷰 보상"><CustomerRewardPolicyForm key={`${auth.user.id}:${sessionId}`} initial={rewards} actorId={auth.user.id} sessionId={sessionId} /></AdminSectionCard>
  </div>;
}

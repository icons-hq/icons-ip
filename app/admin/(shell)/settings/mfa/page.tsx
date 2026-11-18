import { AdminNotice, AdminPageHeader } from '@/components/admin/console/AdminKit';
import { OperatorMfaPolicyPanel } from '@/components/admin/mfa/OperatorMfaPolicyPanel';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OPERATOR_MFA_POLICY_PATH } from '@/lib/admin/mfa';
import { loadOperatorMfaPolicy } from '@/lib/admin/mfa.server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(OPERATOR_MFA_POLICY_PATH, { adminOnly: true });
  const policy = await loadOperatorMfaPolicy();
  /* 초기화는 최고 관리자만(전환 뒤 통합 매니저, 전환 전 admin). 버튼만 숨기고 판정은 DB가 한다. */
  const access = auth.operatorAccess;
  const canReset = access?.mode === 'configured' ? access.managerRole === 'owner' : auth.role === 'admin';
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="2단계 인증 관리" description="모든 운영자에게 인증 앱(OTP) 2단계 인증을 요구할지 정하고, 운영자별 등록 현황을 확인합니다. 인증 앱이 있는 휴대폰을 잃은 운영자는 통합 매니저가 초기화합니다." />
    {policy
      ? <OperatorMfaPolicyPanel canReset={canReset} initial={policy} selfId={auth.user.id} />
      : <AdminNotice role="alert" title="2단계 인증 관리" tone="danger">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해 주세요.</AdminNotice>}
  </div>;
}

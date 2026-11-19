import { AdminNotice, AdminPageHeader, AdminSectionCard } from '@/components/admin/console/AdminKit';
import { AdminMySecurity } from '@/components/admin/mfa/AdminMySecurity';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { ADMIN_MY_SECURITY_PATH } from '@/lib/admin/mfa';

export default async function Page() {
  const auth = await requireAdminScreenAccess(ADMIN_MY_SECURITY_PATH);
  const required = auth.mfaRequired === true;
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="내 보안 설정" description="로그인할 때 비밀번호와 함께 휴대폰 인증 앱의 6자리 코드를 확인하는 2단계 인증을 등록합니다. 운영자 계정 하나로 환불·개인정보 내려받기·설정 변경이 열리므로 모든 운영자가 등록합니다." />
    {required
      ? <AdminNotice title="2단계 인증 사용 중" tone="info">지금은 모든 운영자에게 2단계 인증을 요구합니다. 로그인할 때마다 인증 앱 코드를 입력해야 어드민이 열립니다.</AdminNotice>
      : <AdminNotice title="미리 등록해 주세요" tone="warning">아직 2단계 인증을 요구하지 않지만, 곧 켭니다. 켜진 뒤에는 인증 앱 코드 없이는 어드민이 열리지 않으니 지금 등록해 두세요.</AdminNotice>}
    <AdminSectionCard title="인증 앱(OTP)">
      <AdminMySecurity required={required} />
    </AdminSectionCard>
  </div>;
}

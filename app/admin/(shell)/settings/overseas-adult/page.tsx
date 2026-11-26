import { AdminNotice, AdminPageHeader } from '@/components/admin/console/AdminKit';
import { AdminMfaGate } from '@/components/admin/mfa/AdminMfaGate';
import { OverseasAdultConsole } from '@/components/admin/OverseasAdultConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OVERSEAS_ADMIN_PATH } from '@/lib/identity/overseas-adult';
import { createClient } from '@/lib/supabase/server';

export default async function Page() {
  const auth = await requireAdminScreenAccess(OVERSEAS_ADMIN_PATH);
  const client = await createClient();
  const aal = await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel !== 'aal2')
    return <AdminMfaGate email={auth.user.email} next={OVERSEAS_ADMIN_PATH} />;
  const [queue, management] = await Promise.all([
    client.rpc('overseas_review_queue'),
    client.rpc('overseas_adult_management'),
  ]);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminPageHeader title="해외 성인 인증" />
      {queue.error && management.error ? (
        <AdminNotice tone="warning" title="담당자 지정이 필요합니다">
          매니저 관리 권한이 있는 운영자에게 심사자 지정을 요청해 주세요.
        </AdminNotice>
      ) : (
        <OverseasAdultConsole
          queue={queue.error ? null : queue.data}
          management={management.error ? null : management.data}
        />
      )}
    </div>
  );
}

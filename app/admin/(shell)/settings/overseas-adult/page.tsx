import { AdminNotice, AdminPageHeader } from '@/components/admin/console/AdminKit';
import { OverseasAdultConsole } from '@/components/admin/OverseasAdultConsole';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OVERSEAS_ADMIN_PATH } from '@/lib/identity/overseas-adult';
import { createClient } from '@/lib/supabase/server';

export default async function Page() {
  await requireAdminScreenAccess(OVERSEAS_ADMIN_PATH);
  const client = await createClient();
  const queue = await client.rpc('overseas_review_queue');
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <AdminPageHeader title="해외 성인 인증" />
      {queue.error && (
        <AdminNotice tone="warning" title="심사 정보를 불러오지 못했습니다">
          새로고침해 주세요. 문제가 계속되면 관리자 권한이 있는 계정으로 다시 로그인해 주세요.
        </AdminNotice>
      )}
      <OverseasAdultConsole queue={queue.error ? null : queue.data} />
    </div>
  );
}

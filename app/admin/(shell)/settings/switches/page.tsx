import { AdminNotice, AdminPageHeader } from '@/components/admin/console/AdminKit';
import { OperationsSwitchesForm } from '@/components/admin/screens/OperationsSwitchesForm';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { OPERATIONS_SWITCHES_PATH } from '@/lib/admin/operations-switches';
import { loadAdminOperationsSwitches } from '@/lib/admin/operations-switches.server';
import { emailDispatcherFromEnvironment } from '@/lib/email/dispatcher.server';

export default async function Page() {
  await requireAdminScreenAccess(OPERATIONS_SWITCHES_PATH, { adminOnly: true });
  const state = await loadAdminOperationsSwitches();
  return <div className="flex min-w-0 flex-col gap-4">
    <AdminPageHeader title="운영 스위치" description="정책과 계약을 확인한 뒤에 켜는 기능입니다. 켜고 끄는 사람·시각·근거가 감사 기록에 남고, 같은 요청은 한 번만 반영됩니다. 처음에는 모두 꺼져 있습니다." />
    {state ? <OperationsSwitchesForm emailConfigured={Boolean(emailDispatcherFromEnvironment())} initial={state} />
      : <AdminNotice role="alert" title="운영 스위치" tone="danger">현재 설정을 불러오지 못했습니다. 새로고침 후 다시 확인해주세요. 값을 모른 채 저장하지 않도록 이 화면에서는 바꿀 수 없습니다.</AdminNotice>}
  </div>;
}

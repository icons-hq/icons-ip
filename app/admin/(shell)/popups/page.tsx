import { PopupListScreen } from '@/components/admin/screens/PopupListScreen';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminPopups } from '@/lib/admin/popups.server';

/* 온라인 팝업 목록 — 진행 중인 것이 위로 온다. */
export default async function AdminPopupsPage() {
  await requireAdminScreenAccess('/admin/popups');
  const popups = await getAdminPopups();
  return <PopupListScreen popups={popups} />;
}

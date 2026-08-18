import { randomUUID } from 'node:crypto';
import { NotificationSection } from '@/components/admin/sections/NotificationSection';
import { requireAdminScreenAccess } from '@/lib/admin/guard.server';
import { getAdminNotificationConsoleData } from '@/lib/admin/notifications.server';

export default async function AdminMessagingNotificationsPage() {
  await requireAdminScreenAccess('/admin/messaging/notifications');

  const data = await getAdminNotificationConsoleData();

  /* 발송 멱등키는 요청마다 새로 만든다 — 새로고침이 같은 공지를 두 번 보내지 않는다. */
  return <NotificationSection data={data} operationId={randomUUID()} />;
}

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Notifications } from '@/components/screens/Notifications';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { loadNotifications } from '@/lib/notifications.server';
import { openNotificationAction } from './actions';

const NOTIFICATIONS_PATH = '/notifications';

export const metadata: Metadata = {
  title: '알림함 — ICONS',
  description: '주문, 카드팩, 팔로우한 IP의 인앱 알림을 확인하세요.',
  robots: { index: false, follow: false },
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(NOTIFICATIONS_PATH)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(NOTIFICATIONS_PATH));
  }

  const [notifications, query] = await Promise.all([
    loadNotifications(auth.user.id),
    searchParams ?? Promise.resolve<Record<string, string | string[] | undefined>>({}),
  ]);

  return (
    <Notifications
      error={firstParam(query.open_error) === '1'}
      notifications={notifications}
      openAction={openNotificationAction}
    />
  );
}

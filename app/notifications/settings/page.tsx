import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { setIpNotificationPreferencesAction } from '@/app/ip/actions';
import { NotificationSettings } from '@/components/screens/NotificationSettings';
import { isOnboarded, onboardingPath } from '@/lib/auth/onboarding';
import { getCurrentAuthState } from '@/lib/auth/server';
import { getStorefrontIpsByIds } from '@/lib/storefront.server';
import { getIpNotificationPreferencesForUser } from '@/lib/ip-follow.server';

const SETTINGS_PATH = '/notifications/settings';

export const metadata: Metadata = {
  title: 'IP 알림 설정 — ICONS',
  description: '팔로우한 IP의 새 굿즈·드롭과 팝업·이벤트 인앱 알림을 설정하세요.',
  robots: { index: false, follow: false },
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const auth = await getCurrentAuthState();
  if (!auth.user) redirect(`/login?next=${encodeURIComponent(SETTINGS_PATH)}`);
  if (!isOnboarded(auth.profile, auth.user.email)) {
    redirect(onboardingPath(SETTINGS_PATH));
  }

  const [rows, query] = await Promise.all([
    getIpNotificationPreferencesForUser(auth.user.id),
    searchParams,
  ]);
  /* 이름이 필요한 것은 **이 사람이 가진 행**뿐이다 — 카탈로그 전량을 읽을 이유가 없다. */
  const ips = await getStorefrontIpsByIds(rows.map((row) => row.ipId));
  const titles = new Map(ips.map((ip) => [ip.id, ip.title]));
  const preferences = rows.map((row) => ({
    ...row,
    title: titles.get(row.ipId) ?? row.ipId,
  }));

  return (
    <NotificationSettings
      action={setIpNotificationPreferencesAction}
      error={firstParam(query.notification_error) === '1'}
      preferences={preferences}
      saved={firstParam(query.notification_saved) === '1'}
    />
  );
}

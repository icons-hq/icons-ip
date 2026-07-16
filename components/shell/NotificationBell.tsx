'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { Icon } from '@/components/ui/Icon';
import { hrefFor, isActive } from '@/lib/routes';
import { createClient } from '@/lib/supabase/client';
import { useAuthPresence, type AuthPresence } from './AuthPresenceProvider';

type UnreadCountClient = Pick<ReturnType<typeof createClient>, 'from'>;

export type NotificationCountState =
  | { status: 'loading' }
  | { status: 'ready'; count: number }
  | { status: 'error' };

export function notificationNavigationKey(pathname: string, openSignal: string | null) {
  return openSignal ? `${pathname}?notification_opened=${openSignal}` : pathname;
}

export async function loadUnreadNotificationCount(
  client: UnreadCountClient,
): Promise<number> {
  const { count, error } = await client
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);

  if (error || typeof count !== 'number') {
    throw new Error('Failed to load unread notification count');
  }
  return count;
}

function bellLabel(state: NotificationCountState) {
  if (state.status === 'loading') return '알림함, 안 읽은 알림 수 확인 중';
  if (state.status === 'error') return '알림함, 안 읽은 알림 수를 확인하지 못했습니다';
  return state.count > 0
    ? `알림함, 안 읽은 알림 ${state.count}개`
    : '알림함, 안 읽은 알림 없음';
}

export function NotificationBellView({
  countState,
  pathname,
  presence,
}: {
  countState: NotificationCountState;
  pathname: string;
  presence: AuthPresence;
}) {
  if (presence === 'unknown') {
    return (
      <span
        aria-busy="true"
        aria-label="알림 로그인 상태 확인 중"
        className="notification-bell-placeholder"
      />
    );
  }
  if (presence === 'signed-out') return null;

  const active = isActive('notifications', pathname);
  return (
    <Link
      aria-current={active ? 'page' : undefined}
      aria-label={bellLabel(countState)}
      className={`icon-btn notification-bell${active ? ' active' : ''}`}
      href={hrefFor('notifications')}
      title="알림함"
    >
      <Icon name="bell" />
      {countState.status === 'ready' && countState.count > 0 && (
        <span aria-hidden className="badge">
          {countState.count > 99 ? '99+' : countState.count}
        </span>
      )}
      {countState.status === 'error' && (
        <span aria-hidden className="notification-bell-error">!</span>
      )}
    </Link>
  );
}

function SignedInNotificationBell({
  navigationKey,
  pathname,
}: {
  navigationKey: string;
  pathname: string;
}) {
  const [countState, setCountState] = useState<NotificationCountState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void loadUnreadNotificationCount(createClient()).then(
      (count) => {
        if (active) setCountState({ status: 'ready', count });
      },
      () => {
        if (active) setCountState({ status: 'error' });
      },
    );
    return () => {
      active = false;
    };
  }, [navigationKey]);

  return (
    <NotificationBellView
      countState={countState}
      pathname={pathname}
      presence="signed-in"
    />
  );
}

function NotificationBellContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const presence = useAuthPresence();
  const navigationKey = notificationNavigationKey(
    pathname,
    searchParams.get('notification_opened'),
  );

  if (presence === 'signed-in') {
    return (
      <SignedInNotificationBell
        key={navigationKey}
        navigationKey={navigationKey}
        pathname={pathname}
      />
    );
  }
  return (
    <NotificationBellView
      countState={{ status: 'loading' }}
      pathname={pathname}
      presence={presence}
    />
  );
}

export function NotificationBell() {
  return (
    <Suspense
      fallback={(
        <span
          aria-busy="true"
          aria-label="알림 로그인 상태 확인 중"
          className="notification-bell-placeholder"
        />
      )}
    >
      <NotificationBellContent />
    </Suspense>
  );
}

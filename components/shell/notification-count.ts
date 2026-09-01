import type { createClient } from '@/lib/supabase/client';

/* 안 읽은 알림 수만 필요한 표면이 공유하는 조회 계약.
   Supabase 클라이언트를 인자로 받는 이유는 테스트에서 가짜 클라이언트를 꽂기 위해서다 —
   모듈 안에서 createClient()를 부르면 조회 경로를 갈아끼울 자리가 사라진다. */
type UnreadCountClient = Pick<ReturnType<typeof createClient>, 'from'>;

/* 알림함을 다녀와도 pathname은 그대로라 재조회가 걸리지 않는다.
   열람 신호(notification_opened)까지 키에 넣어야 "읽고 돌아온 순간"이 새 키가 된다. */
export function notificationNavigationKey(pathname: string, openSignal: string | null) {
  return openSignal ? `${pathname}?notification_opened=${openSignal}` : pathname;
}

/* head + count: 'exact'라 행을 실어 오지 않는다 — 셸은 배지 숫자 하나만 쓴다.
   count가 숫자가 아니면(RLS 거부·네트워크 실패 등) 0으로 뭉개지 않고 throw 한다.
   0건과 "못 셌다"를 호출부가 구분해서 표시할 수 있어야 하기 때문이다. */
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

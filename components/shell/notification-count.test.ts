import { describe, expect, it } from 'vitest';
import { loadUnreadNotificationCount, notificationNavigationKey } from './notification-count';

/* NotificationBell 삭제(S9)와 함께 이 모듈로 이사한 계약의 재봉인.
   구 NotificationBell.test 가 지키던 두 가지 — 열람 신호가 재조회 키를 바꾼다,
   조회 실패는 0으로 뭉개지 않는다 — 를 이 자리에서 계속 고정한다. */

/* 계약이 쓰는 체인(from→select→is)만 흉내 낸다 — 진짜 빌더 형태는 계약 밖이라
   loadUnreadNotificationCount 의 인자 타입으로 눌러 끼운다. */
type UnreadCountClient = Parameters<typeof loadUnreadNotificationCount>[0];

function fakeClient(result: { count: number | null; error: { message: string } | null }) {
  const calls: Array<{ table: string; column: string; options: unknown; filter: [string, unknown] }> = [];
  const client = {
    from(table: string) {
      return {
        select(column: string, options: unknown) {
          return {
            is(filterColumn: string, filterValue: unknown) {
              calls.push({ table, column, options, filter: [filterColumn, filterValue] });
              return Promise.resolve(result);
            },
          };
        },
      };
    },
  };
  return { calls, client: client as unknown as UnreadCountClient };
}

describe('notificationNavigationKey', () => {
  it('알림함을 다녀온 열람 신호가 같은 pathname 을 새 키로 바꾼다', () => {
    expect(notificationNavigationKey('/shop', null)).toBe('/shop');
    expect(notificationNavigationKey('/shop', '1725')).toBe('/shop?notification_opened=1725');
    expect(notificationNavigationKey('/shop', '1725')).not.toBe(notificationNavigationKey('/shop', null));
  });
});

describe('loadUnreadNotificationCount', () => {
  it('read_at 이 비어 있는 행만 head+exact 로 센다', async () => {
    const { calls, client } = fakeClient({ count: 3, error: null });
    await expect(loadUnreadNotificationCount(client)).resolves.toBe(3);

    const call = calls[0];
    expect(call.table).toBe('notifications');
    expect(call.options).toMatchObject({ count: 'exact', head: true });
    expect(call.filter).toEqual(['read_at', null]);
  });

  it('조회 실패를 0으로 뭉개지 않고 throw 한다 — 0건과 "못 셌다"는 다른 표시다', async () => {
    const failed = fakeClient({ count: null, error: { message: 'rls denied' } });
    await expect(loadUnreadNotificationCount(failed.client)).rejects.toThrow();

    const missingCount = fakeClient({ count: null, error: null });
    await expect(loadUnreadNotificationCount(missingCount.client)).rejects.toThrow();
  });
});

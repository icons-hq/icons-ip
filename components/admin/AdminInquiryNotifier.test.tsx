import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InquiryRealtimeClient } from '@/lib/inquiry-realtime';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/admin' }));

import {
  INQUIRY_NOTIFICATION_DENIED,
  InquiryNotificationSettingsView,
  acquireInquiryNotifierLeadership,
  claimInquiryNotification,
  enableInquiryNotifications,
  inquiryNotificationsEnabled,
  setInquiryNotificationsEnabled,
  startInquiryNotifier,
  titleWithInquiryCount,
} from './AdminInquiryNotifier';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); }, data };
}

function transport() {
  const handlers: { type: string; filter: Record<string, string>; callback: (value: unknown) => void }[] = [];
  const channel = {
    on: (type: string, filter: Record<string, string>, callback: (value: unknown) => void) => { handlers.push({ type, filter, callback }); return channel; },
    subscribe: () => channel,
  };
  const removeChannel = vi.fn();
  const thread = (event: 'INSERT' | 'UPDATE', row: Record<string, unknown>) =>
    handlers.find((handler) => handler.filter.table === 'inquiries' && handler.filter.event === event)!.callback({ new: row });
  const ready = () => handlers.find((handler) => handler.type === 'system')?.callback({ extension: 'postgres_changes', status: 'ok' });
  return { thread, ready, removeChannel, client: { channel: () => channel, removeChannel } as unknown as InquiryRealtimeClient };
}

async function settle() { for (let index = 0; index < 10; index++) await Promise.resolve(); }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('탭 제목 미답변 수 접두 (R2)', () => {
  it('붙이고 바꾸고 0이면 떼며, 메타데이터가 덮어쓴 제목에도 한 번만 붙인다', () => {
    expect(titleWithInquiryCount('판매자센터', 3)).toBe('(3) 판매자센터');
    expect(titleWithInquiryCount('(3) 판매자센터', 5)).toBe('(5) 판매자센터');
    expect(titleWithInquiryCount('(5) 판매자센터', 0)).toBe('판매자센터');
    expect(titleWithInquiryCount('(5) 판매자센터', null)).toBe('판매자센터');
    expect(titleWithInquiryCount('판매자센터', 120)).toBe('(99+) 판매자센터');
    expect(titleWithInquiryCount('(99+) 판매자센터', 2)).toBe('(2) 판매자센터');
  });
});

describe('계정·기기별 켜짐 저장 (R2)', () => {
  it('계정마다 따로 켜고 끄며, 저장소가 막혀도 오류 없이 꺼짐으로 본다', () => {
    const storage = memoryStorage();
    expect(inquiryNotificationsEnabled('a', storage)).toBe(false);
    expect(setInquiryNotificationsEnabled('a', true, storage)).toBe(true);
    expect(inquiryNotificationsEnabled('a', storage)).toBe(true);
    expect(inquiryNotificationsEnabled('b', storage)).toBe(false);
    setInquiryNotificationsEnabled('a', false, storage);
    expect(inquiryNotificationsEnabled('a', storage)).toBe(false);
    const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
    expect(inquiryNotificationsEnabled('a', blocked)).toBe(false);
    expect(setInquiryNotificationsEnabled('a', true, blocked)).toBe(false);
    expect(inquiryNotificationsEnabled('', storage)).toBe(false);
  });

  it('같은 문의는 탭이 여럿이어도 한 번만 알림 차례를 얻는다', () => {
    const storage = memoryStorage();
    expect(claimInquiryNotification('a', 'q1', storage)).toBe(true);
    expect(claimInquiryNotification('a', 'q1', storage)).toBe(false);
    expect(claimInquiryNotification('b', 'q1', storage)).toBe(true);
    storage.setItem('icons:admin:inquiry-notified:v1:a', '{broken');
    expect(claimInquiryNotification('a', 'q2', storage)).toBe(true);
  });
});

describe('브라우저 권한 요청 (R2)', () => {
  it('허용하면 켜고, 거부·미지원이면 켜지 않고 안내 상태를 돌려준다', async () => {
    const storage = memoryStorage();
    const granted = { permission: 'default' as NotificationPermission, requestPermission: vi.fn(async () => 'granted' as NotificationPermission) };
    expect(await enableInquiryNotifications('a', granted, storage)).toBe('granted');
    expect(inquiryNotificationsEnabled('a', storage)).toBe(true);
    const denied = { permission: 'default' as NotificationPermission, requestPermission: vi.fn(async () => 'denied' as NotificationPermission) };
    expect(await enableInquiryNotifications('b', denied, storage)).toBe('denied');
    expect(inquiryNotificationsEnabled('b', storage)).toBe(false);
    const blocked = { permission: 'denied' as NotificationPermission, requestPermission: vi.fn() };
    expect(await enableInquiryNotifications('c', blocked, storage)).toBe('denied');
    expect(blocked.requestPermission).not.toHaveBeenCalled();
    expect(await enableInquiryNotifications('d', undefined, storage)).toBe('unsupported');
  });

  it('설정 화면은 확정 문구로 켜기·끄기와 차단·미지원 안내만 보인다', () => {
    const view = (props: Partial<Parameters<typeof InquiryNotificationSettingsView>[0]>) => renderToStaticMarkup(<InquiryNotificationSettingsView support="default" enabled={false} message="" busy={false} onEnable={vi.fn()} onDisable={vi.fn()} {...props} />);
    expect(view({})).toContain('>문의 알림 받기</button>');
    expect(view({ support: 'granted', enabled: true })).toContain('>문의 알림 끄기</button>');
    expect(view({ support: 'denied' })).toContain(INQUIRY_NOTIFICATION_DENIED);
    const unsupported = view({ support: 'unsupported' });
    expect(unsupported).toContain('이 브라우저는 알림을 지원하지 않습니다');
    expect(unsupported).toMatch(/<button[^>]*disabled=""[^>]*>문의 알림 받기<\/button>/);
  });
});

describe('새 문의 알림 엔진 (R2)', () => {
  function engine(options: { leader?: boolean; claim?: (id: string) => boolean; since?: { id: string; title: string; createdAt: string }[][] } = {}) {
    const test = transport();
    const notify = vi.fn(); const onCount = vi.fn();
    const pages = [...(options.since ?? [[{ id: 'old', title: '기존', createdAt: '2026-10-28T00:00:00Z' }]])];
    const loadSince = vi.fn(async () => pages.shift() ?? []);
    const loadOpenCount = vi.fn(async () => 4);
    const stop = startInquiryNotifier({
      realtime: test.client, loadOpenCount, loadSince, notify, onCount, claim: options.claim ?? (() => true),
      leader: (onLead) => { if (options.leader !== false) onLead(); return () => {}; },
    });
    return { test, notify, onCount, loadSince, loadOpenCount, stop };
  }

  it('리더 탭은 새 문의(INSERT)마다 한 번 알리고, 상태 변경(UPDATE)에는 알리지 않는다', async () => {
    vi.useFakeTimers();
    const run = engine();
    await settle();
    expect(run.loadSince).toHaveBeenCalledWith(null);
    run.test.thread('INSERT', { id: 'q1', title: '배송 문의' });
    run.test.thread('INSERT', { id: 'q1', title: '배송 문의' });
    run.test.thread('UPDATE', { id: 'q2', title: '답변 완료' });
    expect(run.notify).toHaveBeenCalledTimes(1);
    expect(run.notify).toHaveBeenCalledWith({ id: 'q1', title: '배송 문의' });
    run.stop();
  });

  it('다른 탭이 먼저 알림 차례를 가져가면 이 탭은 알리지 않는다', async () => {
    const run = engine({ claim: () => false });
    await settle();
    run.test.thread('INSERT', { id: 'q1', title: '배송 문의' });
    expect(run.notify).not.toHaveBeenCalled();
    run.stop();
  });

  it('리더가 아닌 탭은 알리지 않지만 탭 제목용 미답변 수는 갱신한다', async () => {
    vi.useFakeTimers();
    const run = engine({ leader: false });
    await settle();
    expect(run.onCount).toHaveBeenCalledWith(4);
    run.test.thread('INSERT', { id: 'q1', title: '배송 문의' });
    vi.advanceTimersByTime(1000); await settle();
    expect(run.notify).not.toHaveBeenCalled();
    expect(run.loadOpenCount).toHaveBeenCalledTimes(2);
    run.stop();
  });

  it('실시간 연결이 끊긴 사이 들어온 문의는 1분 주기 확인으로 알리고, 이미 알린 문의는 다시 알리지 않는다', async () => {
    vi.useFakeTimers();
    const run = engine({ since: [
      [{ id: 'old', title: '기존', createdAt: '2026-10-28T00:00:00Z' }],
      [{ id: 'q1', title: '실시간으로 받은 문의', createdAt: '2026-10-28T00:01:00Z' }, { id: 'q2', title: '놓친 문의', createdAt: '2026-10-28T00:02:00Z' }],
    ] });
    await settle();
    run.test.thread('INSERT', { id: 'q1', title: '실시간으로 받은 문의' });
    vi.advanceTimersByTime(60_000); await settle();
    expect(run.loadSince).toHaveBeenLastCalledWith('2026-10-28T00:00:00Z');
    expect(run.notify.mock.calls.map(([inquiry]) => inquiry.id)).toEqual(['q1', 'q2']);
    expect(run.notify).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'old' }));
    run.stop();
    vi.advanceTimersByTime(120_000); await settle();
    expect(run.test.removeChannel).toHaveBeenCalledOnce();
    expect(run.loadSince).toHaveBeenCalledTimes(2);
  });
});

describe('탭 간 리더 선출 (R2)', () => {
  it('Web Locks가 있으면 잠금을 얻은 탭만 리더가 되고, 없으면 바로 리더가 된다(알림 tag·차례 기록으로 중복 방지)', async () => {
    const onLead = vi.fn();
    let grant: (() => Promise<void>) | undefined;
    const locks = { request: vi.fn((_name: string, _options: unknown, callback: () => Promise<void>) => { grant = callback; return new Promise<void>(() => {}); }) };
    const release = acquireInquiryNotifierLeadership('acc', onLead, locks as unknown as LockManager);
    expect(onLead).not.toHaveBeenCalled();
    void grant!();
    expect(onLead).toHaveBeenCalledOnce();
    release();
    const fallback = vi.fn();
    acquireInquiryNotifierLeadership('acc', fallback, null);
    expect(fallback).toHaveBeenCalledOnce();
  });
});

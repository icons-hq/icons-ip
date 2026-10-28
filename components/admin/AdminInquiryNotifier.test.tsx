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
  readInquiryNotifierCursor,
  setInquiryNotificationsEnabled,
  startInquiryNotifier,
  titleWithInquiryCount,
  writeInquiryNotifierCursor,
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

describe('리더 교대 (R2)', () => {
  const OLD = { id: 'old', title: '기존', createdAt: '2026-10-28T00:00:00Z' };
  const Q1 = { id: 'q1', title: '새 문의', createdAt: '2026-10-28T00:01:00Z' };
  function tab(storage: ReturnType<typeof memoryStorage>, loadSince: (cursor: string | null) => Promise<typeof OLD[]>, now = () => Date.parse('2026-10-28T00:01:30Z')) {
    const test = transport();
    const notify = vi.fn();
    let becomeLeader: (() => void) | undefined;
    const stop = startInquiryNotifier({
      realtime: test.client, loadOpenCount: async () => 1, loadSince: vi.fn(loadSince), notify, onCount: vi.fn(),
      claim: (id) => claimInquiryNotification('acc', id, storage),
      cursor: { read: () => readInquiryNotifierCursor('acc', storage, now()), write: (value) => writeInquiryNotifierCursor('acc', value, storage, now()) },
      leader: (onLead) => { becomeLeader = onLead; return () => {}; },
    });
    return { test, notify, stop, lead: () => becomeLeader!() };
  }

  /* 리더 A가 실시간 연결이 끊긴 채 1분 확인 전에 닫히면, 그 사이 팔로워 B만 받은 새 문의를 B가 '최근 1건'
     기준점으로 삼아 영영 알리지 않았다. 새 리더는 이전 리더가 남긴 공유 기준점부터 확인한다. */
  it('새 리더는 이전 리더가 남긴 기준점부터 확인해, 리더가 놓치고 닫힌 새 문의를 알린다', async () => {
    const storage = memoryStorage();
    const a = tab(storage, async (cursor) => cursor === null ? [OLD] : []);
    a.lead(); await settle();
    const bLoad = vi.fn(async (cursor: string | null) => cursor === null ? [Q1] : cursor === OLD.createdAt ? [Q1] : []);
    const b = tab(storage, bLoad);
    await settle();
    b.test.thread('INSERT', { id: Q1.id, title: Q1.title });
    expect(b.notify).not.toHaveBeenCalled();
    a.stop();
    b.lead(); await settle();
    expect(bLoad).not.toHaveBeenCalledWith(null);
    expect(bLoad).toHaveBeenCalledWith(OLD.createdAt);
    expect(b.notify).toHaveBeenCalledOnce();
    expect(b.notify).toHaveBeenCalledWith(expect.objectContaining({ id: Q1.id, title: Q1.title }));
    b.stop();
  });

  it('이전 리더가 이미 알린 문의는 새 리더가 다시 알리지 않는다', async () => {
    const storage = memoryStorage();
    const a = tab(storage, async (cursor) => cursor === null ? [OLD] : []);
    a.lead(); await settle();
    a.test.thread('INSERT', { id: Q1.id, title: Q1.title });
    expect(a.notify).toHaveBeenCalledOnce();
    a.stop();
    const b = tab(storage, async (cursor) => cursor === OLD.createdAt ? [Q1] : []);
    b.lead(); await settle();
    expect(b.notify).not.toHaveBeenCalled();
    b.stop();
  });

  /* 탭을 모두 닫았다가 다음 날 다시 열면 밤새 들어온 문의를 한꺼번에 알리지 않는다(Web Push 아님). */
  it('오래된 기준점(리더가 5분 넘게 확인하지 않음)은 버리고 최근 1건을 새 기준점으로 삼는다', async () => {
    const storage = memoryStorage();
    writeInquiryNotifierCursor('acc', OLD.createdAt, storage, Date.parse('2026-10-28T00:00:00Z'));
    expect(readInquiryNotifierCursor('acc', storage, Date.parse('2026-10-28T00:04:59Z'))).toBe(OLD.createdAt);
    expect(readInquiryNotifierCursor('acc', storage, Date.parse('2026-10-28T00:05:01Z'))).toBeNull();
    expect(readInquiryNotifierCursor('other', storage, Date.parse('2026-10-28T00:01:00Z'))).toBeNull();
    const load = vi.fn(async (cursor: string | null) => cursor === null ? [Q1] : [OLD, Q1]);
    const next = tab(storage, load, () => Date.parse('2026-10-29T09:00:00Z'));
    next.lead(); await settle();
    expect(load).toHaveBeenCalledWith(null);
    expect(next.notify).not.toHaveBeenCalled();
    next.stop();
    storage.setItem('icons:admin:inquiry-notifier-cursor:v1:acc', '{broken');
    expect(readInquiryNotifierCursor('acc', storage, Date.parse('2026-10-29T09:00:00Z'))).toBeNull();
    expect(readInquiryNotifierCursor('acc', null)).toBeNull();
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

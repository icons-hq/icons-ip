'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { observeInquiryChanges, type InquiryRealtimeClient } from '@/lib/inquiry-realtime';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';

/*
 * 새 1:1 문의 PC 브라우저 알림(R2, 10/27 회의 D2①).
 *
 * - 커머스 콘솔에서 cs.manage 운영자에게만 셸이 상시 마운트한다(화면마다 다시 마운트되는 children 밖).
 *   운영자가 업무 도구 '알림'에서 '문의 알림 받기'를 눌러 브라우저 권한을 허용해야 켜진다.
 *   켜짐은 계정·기기별(localStorage, 키에 계정 id)로 저장한다. 탭을 모두 닫으면 알림이 오지 않는다(Web Push 아님).
 * - 원천: Realtime `inquiries` INSERT(즉시, 문의 제목을 알림 본문으로). Realtime은 배경 탭 타이머 제한·재연결
 *   사이에 이벤트를 놓칠 수 있어, 리더 탭이 1분마다 마지막으로 본 접수 시각 이후 문의를 다시 확인한다.
 *   그 기준점은 계정별로 공유(localStorage)한다. 리더가 확인 전에 닫혀도 다음 리더가 이어서 확인해야
 *   팔로워 탭만 받았던 새 문의가 빠지지 않는다. 5분 넘게 갱신되지 않은 기준점(탭을 모두 닫았던 경우)은
 *   버리고 최근 1건부터 다시 센다 — 밤새 쌓인 문의를 한꺼번에 알리지 않는다.
 * - 중복 방지: Web Locks로 한 탭만 리더(알림 담당)가 되고, 탭 간 '알림 차례' 기록(localStorage)과
 *   Notification tag(문의 id)로 같은 문의는 한 번만 알린다.
 * - 알림을 누르면 그 탭이 앞으로 오고 문의 상세(/admin/cs/inquiries/<id>)로 이동한다.
 * - 켜져 있는 동안 모든 탭의 제목 앞에 미답변 1:1 문의 수 `(N)`을 붙인다. Next 메타데이터가 이동 때 제목을
 *   다시 쓰므로 pathname 변경과 <title> 변경을 감지해 다시 붙인다.
 * - 권한 거부·미지원 브라우저는 안내만 한다. 알림은 포커스를 빼앗지 않아 입력·IME를 방해하지 않는다.
 */

export const INQUIRY_NOTIFICATION_TITLE = '새 1:1 문의';
export const INQUIRY_NOTIFICATION_DENIED = '브라우저에서 알림이 차단되어 있습니다. 주소창의 사이트 설정에서 알림을 허용하세요.';
const INQUIRY_NOTIFICATION_UNSUPPORTED = '이 브라우저는 알림을 지원하지 않습니다. 크롬·엣지·사파리 최신 버전에서 켜 주세요.';
const PREFERENCE_PREFIX = 'icons:admin:inquiry-notifications:v1:';
const CLAIM_PREFIX = 'icons:admin:inquiry-notified:v1:';
const CURSOR_PREFIX = 'icons:admin:inquiry-notifier-cursor:v1:';
const CHANGE_EVENT = 'icons:admin:inquiry-notifications:change';
const CATCH_UP_MS = 60_000;
const COUNT_DEBOUNCE_MS = 1_000;
const CURSOR_FRESH_MS = 5 * 60_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type NotificationLike = { permission: NotificationPermission; requestPermission: () => Promise<NotificationPermission> };
export type InquiryNotificationSupport = 'unsupported' | NotificationPermission;
export interface NewInquiry { id: string; title: string }

function browserStorage(): StorageLike | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}
function browserNotification(): NotificationLike | undefined {
  return typeof window === 'undefined' || typeof window.Notification === 'undefined' ? undefined : window.Notification;
}

export function inquiryNotificationsEnabled(accountId: string, storage: StorageLike | null = browserStorage()): boolean {
  if (!accountId || !storage) return false;
  try { return storage.getItem(`${PREFERENCE_PREFIX}${accountId}`) === 'on'; } catch { return false; }
}

export function setInquiryNotificationsEnabled(accountId: string, enabled: boolean, storage: StorageLike | null = browserStorage()): boolean {
  if (!accountId || !storage) return false;
  try {
    if (enabled) storage.setItem(`${PREFERENCE_PREFIX}${accountId}`, 'on');
    else storage.removeItem(`${PREFERENCE_PREFIX}${accountId}`);
  } catch { return false; }
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

function subscribePreference(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener(CHANGE_EVENT, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(CHANGE_EVENT, callback); };
}

export function useInquiryNotificationsEnabled(accountId: string): boolean {
  return useSyncExternalStore(subscribePreference, () => inquiryNotificationsEnabled(accountId), () => false);
}

export function inquiryNotificationSupport(notification: NotificationLike | undefined = browserNotification()): InquiryNotificationSupport {
  return notification ? notification.permission : 'unsupported';
}

/** 클릭(사용자 동작) 안에서 부른다. 허용되면 켜고, 아니면 이유를 돌려준다. */
export async function enableInquiryNotifications(accountId: string, notification: NotificationLike | undefined = browserNotification(),
  storage: StorageLike | null = browserStorage()): Promise<InquiryNotificationSupport | 'storage_unavailable'> {
  if (!notification) return 'unsupported';
  let permission = notification.permission;
  if (permission === 'default') {
    try { permission = await notification.requestPermission(); } catch { permission = notification.permission; }
  }
  if (permission !== 'granted') return permission;
  return setInquiryNotificationsEnabled(accountId, true, storage) ? 'granted' : 'storage_unavailable';
}

/** 같은 문의는 계정의 모든 탭을 통틀어 한 번만 알린다. 기록을 못 읽으면 알린다(누락보다 중복이 낫다, tag가 OS에서 합친다). */
export function claimInquiryNotification(accountId: string, inquiryId: string, storage: StorageLike | null = browserStorage()): boolean {
  if (!storage) return true;
  const key = `${CLAIM_PREFIX}${accountId}`;
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    ids = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch { ids = []; }
  if (ids.includes(inquiryId)) return false;
  try { storage.setItem(key, JSON.stringify([...ids, inquiryId].slice(-100))); } catch { /* tag still dedupes. */ }
  return true;
}

/** 리더가 마지막으로 확인한 접수 시각. 리더가 1분마다 다시 쓰므로 5분 넘게 묵은 값은 살아 있는 리더가 없었다는 뜻이다. */
export function readInquiryNotifierCursor(accountId: string, storage: StorageLike | null = browserStorage(), now = Date.now()): string | null {
  if (!accountId || !storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${CURSOR_PREFIX}${accountId}`) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { cursor, savedAt } = parsed as { cursor?: unknown; savedAt?: unknown };
    if (typeof cursor !== 'string' || !cursor || typeof savedAt !== 'number') return null;
    return now - savedAt <= CURSOR_FRESH_MS ? cursor : null;
  } catch { return null; }
}

export function writeInquiryNotifierCursor(accountId: string, cursor: string, storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  if (!accountId || !storage) return;
  try { storage.setItem(`${CURSOR_PREFIX}${accountId}`, JSON.stringify({ cursor, savedAt: now })); } catch { /* This tab still keeps its own cursor. */ }
}

export function titleWithInquiryCount(title: string, count: number | null): string {
  const base = title.replace(/^\(\d+\+?\) /, '');
  return count && count > 0 ? `(${count > 99 ? '99+' : count}) ${base}` : base;
}

/** 한 탭만 알림을 맡는다. Web Locks가 없으면 모든 탭이 리더가 되고, 차례 기록·tag가 중복을 막는다. */
export function acquireInquiryNotifierLeadership(accountId: string, onLead: () => void,
  locks: LockManager | null = typeof navigator === 'undefined' ? null : navigator.locks ?? null): () => void {
  if (!locks?.request) { onLead(); return () => {}; }
  const controller = new AbortController();
  let release: (() => void) | undefined;
  locks.request(`icons:admin:inquiry-notifier:${accountId}`, { signal: controller.signal },
    () => new Promise<void>((resolve) => { release = resolve; onLead(); })).catch(() => { /* Aborted while waiting. */ });
  return () => { controller.abort(); release?.(); };
}

export function startInquiryNotifier(options: {
  realtime: InquiryRealtimeClient;
  loadOpenCount: () => Promise<number | null>;
  /** cursor가 null이면 가장 최근 문의 1건(기준점), 아니면 그 접수 시각 이후 문의를 오래된 순으로. 실패하면 null. */
  loadSince: (cursor: string | null) => Promise<(NewInquiry & { createdAt: string })[] | null>;
  notify: (inquiry: NewInquiry) => void;
  onCount: (count: number | null) => void;
  claim: (inquiryId: string) => boolean;
  leader: (onLead: () => void) => () => void;
  /** 탭 간 공유 기준점. 새 리더는 여기서부터 확인하고, 리더는 확인할 때마다 갱신한다. */
  cursor?: { read: () => string | null; write: (cursor: string) => void };
}): () => void {
  let active = true, leading = false, baseline = false, checking = false;
  let cursor: string | null = null;
  let countTimer: ReturnType<typeof setTimeout> | undefined;
  const seen = new Set<string>();
  const refreshCount = () => { void options.loadOpenCount().then((count) => { if (active) options.onCount(count); }, () => {}); };
  const scheduleCount = () => {
    if (countTimer) return;
    countTimer = setTimeout(() => { countTimer = undefined; refreshCount(); }, COUNT_DEBOUNCE_MS);
  };
  const announce = (inquiry: NewInquiry) => {
    if (!active || !leading || seen.has(inquiry.id)) return;
    seen.add(inquiry.id);
    if (options.claim(inquiry.id)) options.notify(inquiry);
  };
  const catchUp = async () => {
    if (!active || !leading || checking) return;
    checking = true;
    try {
      if (!baseline) {
        const shared = options.cursor?.read() ?? null;
        if (shared) { cursor = shared; baseline = true; }
      }
      const rows = await options.loadSince(baseline ? cursor : null);
      if (!active || !leading || !rows) return;
      if (!baseline) {
        rows.forEach((row) => seen.add(row.id));
        cursor = rows.at(-1)?.createdAt ?? new Date().toISOString();
        baseline = true;
      } else {
        for (const row of rows) { announce(row); cursor = row.createdAt; }
      }
      if (cursor) options.cursor?.write(cursor);
    } catch { /* The next interval retries. */ } finally { checking = false; }
  };
  const stopRealtime = observeInquiryChanges(options.realtime, {
    onChange: (change) => {
      if (change.kind !== 'thread') return;
      scheduleCount();
      if (change.event === 'INSERT') announce({ id: change.inquiryId, title: change.title?.trim() || '고객문의가 접수되었습니다.' });
    },
    onReady: () => { refreshCount(); void catchUp(); },
  });
  const interval = setInterval(() => { refreshCount(); void catchUp(); }, CATCH_UP_MS);
  const stopLeading = options.leader(() => { leading = true; void catchUp(); });
  refreshCount();
  return () => {
    active = false; leading = false;
    clearInterval(interval); clearTimeout(countTimer);
    stopRealtime(); stopLeading();
  };
}

function useNotifierEffect(accountId: string, enabled: boolean, onCount: (count: number | null) => void) {
  const router = useRouter();
  useEffect(() => {
    if (!enabled || !accountId || !getSupabaseConfig().isConfigured || inquiryNotificationSupport() !== 'granted') return;
    const client = createClient();
    return startInquiryNotifier({
      realtime: client,
      loadOpenCount: async () => {
        const { data, error } = await client.rpc('admin_inquiry_status_counts');
        if (error || !Array.isArray(data)) return null;
        const open = (data as { status?: unknown; total?: unknown }[]).find((row) => row.status === 'open');
        const total = Number(open?.total ?? 0);
        return Number.isSafeInteger(total) && total >= 0 ? total : null;
      },
      loadSince: async (cursor) => {
        const query = client.from('inquiries').select('id,title,created_at');
        const { data, error } = cursor
          ? await query.gt('created_at', cursor).order('created_at', { ascending: true }).limit(20)
          : await query.order('created_at', { ascending: false }).limit(1);
        if (error || !Array.isArray(data)) return null;
        return (data as { id?: unknown; title?: unknown; created_at?: unknown }[])
          .filter((row): row is { id: string; title: string; created_at: string } => typeof row.id === 'string' && typeof row.title === 'string' && typeof row.created_at === 'string')
          .map((row) => ({ id: row.id, title: row.title, createdAt: row.created_at }));
      },
      notify: (inquiry) => {
        try {
          const notification = new Notification(INQUIRY_NOTIFICATION_TITLE, { body: inquiry.title, tag: `icons-inquiry:${inquiry.id}` });
          notification.onclick = () => { window.focus(); router.push(`/admin/cs/inquiries/${inquiry.id}`); notification.close(); };
        } catch { /* Permission revoked or OS refused; the title count still shows. */ }
      },
      onCount,
      claim: (inquiryId) => claimInquiryNotification(accountId, inquiryId),
      cursor: { read: () => readInquiryNotifierCursor(accountId), write: (value) => writeInquiryNotifierCursor(accountId, value) },
      leader: (onLead) => acquireInquiryNotifierLeadership(accountId, onLead),
    });
  }, [accountId, enabled, onCount, router]);
}

/** 커머스 콘솔 셸에 상시 마운트한다. 화면은 그리지 않는다(켜고 끄기는 업무 도구 '알림'의 설정). */
export function AdminInquiryNotifier({ accountId }: { accountId: string }) {
  const pathname = usePathname();
  const enabled = useInquiryNotificationsEnabled(accountId);
  const [count, setCount] = useState<number | null>(null);
  useNotifierEffect(accountId, enabled, setCount);
  const value = enabled ? count : null;
  useEffect(() => {
    const apply = () => { const next = titleWithInquiryCount(document.title, value); if (document.title !== next) document.title = next; };
    apply();
    if (value === null || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(apply);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [value, pathname]);
  return null;
}

export function InquiryNotificationSettingsView({ support, enabled, message, busy, onEnable, onDisable }: {
  support: InquiryNotificationSupport; enabled: boolean; message: string; busy: boolean; onEnable: () => void; onDisable: () => void;
}) {
  const on = enabled && support === 'granted';
  const status = support === 'unsupported' ? INQUIRY_NOTIFICATION_UNSUPPORTED
    : support === 'denied' ? INQUIRY_NOTIFICATION_DENIED
    : on ? '켜짐 · 이 기기의 이 계정에서 커머스 콘솔 탭이 하나라도 열려 있으면 새 1:1 문의를 PC 알림으로 알려 드리고, 탭 제목 앞에 미답변 수를 표시합니다. 탭을 모두 닫으면 알림이 오지 않습니다.'
    : '꺼짐 · 켜면 새 1:1 문의가 올 때 PC 알림을 띄웁니다. 알림을 누르면 그 문의가 열립니다.';
  return <section className="admin-operations-settings" aria-label="새 1:1 문의 PC 알림">
    <h3>새 1:1 문의 PC 알림</h3>
    <p>{status}</p>
    {message ? <p role="status">{message}</p> : null}
    <div>{on
      ? <button type="button" disabled={busy} onClick={onDisable}>문의 알림 끄기</button>
      : <button type="button" disabled={busy || support === 'unsupported'} onClick={onEnable}>문의 알림 받기</button>}</div>
  </section>;
}

/** 업무 도구 '알림' 패널에 둔다(패널은 브라우저에서만 그린다). */
export function InquiryNotificationToggle({ accountId }: { accountId: string }) {
  const enabled = useInquiryNotificationsEnabled(accountId);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [, setPermissionCheck] = useState(0);
  const support = inquiryNotificationSupport();
  async function enable() {
    setBusy(true);
    try {
      const result = await enableInquiryNotifications(accountId);
      setMessage(result === 'granted' ? '문의 알림을 켰습니다.' : result === 'denied' ? INQUIRY_NOTIFICATION_DENIED
        : result === 'storage_unavailable' ? '이 브라우저에 설정을 저장할 수 없습니다. 사이트 데이터 저장을 허용한 뒤 다시 켜 주세요.'
        : result === 'unsupported' ? INQUIRY_NOTIFICATION_UNSUPPORTED : '알림 허용 창을 닫았습니다. 다시 누르면 허용 창이 열립니다.');
    } finally { setBusy(false); setPermissionCheck((value) => value + 1); }
  }
  function disable() { setInquiryNotificationsEnabled(accountId, false); setMessage('문의 알림을 껐습니다.'); }
  return <InquiryNotificationSettingsView support={support} enabled={enabled} message={message} busy={busy} onEnable={() => { void enable(); }} onDisable={disable} />;
}

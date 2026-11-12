'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { observeInquiryChanges, type InquiryRealtimeClient } from '@/lib/inquiry-realtime';
import { createClient } from '@/lib/supabase/client';
import { getSupabaseConfig } from '@/lib/supabase/config';
import { startAdminNavigation } from '@/lib/admin/navigation-pending';
import { adminProductQuestionHref, DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS, productQuestionBodyPreview } from '@/lib/admin/product-questions';
import { Button } from '@/components/admin/kit/ui/button';

/*
 * 새 1:1 문의·상품 문의 PC 브라우저 알림(R2, 10/27 회의 D2① · 1027T-002 "현행+상품 Q&A 알림").
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
 * - 상품 문의(굿즈 Q&A, product_questions)도 같은 켜기 설정·같은 리더 탭이 알린다. Realtime 발행 대상이 아니라
 *   30초마다 따라잡기로만 확인한다(기준점·5분 신선도·탭 간 알림 차례는 1:1 문의와 따로 둔다). 알림 본문은 상품명과
 *   질문 앞부분이고, 비밀글은 본문 대신 '비밀글'만 싣는다. 누르면 문의 관리에서 그 상품 문의 상세가 열린다
 *   (/admin/cs/qna?query=<id>&field=id&detail=<id>). Q&A 화면 권한(cs.manage)이 1:1 문의와 같아 마운트 조건은 그대로다.
 * - 켜져 있는 동안 모든 탭의 제목 앞에 미답변 1:1 문의 수 `(N)`을 붙인다. Next 메타데이터가 이동 때 제목을
 *   다시 쓰므로 pathname 변경과 <title> 변경을 감지해 다시 붙인다.
 * - 권한 거부·미지원 브라우저는 안내만 한다. 알림은 포커스를 빼앗지 않아 입력·IME를 방해하지 않는다.
 *   Android Chrome처럼 Notification은 있어도 생성자가 막힌(서비스 워커 알림만 허용) 브라우저도 미지원이다 —
 *   켤 때 시험 알림을 만들어 보고, 실제 알림이 실패해도 끄고 미지원 안내로 바꾼다.
 */

export const INQUIRY_NOTIFICATION_TITLE = '새 1:1 문의';
export const PRODUCT_QUESTION_NOTIFICATION_TITLE = '새 상품 문의';
export const INQUIRY_NOTIFICATION_SETTINGS_TITLE = '새 1:1 문의·상품 문의 PC 알림';
export const INQUIRY_NOTIFICATION_DENIED = '브라우저에서 알림이 차단되어 있습니다. 주소창의 사이트 설정에서 알림을 허용하세요.';
const INQUIRY_NOTIFICATION_ENABLED = '문의 알림을 켰습니다.';
const INQUIRY_NOTIFICATION_UNSUPPORTED = '이 브라우저는 알림을 지원하지 않습니다. 크롬·엣지·사파리 최신 버전에서 켜 주세요.';
const PREFERENCE_PREFIX = 'icons:admin:inquiry-notifications:v1:';
const CLAIM_PREFIX = 'icons:admin:inquiry-notified:v1:';
const CURSOR_PREFIX = 'icons:admin:inquiry-notifier-cursor:v1:';
const QUESTION_CLAIM_PREFIX = 'icons:admin:product-question-notified:v1:';
const QUESTION_CURSOR_PREFIX = 'icons:admin:product-question-notifier-cursor:v1:';
const CHANGE_EVENT = 'icons:admin:inquiry-notifications:change';
const CATCH_UP_MS = 60_000;
/* 상품 문의는 Realtime이 없어 이 확인이 유일한 경로다. '1분 안에' 알리려고 타이머 오차·조회 시간을 넉넉히 둔다
   (배경 탭이 오래 숨겨지면 브라우저가 타이머를 1분 간격으로 묶을 수 있다). */
const QUESTION_CATCH_UP_MS = 30_000;
const COUNT_DEBOUNCE_MS = 1_000;
const CURSOR_FRESH_MS = 5 * 60_000;

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type NotificationLike = Pick<typeof Notification, 'permission' | 'requestPermission'>
  & (new (title: string, options?: NotificationOptions) => Pick<Notification, 'close' | 'onclick'>);
export type InquiryNotificationSupport = 'unsupported' | NotificationPermission;
export interface NewInquiry { id: string; title: string }
export interface NewProductQuestion { id: string; goodName: string | null; body: string; secret: boolean }

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

/** 생성자로 알림을 만들 수 없는 것으로 확인된 브라우저(이 페이지 동안). */
const constructorBlocked = new WeakSet<object>();

export function inquiryNotificationSupport(notification: NotificationLike | undefined = browserNotification()): InquiryNotificationSupport {
  return !notification || constructorBlocked.has(notification) ? 'unsupported' : notification.permission;
}

/* 권한이 없을 때 만든 알림은 표시되지 않는다(오류 이벤트만) — 권한을 묻기 전에 생성자부터 시험한다.
   이미 허용된 상태라면 켜짐 확인 문구로 만들고 바로 닫는다. */
function notificationConstructorWorks(notification: NotificationLike): boolean {
  try {
    new notification(INQUIRY_NOTIFICATION_ENABLED, { silent: true, tag: 'icons-inquiry:enabled' }).close();
    return true;
  } catch { return false; }
}

/** 생성자 알림이 막힌 브라우저로 기록하고 이 계정의 알림을 끈다. 설정 화면은 미지원 안내로 바뀐다. */
export function markInquiryNotificationsUnsupported(accountId: string, notification: NotificationLike | undefined = browserNotification(),
  storage: StorageLike | null = browserStorage()): void {
  if (notification) constructorBlocked.add(notification);
  setInquiryNotificationsEnabled(accountId, false, storage);
}

/** 클릭(사용자 동작) 안에서 부른다. 허용되면 켜고, 아니면 이유를 돌려준다. */
export async function enableInquiryNotifications(accountId: string, notification: NotificationLike | undefined = browserNotification(),
  storage: StorageLike | null = browserStorage()): Promise<InquiryNotificationSupport | 'storage_unavailable'> {
  if (!notification) return 'unsupported';
  if (!notificationConstructorWorks(notification)) {
    constructorBlocked.add(notification);
    return 'unsupported';
  }
  let permission = notification.permission;
  if (permission === 'default') {
    try { permission = await notification.requestPermission(); } catch { permission = notification.permission; }
  }
  if (permission !== 'granted') return permission;
  return setInquiryNotificationsEnabled(accountId, true, storage) ? 'granted' : 'storage_unavailable';
}

/** OS 알림 하나. 누르면 onOpen 후 닫는다. 생성자가 막혀 띄우지 못하면 false. */
function showNotification(title: string, options: { body: string; tag: string }, onOpen: () => void,
  notification: NotificationLike | undefined): boolean {
  if (!notification) return false;
  try {
    const shown = new notification(title, options);
    shown.onclick = () => { onOpen(); shown.close(); };
    return true;
  } catch { return false; }
}

/** 새 문의 OS 알림. 누르면 onOpen 후 닫는다. 생성자가 막혀 띄우지 못하면 false. */
export function showInquiryNotification(inquiry: NewInquiry, onOpen: () => void,
  notification: NotificationLike | undefined = browserNotification()): boolean {
  return showNotification(INQUIRY_NOTIFICATION_TITLE, { body: inquiry.title, tag: `icons-inquiry:${inquiry.id}` }, onOpen, notification);
}

/** 상품 문의 알림 본문. 공개 질문은 상품 상세에 이미 공개된 글이라 앞부분을 싣고, 비밀글은 본문을 싣지 않는다. */
export function productQuestionNotificationBody(question: NewProductQuestion): string {
  const text = question.secret ? '비밀글' : productQuestionBodyPreview(question.body, 60) || '상품 문의가 등록되었습니다.';
  const goodName = question.goodName?.trim();
  return goodName ? `${goodName} · ${text}` : text;
}

/** 새 상품 문의 OS 알림. 1:1 문의와 tag를 나눠 같은 id끼리만 OS에서 합친다. */
export function showProductQuestionNotification(question: NewProductQuestion, onOpen: () => void,
  notification: NotificationLike | undefined = browserNotification()): boolean {
  return showNotification(PRODUCT_QUESTION_NOTIFICATION_TITLE,
    { body: productQuestionNotificationBody(question), tag: `icons-product-question:${question.id}` }, onOpen, notification);
}

/** 알림을 누르면 이 탭을 앞으로 가져와 그 화면으로 옮긴다. 링크가 아닌 이동이라 대기 표시를 직접 건다. */
function openNotifiedHref(href: string, push: (href: string) => void, focus: () => void) {
  focus();
  startAdminNavigation(href);
  push(href);
}

/** 알림을 누르면 이 탭을 앞으로 가져와 문의 상세로 옮긴다. 링크가 아닌 이동이라 대기 표시를 직접 건다. */
export function openNotifiedInquiry(inquiryId: string, push: (href: string) => void, focus: () => void = () => window.focus()) {
  openNotifiedHref(`/admin/cs/inquiries/${inquiryId}`, push, focus);
}

/** 문의 관리(상품 문의)에서 그 문의 하나만 문의번호로 찾아 상세를 연 채로 보인다. */
export function productQuestionNotificationHref(questionId: string): string {
  const list = adminProductQuestionHref(DEFAULT_ADMIN_PRODUCT_QUESTION_FILTERS, { query: questionId, field: 'id' });
  return `${list}&detail=${encodeURIComponent(questionId)}`;
}

export function openNotifiedProductQuestion(questionId: string, push: (href: string) => void, focus: () => void = () => window.focus()) {
  openNotifiedHref(productQuestionNotificationHref(questionId), push, focus);
}

/** 같은 건은 계정의 모든 탭을 통틀어 한 번만 알린다. 기록을 못 읽으면 알린다(누락보다 중복이 낫다, tag가 OS에서 합친다). */
function claimNotification(prefix: string, accountId: string, id: string, storage: StorageLike | null): boolean {
  if (!storage) return true;
  const key = `${prefix}${accountId}`;
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    ids = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch { ids = []; }
  if (ids.includes(id)) return false;
  try { storage.setItem(key, JSON.stringify([...ids, id].slice(-100))); } catch { /* tag still dedupes. */ }
  return true;
}

/** 같은 문의는 계정의 모든 탭을 통틀어 한 번만 알린다. 기록을 못 읽으면 알린다(누락보다 중복이 낫다, tag가 OS에서 합친다). */
export function claimInquiryNotification(accountId: string, inquiryId: string, storage: StorageLike | null = browserStorage()): boolean {
  return claimNotification(CLAIM_PREFIX, accountId, inquiryId, storage);
}

/** 상품 문의의 알림 차례. 1:1 문의 기록과 따로 둬 한쪽이 많아도 다른 쪽 기록을 밀어내지 않는다. */
export function claimProductQuestionNotification(accountId: string, questionId: string, storage: StorageLike | null = browserStorage()): boolean {
  return claimNotification(QUESTION_CLAIM_PREFIX, accountId, questionId, storage);
}

function readCursor(prefix: string, accountId: string, storage: StorageLike | null, now: number): string | null {
  if (!accountId || !storage) return null;
  try {
    const parsed: unknown = JSON.parse(storage.getItem(`${prefix}${accountId}`) ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const { cursor, savedAt } = parsed as { cursor?: unknown; savedAt?: unknown };
    if (typeof cursor !== 'string' || !cursor || typeof savedAt !== 'number') return null;
    return now - savedAt <= CURSOR_FRESH_MS ? cursor : null;
  } catch { return null; }
}

function writeCursor(prefix: string, accountId: string, cursor: string, storage: StorageLike | null, now: number): void {
  if (!accountId || !storage) return;
  try { storage.setItem(`${prefix}${accountId}`, JSON.stringify({ cursor, savedAt: now })); } catch { /* This tab still keeps its own cursor. */ }
}

/** 리더가 마지막으로 확인한 접수 시각. 리더가 1분마다 다시 쓰므로 5분 넘게 묵은 값은 살아 있는 리더가 없었다는 뜻이다. */
export function readInquiryNotifierCursor(accountId: string, storage: StorageLike | null = browserStorage(), now = Date.now()): string | null {
  return readCursor(CURSOR_PREFIX, accountId, storage, now);
}

export function writeInquiryNotifierCursor(accountId: string, cursor: string, storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  writeCursor(CURSOR_PREFIX, accountId, cursor, storage, now);
}

/** 상품 문의 등록 시각 기준점. 리더가 30초마다 갱신하고 5분 신선도는 1:1 문의와 같으며 값만 따로 둔다. */
export function readProductQuestionNotifierCursor(accountId: string, storage: StorageLike | null = browserStorage(), now = Date.now()): string | null {
  return readCursor(QUESTION_CURSOR_PREFIX, accountId, storage, now);
}

export function writeProductQuestionNotifierCursor(accountId: string, cursor: string, storage: StorageLike | null = browserStorage(), now = Date.now()): void {
  writeCursor(QUESTION_CURSOR_PREFIX, accountId, cursor, storage, now);
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

type NotifierCursor = { read: () => string | null; write: (cursor: string) => void };

/*
 * 리더 탭의 따라잡기 한 갈래. 기준점이 없으면(공유 기준점도 5분 넘게 묵었으면) 가장 최근 1건을 기준점으로 삼아
 * 알리지 않고, 그 뒤로는 기준점 이후 건을 오래된 순으로 알리며 기준점을 옮긴다. 1:1 문의와 상품 문의가 한 벌씩 쓴다.
 */
function catchUpSource<T extends { id: string; createdAt: string }>(source: {
  loadSince: (cursor: string | null) => Promise<T[] | null>;
  cursor?: NotifierCursor;
}, seen: Set<string>, announce: (row: T) => void, live: () => boolean): () => Promise<void> {
  let baseline = false, checking = false;
  let cursor: string | null = null;
  return async () => {
    if (!live() || checking) return;
    checking = true;
    try {
      if (!baseline) {
        const shared = source.cursor?.read() ?? null;
        if (shared) { cursor = shared; baseline = true; }
      }
      const rows = await source.loadSince(baseline ? cursor : null);
      if (!live() || !rows) return;
      if (!baseline) {
        rows.forEach((row) => seen.add(row.id));
        cursor = rows.at(-1)?.createdAt ?? new Date().toISOString();
        baseline = true;
      } else {
        for (const row of rows) { announce(row); cursor = row.createdAt; }
      }
      if (cursor) source.cursor?.write(cursor);
    } catch { /* The next interval retries. */ } finally { checking = false; }
  };
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
  cursor?: NotifierCursor;
  /**
   * 상품 문의(1027T-002). Realtime이 없어 리더 탭이 30초마다 따라잡기로만 확인한다. 기준점·알림 차례는 1:1 문의와 따로다.
   * 없으면 1:1 문의만 알린다(기존 동작 그대로).
   */
  questions?: {
    loadSince: (cursor: string | null) => Promise<(NewProductQuestion & { createdAt: string })[] | null>;
    notify: (question: NewProductQuestion) => void;
    claim: (questionId: string) => boolean;
    cursor?: NotifierCursor;
  };
}): () => void {
  let active = true, leading = false;
  let countTimer: ReturnType<typeof setTimeout> | undefined;
  const live = () => active && leading;
  const seen = new Set<string>();
  const refreshCount = () => { void options.loadOpenCount().then((count) => { if (active) options.onCount(count); }, () => {}); };
  const scheduleCount = () => {
    if (countTimer) return;
    countTimer = setTimeout(() => { countTimer = undefined; refreshCount(); }, COUNT_DEBOUNCE_MS);
  };
  const announce = (inquiry: NewInquiry) => {
    if (!live() || seen.has(inquiry.id)) return;
    seen.add(inquiry.id);
    if (options.claim(inquiry.id)) options.notify(inquiry);
  };
  const inquiryCatchUp = catchUpSource({ loadSince: options.loadSince, cursor: options.cursor }, seen, announce, live);
  const questions = options.questions;
  const questionSeen = new Set<string>();
  const questionCatchUp = questions ? catchUpSource({ loadSince: questions.loadSince, cursor: questions.cursor }, questionSeen,
    (question: NewProductQuestion) => {
      if (!live() || questionSeen.has(question.id)) return;
      questionSeen.add(question.id);
      if (questions.claim(question.id)) questions.notify(question);
    }, live) : null;
  const stopRealtime = observeInquiryChanges(options.realtime, {
    onChange: (change) => {
      if (change.kind !== 'thread') return;
      scheduleCount();
      if (change.event === 'INSERT') announce({ id: change.inquiryId, title: change.title?.trim() || '고객문의가 접수되었습니다.' });
    },
    onReady: () => { refreshCount(); void inquiryCatchUp(); },
  });
  const interval = setInterval(() => { refreshCount(); void inquiryCatchUp(); }, CATCH_UP_MS);
  const questionInterval = questionCatchUp ? setInterval(() => { void questionCatchUp(); }, QUESTION_CATCH_UP_MS) : undefined;
  const stopLeading = options.leader(() => { leading = true; void inquiryCatchUp(); if (questionCatchUp) void questionCatchUp(); });
  refreshCount();
  return () => {
    active = false; leading = false;
    clearInterval(interval); clearInterval(questionInterval); clearTimeout(countTimer);
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
        // 권한 회수·OS 거부는 생성자가 던지지 않는다(오류 이벤트). 던지면 생성자 자체가 막힌 브라우저다.
        if (!showInquiryNotification(inquiry, () => openNotifiedInquiry(inquiry.id, (href) => router.push(href)))) {
          markInquiryNotificationsUnsupported(accountId);
        }
      },
      onCount,
      claim: (inquiryId) => claimInquiryNotification(accountId, inquiryId),
      cursor: { read: () => readInquiryNotifierCursor(accountId), write: (value) => writeInquiryNotifierCursor(accountId, value) },
      leader: (onLead) => acquireInquiryNotifierLeadership(accountId, onLead),
      questions: {
        /* cs.manage 운영자는 RLS로 비밀글까지 읽는다. 알림 본문에는 상품명과 공개 질문 앞부분만 쓴다. */
        loadSince: async (cursor) => {
          const query = client.from('product_questions').select('id,body,is_secret,created_at,goods(name)');
          const { data, error } = cursor
            ? await query.gt('created_at', cursor).order('created_at', { ascending: true }).limit(20)
            : await query.order('created_at', { ascending: false }).limit(1);
          if (error || !Array.isArray(data)) return null;
          return parseProductQuestionRows(data);
        },
        notify: (question) => {
          if (!showProductQuestionNotification(question, () => openNotifiedProductQuestion(question.id, (href) => router.push(href)))) {
            markInquiryNotificationsUnsupported(accountId);
          }
        },
        claim: (questionId) => claimProductQuestionNotification(accountId, questionId),
        cursor: { read: () => readProductQuestionNotifierCursor(accountId), write: (value) => writeProductQuestionNotifierCursor(accountId, value) },
      },
    });
  }, [accountId, enabled, onCount, router]);
}

/** product_questions 행(상품명은 goods 관계)을 알림 입력으로 좁힌다. 모양이 다른 행은 버린다. */
export function parseProductQuestionRows(rows: unknown[]): (NewProductQuestion & { createdAt: string })[] {
  return rows.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const row = value as { id?: unknown; body?: unknown; is_secret?: unknown; created_at?: unknown; goods?: unknown };
    if (typeof row.id !== 'string' || typeof row.body !== 'string' || typeof row.created_at !== 'string') return [];
    const good = (Array.isArray(row.goods) ? row.goods[0] : row.goods) as { name?: unknown } | null | undefined;
    /* 비밀글 여부를 읽지 못하면 비밀글로 본다(본문을 알림에 싣지 않는 쪽). */
    return [{ id: row.id, body: row.body, secret: row.is_secret !== false, createdAt: row.created_at,
      goodName: typeof good?.name === 'string' ? good.name : null }];
  });
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
    : on ? '켜짐 · 이 기기의 이 계정에서 커머스 콘솔 탭이 하나라도 열려 있으면 새 1:1 문의와 상품 문의를 PC 알림으로 알려 드리고, 탭 제목 앞에 미답변 1:1 문의 수를 표시합니다. 상품 문의는 30초마다 확인합니다. 탭을 모두 닫으면 알림이 오지 않습니다.'
    : '꺼짐 · 켜면 새 1:1 문의와 상품 문의가 올 때 PC 알림을 띄웁니다. 알림을 누르면 그 문의가 열립니다.';
  return <section className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3" aria-label={INQUIRY_NOTIFICATION_SETTINGS_TITLE}>
    <h3 className="text-sm font-medium text-foreground">{INQUIRY_NOTIFICATION_SETTINGS_TITLE}</h3>
    <p className="text-xs leading-relaxed text-muted-foreground" role="status">{status}</p>
    {message && message !== status ? <p className="text-xs leading-relaxed text-muted-foreground" role="status">{message}</p> : null}
    <div className="flex gap-2">{on
      ? <Button disabled={busy} onClick={onDisable} size="sm" type="button" variant="outline">문의 알림 끄기</Button>
      : <Button disabled={busy || support === 'unsupported'} onClick={onEnable} size="sm" type="button">문의 알림 받기</Button>}</div>
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
      setMessage(result === 'granted' ? INQUIRY_NOTIFICATION_ENABLED : result === 'denied' ? INQUIRY_NOTIFICATION_DENIED
        : result === 'storage_unavailable' ? '이 브라우저에 설정을 저장할 수 없습니다. 사이트 데이터 저장을 허용한 뒤 다시 켜 주세요.'
        : result === 'unsupported' ? INQUIRY_NOTIFICATION_UNSUPPORTED : '알림 허용 창을 닫았습니다. 다시 누르면 허용 창이 열립니다.');
    } finally { setBusy(false); setPermissionCheck((value) => value + 1); }
  }
  function disable() { setInquiryNotificationsEnabled(accountId, false); setMessage('문의 알림을 껐습니다.'); }
  return <InquiryNotificationSettingsView support={support} enabled={enabled} message={message} busy={busy} onEnable={() => { void enable(); }} onDisable={disable} />;
}

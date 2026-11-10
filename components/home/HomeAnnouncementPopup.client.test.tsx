import { type ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HOME_POPUP_DISMISS_STORAGE, type HomeAnnouncementPopupItem } from '@/lib/goods-announcement-popup';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], index: 0, effects: [] as (() => (() => void) | undefined)[], ref: { current: null as unknown } }));
const refresh = vi.hoisted(() => vi.fn());
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useId: () => 'popup-title', useRef: () => hooks.ref, useCallback: (fn: unknown) => fn,
  useState: (initial: unknown) => { const i = hooks.index++; if (!(i in hooks.states)) hooks.states[i] = initial; return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
  useEffect: (fn: () => (() => void) | undefined) => { hooks.effects.push(fn); },
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
import { HomeAnnouncementPopup } from './HomeAnnouncementPopup';
const item: HomeAnnouncementPopupItem = { id: '00000000-0000-4000-8000-000000062211', dismissKey: '00000000-0000-4000-8000-000000062212', title: '공지', body: '안내', format: 'plain', device: 'all', important: false, startsAt: '2026-10-14T00:00:00Z', endsAt: '2026-10-16T00:00:00Z' };
let cleanups: (() => void)[] = [];
let storage: Map<string, string>; let listeners: Record<string, () => void>;
let media: { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let dialog: { open: boolean; showModal: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
function render(value = item) {
  cleanups.forEach(fn => fn()); cleanups = []; hooks.index = 0; hooks.effects = [];
  const element = (HomeAnnouncementPopup({ data: { item: value, nextChangeAt: null } }).props.children as ReactElement[])[1];
  const component = element.type as (props: { item: HomeAnnouncementPopupItem }) => ReactElement;
  const node = component({ item: value }); cleanups = hooks.effects.map(fn => fn()).filter((fn): fn is () => void => Boolean(fn));
  return node;
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T14:59:59Z')); vi.clearAllMocks(); hooks.states = []; storage = new Map(); listeners = {};
  dialog = { open: false, showModal: vi.fn(() => { dialog.open = true; }), close: vi.fn(() => { dialog.open = false; }) }; hooks.ref.current = dialog;
  media = { matches: true, addEventListener: vi.fn((name, fn) => { listeners.media = fn; }), removeEventListener: vi.fn() };
  vi.stubGlobal('HTMLElement', class {});
  vi.stubGlobal('document', { activeElement: null, body: { style: { overflow: '' } }, visibilityState: 'visible', addEventListener: vi.fn((name, fn) => { listeners[name] = fn; }), removeEventListener: vi.fn() });
  vi.stubGlobal('window', { matchMedia: () => media, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) }, addEventListener: vi.fn((name, fn) => { listeners[name] = fn; }), removeEventListener: vi.fn() });
});
afterEach(() => { cleanups.forEach(fn => fn()); cleanups = []; vi.useRealTimers(); vi.unstubAllGlobals(); });
it('종료 시각에 서버 응답 없이 바로 닫고 공개 내용을 갱신한다', () => {
  render({ ...item, endsAt: '2026-10-14T15:00:00Z' }); expect(dialog.open).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  vi.advanceTimersByTime(1000); expect(dialog.open).toBe(false); expect(document.body.style.overflow).toBe(''); expect(refresh).toHaveBeenCalledTimes(1);
});
it('기기 표시 조건이 바뀌면 팝업을 닫고 해당 기기로 돌아오면 다시 연다', () => {
  render({ ...item, device: 'pc' }); expect(dialog.open).toBe(true);
  media.matches = false; listeners.media(); expect(dialog.open).toBe(false);
  media.matches = true; listeners.media(); expect(dialog.open).toBe(true);
});
it('하루 숨김은 한국 자정까지이며 다른 팝업 선택에는 적용되지 않는다', () => {
  storage.set(HOME_POPUP_DISMISS_STORAGE, JSON.stringify({ key: item.dismissKey, until: Date.parse('2026-10-14T15:00:00Z') }));
  render(); expect(dialog.open).toBe(false); vi.advanceTimersByTime(1000); expect(dialog.open).toBe(true);
  vi.setSystemTime(new Date('2026-10-14T14:59:59Z')); render({ ...item, dismissKey: item.id }); expect(dialog.open).toBe(true);
});

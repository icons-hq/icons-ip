import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * 값을 state로 드는 화면의 뒤로 가기 복구(QA G5). 브라우저 뒤로 가기는 막을 수 없어, 저장하지 않은 값을 이 탭에 보관했다가
 * 같은 주소로 돌아오면 되살린다 — 비제어 폼의 복구(lib/admin/leave-guard)와 같은 규칙인지 본다.
 */
const hooks = vi.hoisted(() => ({
  refs: [] as { current: unknown }[], effects: [] as { deps?: unknown[]; cleanup?: void | (() => void) }[],
  jobs: [] as (() => void)[], refIndex: 0, effectIndex: 0,
}));
const leave = vi.hoisted(() => ({ confirmed: false }));
vi.mock('react', async () => ({
  ...await vi.importActual<typeof import('react')>('react'),
  useRef: (initial: unknown) => { const index = hooks.refIndex++; return hooks.refs[index] ??= { current: initial }; },
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
    const index = hooks.effectIndex++, previous = hooks.effects[index];
    if (previous && deps && previous.deps && !deps.some((dep, i) => dep !== previous.deps![i])) return;
    hooks.effects[index] = { deps };
    hooks.jobs.push(() => { previous?.cleanup?.(); hooks.effects[index].cleanup = effect(); });
  },
}));
vi.mock('@/lib/admin/leave-guard', () => ({ adminLeaveWasJustConfirmed: () => leave.confirmed }));

import { adminStateRecoveryKey, useAdminStateRecovery } from './useAdminStateRecovery';

type Options = Parameters<typeof useAdminStateRecovery>[0];
const restored = vi.fn();
function Screen(options: Options) { useAdminStateRecovery(options); }
function render(options: Partial<Options> = {}) {
  hooks.refIndex = 0; hooks.effectIndex = 0;
  Screen({ id: 'goods-media', dirty: false, value: null, onRestore: restored, ...options });
  for (const job of hooks.jobs.splice(0)) job();
}
/** 화면이 내려간다(다른 화면으로 떠나거나 다시 그려질 때). */
function unmount() { for (const effect of hooks.effects) effect.cleanup?.(); hooks.effects = []; hooks.refs = []; }
function goTo(pathname: string, search = '') { (window as unknown as { location: { pathname: string; search: string } }).location = { pathname, search }; }

const MEDIA = '/admin/catalog/goods/media', KEY = adminStateRecoveryKey({ pathname: MEDIA, search: '?goodId=g6' }, 'goods-media');
let store: Map<string, string>;

beforeEach(() => {
  hooks.refs = []; hooks.effects = []; hooks.jobs = []; leave.confirmed = false; restored.mockReset();
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-25T12:00:00Z'));
  store = new Map();
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
  vi.stubGlobal('window', { location: { pathname: MEDIA, search: '?goodId=g6' } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('떠날 때 보관한다', () => {
  it('저장하지 않은 값이 있는 채로 다른 주소로 떠나면(뒤로 가기) 이 탭에 보관한다', () => {
    render({ dirty: true, value: { video: { id: 'v1' }, shortclip: null } });
    goTo(MEDIA, '');
    unmount();
    expect(JSON.parse(store.get(KEY)!)).toEqual({ at: Date.parse('2026-11-25T12:00:00Z'), value: { video: { id: 'v1' }, shortclip: null } });
  });
  it('떠나기 직전의 값을 보관한다(처음 그릴 때의 값이 아니다)', () => {
    render({ dirty: false, value: 'first' });
    render({ dirty: true, value: 'latest' });
    goTo('/admin/catalog/goods');
    unmount();
    expect(JSON.parse(store.get(KEY)!).value).toBe('latest');
  });
  it('저장하지 않은 값이 없으면 보관하지 않는다', () => {
    render({ dirty: false, value: 'saved' });
    goTo('/admin/catalog/goods');
    unmount();
    expect(store.size).toBe(0);
  });
  it("운영자가 '화면 이동' 확인창에서 [이동]을 눌러 버리기로 한 값은 보관하지 않는다", () => {
    render({ dirty: true, value: 'discarded' });
    leave.confirmed = true;
    goTo('/admin/catalog/goods');
    unmount();
    expect(store.size).toBe(0);
  });
  it('같은 주소에서 화면이 다시 그려지는 것은 떠난 것이 아니다', () => {
    render({ dirty: true, value: 'still here' });
    unmount();
    expect(store.size).toBe(0);
  });
  it('브라우저가 보관을 막아도 화면은 그대로 내려간다', () => {
    vi.stubGlobal('sessionStorage', { getItem: () => null, removeItem: () => undefined, setItem: () => { throw new Error('blocked'); } });
    render({ dirty: true, value: 'x' });
    goTo('/admin/catalog/goods');
    expect(() => unmount()).not.toThrow();
  });
});

describe('돌아오면 되살린다', () => {
  const keep = (value: unknown, at = Date.now()) => store.set(KEY, JSON.stringify({ at, value }));
  it('같은 주소로 돌아오면 보관한 값을 화면에 넘기고 기록을 지운다(한 번만 되살린다)', () => {
    keep({ video: { id: 'v1' }, shortclip: null });
    render();
    /* 화면이 서버에서 받은 값으로 먼저 그려진 뒤에 되살린다. */
    expect(restored).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(restored).toHaveBeenCalledExactlyOnceWith({ video: { id: 'v1' }, shortclip: null });
    expect(store.has(KEY)).toBe(false);
    unmount(); render(); vi.runAllTimers();
    expect(restored).toHaveBeenCalledOnce();
  });
  it('다른 상품의 화면(쿼리가 다른 주소)에는 되살리지 않는다', () => {
    keep('for g6');
    goTo(MEDIA, '?goodId=g7');
    render(); vi.runAllTimers();
    expect(restored).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(true);
  });
  it('1시간이 지난 기록과 깨진 기록은 되살리지 않고 버린다', () => {
    keep('old', Date.now() - 60 * 60 * 1000 - 1);
    render(); vi.runAllTimers();
    expect(restored).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(false);
    unmount();
    store.set(KEY, '{not json');
    render(); vi.runAllTimers();
    expect(restored).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(false);
  });
  it('되살리기 전에 화면이 내려가면 기록을 남겨 둔다(다음에 돌아왔을 때 되살린다)', () => {
    keep('later');
    render();
    unmount();
    vi.runAllTimers();
    expect(restored).not.toHaveBeenCalled();
    expect(store.has(KEY)).toBe(true);
  });
  it('되살린 값을 받는 함수는 가장 최근에 그린 화면의 것이다', () => {
    keep('value');
    const first = vi.fn(), second = vi.fn();
    render({ onRestore: first });
    render({ onRestore: second });
    vi.runAllTimers();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith('value');
  });
});

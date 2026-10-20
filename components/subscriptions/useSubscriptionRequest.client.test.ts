import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; effect: () => void | (() => void); cleanup?: () => void }[], changed: [] as number[], stateIndex: 0, memoIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void), lost: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useState: (value: unknown) => { const i = hooks.stateIndex++; if (!(i in hooks.states)) hooks.states[i] = typeof value === 'function' ? value() : value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = typeof next === 'function' ? next(hooks.states[i]) : next; }]; },
  useMemo: (callback: () => unknown, deps: unknown[]) => { const i = hooks.memoIndex++; if (!hooks.memos[i] || deps.some((dep, j) => dep !== hooks.memos[i].deps[j])) hooks.memos[i] = { value: callback(), deps }; return hooks.memos[i].value; },
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
  useEffect: (effect: () => void | (() => void), deps: unknown[] = []) => { const i = hooks.effectIndex++, previous = hooks.effects[i]; if (!previous || deps.some((dep, j) => dep !== previous.deps[j])) { hooks.effects[i] = { deps, effect, cleanup: previous?.cleanup }; hooks.changed.push(i); } },
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; } } }) }));
import { useSubscriptionRequest } from './useSubscriptionRequest';
import type { SubscriptionResult } from '@/lib/subscriptions/customer';
const actor = 'b1716000-0000-4000-8000-000000000010', session = 'b1716000-0000-4000-8000-000000000020';
let request: ReturnType<typeof useSubscriptionRequest>;
function HookHarness() { return useSubscriptionRequest(actor, mocks.lost); }
function render() { hooks.stateIndex = 0; hooks.memoIndex = 0; hooks.effectIndex = 0; request = HookHarness(); return request; }
function effects() { for (const i of hooks.changed.splice(0)) { hooks.effects[i].cleanup?.(); hooks.effects[i].cleanup = hooks.effects[i].effect() || undefined; } }
async function flush() { for (let i = 0; i < 6; i++) { await Promise.resolve(); render(); effects(); } }
function auth(user = actor, sessionId = session) { mocks.auth?.('SIGNED_IN', { user: { id: user }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: sessionId })).toString('base64url')}.x` }); }
const defer = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; };
beforeEach(async () => { hooks.states = []; hooks.memos = []; hooks.effects = []; hooks.changed = []; vi.clearAllMocks(); vi.stubGlobal('window', new EventTarget());
  render(); effects(); auth(); await flush(); });
afterEach(() => { for (const effect of hooks.effects) effect.cleanup?.(); vi.unstubAllGlobals(); });
it('동일 콜백을 연속 호출해도 결제·변경 요청은 하나이며 불명확하면 원 closure로만 재시도한다', async () => {
  const pending = defer<SubscriptionResult<string>>(), send = vi.fn(() => pending.promise), accept = vi.fn(), stale = request;
  stale.run(send, accept); stale.run(send, accept); expect(send).toHaveBeenCalledTimes(1);
  pending.resolve({ ok: false, uncertain: true, error: 'unknown' }); await flush(); expect(request.locked).toBe(true);
  request.run(vi.fn(), accept); request.retry(); await flush(); expect(send).toHaveBeenCalledTimes(2); expect(accept).not.toHaveBeenCalled();
});
it.each(['account', 'session', 'signout', 'unmount'])('%s 뒤 늦은 주소·카드 응답은 적용되지 않는다', async kind => {
  const pending = defer<SubscriptionResult<string>>(), accept = vi.fn(); request.run(() => pending.promise, accept); await flush();
  if (kind === 'account') auth(session); if (kind === 'session') auth(actor, actor); if (kind === 'signout') window.dispatchEvent(new Event('icons:inquiry-drafts:signed-out'));
  if (kind === 'unmount') for (const effect of hooks.effects) { effect.cleanup?.(); effect.cleanup = undefined; }
  pending.resolve({ ok: true, value: 'previous account address' }); await flush(); expect(accept).not.toHaveBeenCalled();
  if (kind !== 'unmount') expect(request.blocked).toBe(true);
});
it('확정 후 readback 실패면 새 쓰기는 금지하고 최신 상태 복구만 허용한다', async () => {
  request.run(async () => ({ ok: false, committed: true, error: 'read failed' }), vi.fn()); await flush(); expect(request.locked).toBe(true);
  const write = vi.fn(); request.run(write, vi.fn()); expect(write).not.toHaveBeenCalled();
  const accept = vi.fn(); request.recover(async () => ({ ok: true, value: 'latest' }), accept); await flush(); expect(accept).toHaveBeenCalledWith('latest'); expect(request.locked).toBe(false);
});

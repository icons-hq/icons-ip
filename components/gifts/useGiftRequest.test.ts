import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[], cleanups: [] as (() => void)[], s: 0, r: 0, e: 0 }));
const mocks = vi.hoisted(() => ({ auth: null as null | ((event: string, session: { user: { id: string }; access_token: string } | null) => void), unsubscribe: vi.fn() }));
vi.mock('react', () => ({
  useState: (value: unknown) => { const i = hooks.s++; if (!(i in hooks.states)) hooks.states[i] = value; return [hooks.states[i], (next: unknown) => { hooks.states[i] = next; }]; },
  useRef: (value: unknown) => { const i = hooks.r++; return hooks.refs[i] ??= { current: value }; },
  useEffect: (callback: () => void | (() => void)) => { const i = hooks.e++; hooks.effects[i] ??= callback; },
}));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.auth) => { mocks.auth = callback; return { data: { subscription: { unsubscribe: mocks.unsubscribe } } }; } } }) }));
import { useGiftRequest } from './useGiftRequest';
const actor = '93942000-0000-4000-8000-000000000001', lost = vi.fn();
function GiftRequestHarness() { return useGiftRequest(actor, lost); }
function render() { hooks.s = 0; hooks.r = 0; hooks.e = 0; return GiftRequestHarness(); }
function session(id = actor, key = '93942000-0000-4000-8000-000000000020') { mocks.auth?.('SIGNED_IN', { user: { id }, access_token: `x.${Buffer.from(JSON.stringify({ session_id: key })).toString('base64url')}.x` }); }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
beforeEach(() => { hooks.states = []; hooks.refs = []; hooks.effects = []; hooks.cleanups = []; vi.clearAllMocks(); render(); hooks.cleanups = hooks.effects.map(callback => callback()).filter(Boolean) as (() => void)[]; session(); });
afterEach(() => { for (const callback of hooks.cleanups) callback(); });
it('uncertain mutations keep the original closure and block replacements until exact retry resolves', async () => {
  const accept = vi.fn(), replacement = vi.fn(); const send = vi.fn().mockResolvedValueOnce({ error: 'unknown', uncertain: true }).mockResolvedValueOnce({ receipt: 'original-op' });
  render().run(send, accept); await settle(); expect(render().locked).toBe(true); render().run(replacement, accept); expect(replacement).not.toHaveBeenCalled();
  render().retry(); await settle(); expect(send).toHaveBeenCalledTimes(2); expect(accept).toHaveBeenCalledExactlyOnceWith({ receipt: 'original-op' }); expect(render().locked).toBe(false);
});
it('conflicts require readback before starting a new operation', async () => {
  const accept = vi.fn(), send = vi.fn().mockResolvedValue({ error: 'changed', conflict: true }), second = vi.fn().mockResolvedValue({ revision: 2 });
  render().run(send, accept); await settle(); render().run(second, accept); expect(second).not.toHaveBeenCalled(); render().recover(second, accept); await settle(); expect(accept).toHaveBeenCalledWith({ revision: 2 }); expect(render().locked).toBe(false);
});
it.each(['different-actor', 'different-session', 'signed-out'])('discards pending completion and retained retry after %s', async kind => {
  let finish!: (value: object) => void; const accept = vi.fn(), send = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render().run(send, accept);
  if (kind === 'signed-out') mocks.auth?.('SIGNED_OUT', null); else session(kind === 'different-actor' ? '93942000-0000-4000-8000-000000000002' : actor, kind === 'different-session' ? '93942000-0000-4000-8000-000000000021' : '93942000-0000-4000-8000-000000000020');
  finish({ receipt: 'late' }); await settle(); expect(accept).not.toHaveBeenCalled(); expect(lost).toHaveBeenCalledOnce(); expect(render().blocked).toBe(true); render().retry(); expect(send).toHaveBeenCalledOnce();
});
it('unmount drops a late success without applying it to another screen', async () => {
  let finish!: (value: { receipt: string }) => void; const accept = vi.fn(); render().run(() => new Promise<{ receipt: string }>(resolve => { finish = resolve; }), accept); for (const callback of hooks.cleanups) callback(); hooks.cleanups = [];
  finish({ receipt: 'late' }); await settle(); expect(accept).not.toHaveBeenCalled(); expect(mocks.unsubscribe).toHaveBeenCalledOnce();
});

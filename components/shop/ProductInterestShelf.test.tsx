import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterestCollection } from '@/lib/product-detail-experiences';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[], stateIndex: 0, refIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ collection: vi.fn(), authCallback: null as null | ((_event: string, session: { user: { id: string } } | null) => void), write: vi.fn(), read: vi.fn(), remove: vi.fn() }));
vi.mock('react', async () => ({ ...await vi.importActual<typeof import('react')>('react'),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => { const index = hooks.stateIndex++; if (!(index in hooks.state)) hooks.state[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [hooks.state[index], (next: unknown) => { hooks.state[index] = typeof next === 'function' ? (next as (old: unknown) => unknown)(hooks.state[index]) : next; }]; },
  useRef: (initial: unknown) => { const index = hooks.refIndex++; hooks.refs[index] ??= { current: initial }; return hooks.refs[index]; },
  useEffect: (effect: () => void | (() => void)) => { hooks.effects[hooks.effectIndex++] = effect; },
}));
vi.mock('@/app/shop/experience-actions', () => ({ loadInterestCollectionAction: mocks.collection, loadInterestAvailabilityAction: vi.fn() }));
vi.mock('@/components/shell/CartProvider', () => ({ useCart: () => ({ ready: true, mode: 'local', items: [] }) }));
vi.mock('@/components/wc/ProductCard', () => ({ ProductCard: () => null }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: {
  onAuthStateChange: (callback: typeof mocks.authCallback) => { mocks.authCallback = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
  getUser: () => new Promise(() => {}),
} }) }));
import { ProductInterestShelf } from './ProductInterestShelf';
import { emptyInterestCollection, recentGoodsKey } from '@/lib/product-detail-experiences';
const first = '92200000-0000-4000-8000-000000000007', second = '92200000-0000-4000-8000-000000000008';
function render() { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0; return ProductInterestShelf({ currentGoodId: 'g1' }); }
function deferred() { let resolve!: (value: InterestCollection) => void; const promise = new Promise<InterestCollection>(done => { resolve = done; }); return { promise, resolve }; }
async function flush() { await Promise.resolve(); await Promise.resolve(); }
beforeEach(() => { vi.clearAllMocks(); hooks.state = []; hooks.refs = []; hooks.effects = []; mocks.authCallback = null; mocks.read.mockReturnValue(null); vi.stubGlobal('window', { localStorage: { getItem: mocks.read, setItem: mocks.write, removeItem: mocks.remove } }); });
afterEach(() => vi.unstubAllGlobals());
describe('interest collection privacy boundaries', () => {
  it('does not record recent browsing before or after the server returns OFF', async () => {
    const request = deferred(); mocks.collection.mockReturnValue(request.promise);
    render(); hooks.effects[0](); mocks.authCallback!('SIGNED_IN', { user: { id: first } }); render(); hooks.effects[1]();
    expect(mocks.write).not.toHaveBeenCalled();
    request.resolve(emptyInterestCollection(first)); await flush(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it('records only after enabled readback and keeps the account key', async () => {
    const request = deferred(); mocks.collection.mockReturnValue(request.promise);
    render(); hooks.effects[0](); mocks.authCallback!('SIGNED_IN', { user: { id: first } }); render(); hooks.effects[1]();
    request.resolve({ ...emptyInterestCollection(first), enabled: true }); await flush();
    expect(mocks.write).toHaveBeenCalledWith(recentGoodsKey(first), JSON.stringify({ version: 1, ids: ['g1'] }));
    const state = hooks.state[1]; mocks.authCallback!('TOKEN_REFRESHED', { user: { id: first } }); expect(hooks.state[1]).toBe(state);
  });
  it('discards the previous account response and never records it after switching', async () => {
    const oldRequest = deferred(), newRequest = deferred(); mocks.collection.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(newRequest.promise);
    render(); hooks.effects[0](); mocks.authCallback!('SIGNED_IN', { user: { id: first } }); render(); const cleanup = hooks.effects[1]();
    mocks.authCallback!('SIGNED_IN', { user: { id: second } }); cleanup?.(); render(); hooks.effects[1]();
    oldRequest.resolve({ ...emptyInterestCollection(first), enabled: true }); await flush(); expect(mocks.write).not.toHaveBeenCalled();
    newRequest.resolve({ ...emptyInterestCollection(second), enabled: true }); await flush();
    expect(mocks.write).toHaveBeenCalledOnce(); expect(mocks.write.mock.calls[0][0]).toBe(recentGoodsKey(second));
  });
});

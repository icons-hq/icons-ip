import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterestCollection } from '@/lib/product-detail-experiences';
const hooks = vi.hoisted(() => ({ state: [] as unknown[], refs: [] as { current: unknown }[], effects: [] as (() => void | (() => void))[], stateIndex: 0, refIndex: 0, effectIndex: 0 }));
const mocks = vi.hoisted(() => ({ collection: vi.fn(), authCallback: null as null | ((_event: string, session: { user: { id: string } } | null) => void), write: vi.fn(), read: vi.fn(), remove: vi.fn(), rpc: vi.fn() }));
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
}, rpc: mocks.rpc }) }));
vi.mock('@/app/shop/actions', () => ({ toggleWishlistAction: vi.fn() }));
import { ProductInterestShelf } from './ProductInterestShelf';
import { ProductCard } from '@/components/wc/ProductCard';
import type { Good } from '@/lib/data';
import { emptyInterestCollection, recentGoodsKey } from '@/lib/product-detail-experiences';
const first = '92200000-0000-4000-8000-000000000007', second = '92200000-0000-4000-8000-000000000008';
function render(props: Partial<Parameters<typeof ProductInterestShelf>[0]> = {}) { hooks.stateIndex = 0; hooks.refIndex = 0; hooks.effectIndex = 0; return ProductInterestShelf({ currentGoodId: 'g1', ...props }); }
/* 렌더하지 않고 돌려받은 트리에서 상품 카드 요소의 props 를 모은다. */
function cardProps(node: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const element = value as { type?: unknown; props?: Record<string, unknown> };
    if (element.type === ProductCard && element.props) found.push(element.props);
    if (element.props?.children !== undefined) visit(element.props.children);
  };
  visit(node);
  return found;
}
const good = (id: string): Good => ({ id, name: `관심 ${id}`, ip: 'ip', type: '문구', price: 1000, badge: null, img: '', stock: 'ok', stockQty: 3 });
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
/* L4b · CL-01·CL-02 — 관심 굿즈 카드도 목록 하트와 별점을 단다. 굿즈는 서버 액션으로 오므로 별점은 받은 뒤 한 번에 묻는다. */
describe('interest collection listing cards', () => {
  it('서버가 판정한 위시 상태로 하트를, 받아 온 굿즈의 별점은 네 묶음을 한 번에 물어 카드에 단다', async () => {
    render({ wishlist: { viewerId: first, goodIds: ['g3'] } });
    hooks.state[0] = first;
    hooks.state[1] = { ...emptyInterestCollection(first), enabled: true, groups: { repurchase: [], cart: [good('g4')], wishlist: [good('g3')], recent: [good('g1'), good('g2'), good('g3')] } };
    render({ wishlist: { viewerId: first, goodIds: ['g3'] } });

    mocks.rpc.mockResolvedValueOnce({ data: [{ goodId: 'g2', reviewCount: 3, ratingAverage: 4.67 }], error: null });
    hooks.effects[2]();
    /* 현재 굿즈(g1)는 선반에서 빠지므로 묻지 않는다. 같은 굿즈는 한 번만. */
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('get_goods_review_summaries', { p_good_ids: ['g2', 'g3', 'g4'] });
    await flush();

    const recent = cardProps(render({ wishlist: { viewerId: first, goodIds: ['g3'] } }));
    expect(recent.map(card => card.name)).toEqual(['관심 g2', '관심 g3']);
    expect(recent[0].reviewSummary).toEqual({ count: 3, average: 4.67 });
    expect(recent[1].reviewSummary).toBeUndefined();
    expect(recent[0].action).toMatchObject({ props: { goodId: 'g2', initialWished: false, viewerId: first } });
    expect(recent[1].action).toMatchObject({ props: { goodId: 'g3', initialWished: true, label: '관심 g3' } });
    /* 탭을 바꿔도 다시 묻지 않는다 — 네 묶음을 처음에 함께 물었다. */
    hooks.state[2] = 'cart';
    const cart = cardProps(render({ wishlist: { viewerId: first, goodIds: ['g3'] } }));
    expect(cart.map(card => card.name)).toEqual(['관심 g4']);
    hooks.effects[2]();
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });

  it('위시 상태를 받지 않으면 카드에 하트가 없다', () => {
    render();
    hooks.state[0] = first;
    hooks.state[1] = { ...emptyInterestCollection(first), enabled: true, groups: { repurchase: [], cart: [], wishlist: [], recent: [good('g2')] } };
    expect(cardProps(render()).map(card => card.action)).toEqual([undefined]);
  });
});

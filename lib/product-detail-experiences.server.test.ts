import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), cards: vi.fn(), identity: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc, auth: { getUser: mocks.identity } }) }));
vi.mock('@/lib/catalog', () => ({ getCatalogGoodsByIds: mocks.cards }));
import { loadProductInterestCollection, loadProductShippingSavings } from './product-detail-experiences.server';
const owner = '92200000-0000-4000-8000-000000000007', variant = '92200000-0000-4000-8000-000000000107';
beforeEach(() => { vi.clearAllMocks(); mocks.identity.mockResolvedValue({ data: { user: { id: owner } }, error: null }); mocks.cards.mockResolvedValue(['g1', 'g2', 'g3'].map(id => ({ id, options: [{ id: variant, stockQty: 10 }] }))); });
const interestRpc = (enabled = true, ownerId: string | null = owner) => mocks.rpc.mockImplementation(async (name: string) => name === 'get_product_detail_experience_config'
  ? { data: { interests: enabled, shippingSavings: true }, error: null }
  : { data: { ownerId, repurchase: ['g1'], cart: ['g2'], wishlist: ['g3'] }, error: null });
describe('PDP experience ownership and quote loaders', () => {
  it('uses server-owned cart and wishlist IDs without accepting a requested owner', async () => {
    interestRpc(); const result = await loadProductInterestCollection(['g1'], ['guest-cart']);
    expect(result.groups.cart.map(good => good.id)).toEqual(['g2']); expect(result.groups.wishlist.map(good => good.id)).toEqual(['g3']);
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_product_detail_interests'); expect(mocks.cards).not.toHaveBeenCalledWith(expect.arrayContaining(['guest-cart']));
  });
  it('returns no private projection for a changed identity or disabled switch', async () => {
    interestRpc(true, '92200000-0000-4000-8000-000000000008');
    expect(await loadProductInterestCollection([], [])).toMatchObject({ unavailable: true, groups: { cart: [], wishlist: [], repurchase: [] } });
    expect(mocks.cards).not.toHaveBeenCalled();
    interestRpc(false); expect(await loadProductInterestCollection(['g1'], [])).toMatchObject({ enabled: false }); expect(mocks.cards).not.toHaveBeenCalled();
  });
  it('only uses a guest local cart when the server also confirms a guest', async () => {
    mocks.identity.mockResolvedValue({ data: { user: null }, error: null });
    mocks.rpc.mockImplementation(async (name: string) => name === 'get_product_detail_experience_config' ? { data: { interests: true, shippingSavings: false }, error: null } : { data: { ownerId: null, repurchase: [], cart: [], wishlist: [] }, error: null });
    const result = await loadProductInterestCollection(['g1'], ['g2', 'https://invalid.test']);
    expect(result.ownerId).toBeNull(); expect(result.groups.cart.map(good => good.id)).toEqual(['g2']); expect(result.groups.repurchase).toEqual([]);
  });
  it('removes a quoted candidate whose option was deleted or sold out before catalog readback', async () => {
    mocks.rpc.mockResolvedValue({ data: { items: [{ goodId: 'g2', variantId: variant, variantName: '기본', qty: 2, separateFee: 6000, combinedFee: 0, savings: 6000 }], nextChangeAt: null }, error: null });
    expect((await loadProductShippingSavings('g1', variant, 1)).items).toHaveLength(1);
    mocks.cards.mockResolvedValue([{ id: 'g2', options: [{ id: variant, stockQty: 1 }] }]); expect((await loadProductShippingSavings('g1', variant, 1)).items).toEqual([]);
    mocks.cards.mockResolvedValue([{ id: 'g2', options: [] }]); expect((await loadProductShippingSavings('g1', variant, 1)).items).toEqual([]);
  });
});

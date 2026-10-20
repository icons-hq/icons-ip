import { beforeEach, expect, it, vi } from 'vitest';
import { loadAdminStoreSettings } from './store-settings.server';
import { DEFAULT_STORE_BRANDING } from '@/lib/store-branding';
import { DEFAULT_STORE_NAVIGATION } from '@/lib/store-navigation';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => mocks }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.from.mockImplementation(() => {
    const builder = { select: () => builder, order: () => builder, then: (resolve: (data: unknown) => void) => resolve({ data: [], error: null }) };
    return builder;
  });
  mocks.rpc.mockImplementation(async name => name === 'admin_operator_store_settings' ? { data: { store: {
    business: { companyName: '합성 판매자' }, branding: DEFAULT_STORE_BRANDING,
    navigation: DEFAULT_STORE_NAVIGATION, updated_at: '2026-10-13T00:00:00Z',
  }, capabilities: ['seller.read', 'store.manage'] }, error: null } : { data: [], error: null });
});
it('uses the section projection RPC without ever selecting the mixed settings table', async () => {
  const result = await loadAdminStoreSettings();
  expect(mocks.rpc).toHaveBeenCalledWith('admin_operator_store_settings');
  expect(mocks.from.mock.calls.map(args => args[0])).toEqual(['shipping_carriers']);
  expect(result.settings).toMatchObject({ business: { companyName: '합성 판매자' }, bankTransfer: null });
  expect(result.settings.branding).toEqual(DEFAULT_STORE_BRANDING);
});
it('does not fall back to broad direct reads when the projection is unavailable', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'projection denied' } });
  await expect(loadAdminStoreSettings()).rejects.toThrow();
  expect(mocks.from).not.toHaveBeenCalledWith('store_settings');
});

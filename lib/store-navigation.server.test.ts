import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), create: vi.fn(), configured: true }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mocks.create }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ url: 'https://local.example.test', key: 'anon-test', isConfigured: mocks.configured }) }));
import { loadStorefrontNavigation } from './store-navigation.server';
import { DEFAULT_STOREFRONT_NAVIGATION } from './store-navigation';
beforeEach(() => { mocks.rpc.mockReset(); mocks.create.mockReset().mockReturnValue({ rpc: mocks.rpc }); mocks.configured = true; });
it('쿠키 없이 공개 전용 메뉴 RPC의 검증된 최소 응답만 사용한다', async () => {
  const navigation = [{ id: 'events', label: '합성 행사' }, { id: 'shop', label: '상품' }];
  mocks.rpc.mockResolvedValue({ data: navigation, error: null });
  expect(await loadStorefrontNavigation()).toEqual(navigation);
  expect(mocks.rpc).toHaveBeenCalledWith('get_storefront_navigation');
  expect(mocks.create.mock.calls[0][2].cookies.getAll()).toEqual([]);
});
it('미적용 DB·잘못된 응답·미설정 환경에서도 기존 메뉴로 안전하게 돌아간다', async () => {
  mocks.rpc.mockResolvedValue({ data: null, error: { message: 'missing' } });
  expect(await loadStorefrontNavigation()).toEqual(DEFAULT_STOREFRONT_NAVIGATION);
  mocks.rpc.mockResolvedValue({ data: [{ id: 'admin', label: '금지' }], error: null });
  expect(await loadStorefrontNavigation()).toEqual(DEFAULT_STOREFRONT_NAVIGATION);
  mocks.configured = false;
  expect(await loadStorefrontNavigation()).toEqual(DEFAULT_STOREFRONT_NAVIGATION);
});

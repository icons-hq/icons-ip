import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isCollectibleFeatureEnabled, loadCollectibleFeatures, readCollectibleFeatures } from './collectible-features.server';

const mocks = vi.hoisted(() => ({
  config: { isConfigured: false, url: undefined, key: undefined } as { isConfigured: boolean; url?: string; key?: string },
  rpc: vi.fn(),
  connection: vi.fn(),
  cookies: [] as unknown[],
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => mocks.config }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, options: { cookies: { getAll: () => unknown[] } }) => {
    mocks.cookies = options.cookies.getAll();
    return { rpc: mocks.rpc };
  },
}));
vi.mock('next/server', () => ({ connection: mocks.connection }));
vi.mock('next/cache', () => ({ unstable_cache: (fn: unknown) => fn }));

const CONFIGURED = { isConfigured: true, url: 'https://project.supabase.co', key: 'publishable-key' };

describe('수집·거래 기능 공개 스위치 서버 읽기', () => {
  beforeEach(() => {
    mocks.config = { isConfigured: false, url: undefined, key: undefined };
    mocks.rpc.mockReset();
    mocks.connection.mockReset();
  });

  it('Supabase 설정이 없으면 DB 를 부르지 않고 전부 꺼짐이다', async () => {
    await expect(loadCollectibleFeatures()).resolves.toEqual({ binder: false, market: false, exchange: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('쿠키 없는 공개 읽기로 DB 값을 그대로 돌려준다', async () => {
    mocks.config = CONFIGURED;
    mocks.rpc.mockResolvedValue({ data: { binder: true, market: false, exchange: true }, error: null });

    await expect(loadCollectibleFeatures()).resolves.toEqual({ binder: true, market: false, exchange: true });
    expect(mocks.rpc).toHaveBeenCalledWith('get_collectible_features');
    expect(mocks.cookies).toEqual([]);
  });

  it('RPC 오류·예상 밖 모양·통신 실패는 전부 꺼짐이다(fail-closed)', async () => {
    mocks.config = CONFIGURED;
    const off = { binder: false, market: false, exchange: false };
    mocks.rpc.mockResolvedValueOnce({ data: { binder: true, market: true, exchange: true }, error: { message: 'unavailable' } });
    await expect(loadCollectibleFeatures()).resolves.toEqual(off);
    mocks.rpc.mockResolvedValueOnce({ data: { binder: 'true', market: true, exchange: true }, error: null });
    await expect(loadCollectibleFeatures()).resolves.toEqual(off);
    mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    await expect(loadCollectibleFeatures()).resolves.toEqual(off);
    mocks.rpc.mockRejectedValueOnce(new Error('network'));
    await expect(loadCollectibleFeatures()).resolves.toEqual(off);
  });

  it('라우트 판정용 읽기는 요청 시점으로 미룬 뒤 기능별 값을 낸다', async () => {
    mocks.config = CONFIGURED;
    mocks.rpc.mockResolvedValue({ data: { binder: false, market: true, exchange: false }, error: null });

    await expect(readCollectibleFeatures()).resolves.toEqual({ binder: false, market: true, exchange: false });
    expect(mocks.connection).toHaveBeenCalledOnce();
    await expect(isCollectibleFeatureEnabled('market')).resolves.toBe(true);
    await expect(isCollectibleFeatureEnabled('binder')).resolves.toBe(false);
    await expect(isCollectibleFeatureEnabled('exchange')).resolves.toBe(false);
  });
});

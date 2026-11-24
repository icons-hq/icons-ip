import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvePublicGoodAddress } from './goods-address.server';

const mocks = vi.hoisted(() => ({
  configured: true,
  rpc: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: mocks.configured }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

beforeEach(() => {
  mocks.configured = true;
  mocks.rpc.mockReset();
  mocks.createClient.mockReset().mockResolvedValue({ rpc: mocks.rpc });
  vi.stubEnv('ICONS_CATALOG_SOURCE', '');
  vi.stubEnv('VERCEL_ENV', '');
});
afterEach(() => vi.unstubAllEnvs());

/* MD-0051 · ADR-0050 — 상세 주소 끝 값은 상품 자동코드(대소문자 무시)나 옛 내부 id다. DB가 공개 상품 하나의 id·코드만 돌려준다. */
describe('resolvePublicGoodAddress', () => {
  it('끝 값을 DB 해석에 그대로 넘기고 정식 끝 값을 상품 자동코드의 소문자형으로 만든다', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'hongsil-keyring', code: 'HSQ-0059' }], error: null });

    await expect(resolvePublicGoodAddress('HSQ-0059')).resolves.toEqual({ goodId: 'hongsil-keyring', segment: 'hsq-0059' });
    await expect(resolvePublicGoodAddress('hongsil-keyring')).resolves.toEqual({ goodId: 'hongsil-keyring', segment: 'hsq-0059' });
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_public_goods_address', { p_value: 'HSQ-0059' });
    /* 호출자를 보지 않는 공개 조회라 쇼핑 화면 공개 조회 캐시를 쓴다. */
    expect(mocks.createClient).toHaveBeenCalledWith({ storefrontReadCache: true });
  });

  it('주소로 쓸 수 없는 코드의 굿즈는 내부 id 가 정식 끝 값이다', async () => {
    mocks.rpc.mockResolvedValue({ data: [{ id: 'keyring', code: '창고 A-1' }], error: null });
    await expect(resolvePublicGoodAddress('창고 A-1')).resolves.toEqual({ goodId: 'keyring', segment: 'keyring' });
  });

  it('공개 상품이 아니거나 없는 값은 null 이고, 너무 긴 값은 묻지 않는다', async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    await expect(resolvePublicGoodAddress('nope')).resolves.toBeNull();
    mocks.rpc.mockResolvedValue({ data: [{ id: 42, code: 'X' }], error: null });
    await expect(resolvePublicGoodAddress('broken')).resolves.toBeNull();
    mocks.rpc.mockClear();
    await expect(resolvePublicGoodAddress('a'.repeat(201))).resolves.toBeNull();
    await expect(resolvePublicGoodAddress('')).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('조회 실패는 없는 상품으로 접지 않고 던진다', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } });
    await expect(resolvePublicGoodAddress('hsq-0059')).rejects.toThrow('Failed to resolve goods address: timeout');
  });

  it('목업 카탈로그는 코드가 없어 끝 값을 그대로 내부 id 로 넘긴다', async () => {
    mocks.configured = false;
    await expect(resolvePublicGoodAddress('g13')).resolves.toEqual({ goodId: 'g13', segment: 'g13' });
    expect(mocks.createClient).not.toHaveBeenCalled();
  });
});

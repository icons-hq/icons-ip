import { beforeEach, expect, it, vi } from 'vitest';
import { getAdultGoodsAccess } from './adult-goods-access.server';

const mocks = vi.hoisted(() => ({ auth: vi.fn(), kcp: vi.fn(), verification: vi.fn(), rpc: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({ getCurrentAuthState: mocks.auth }));
vi.mock('@/lib/identity/kcp-cert-config', () => ({ adultVerificationEnabledFor: mocks.kcp }));
vi.mock('@/lib/identity/adult-verification-status.server', () => ({ loadMyAdultVerification: mocks.verification }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.kcp.mockReturnValue(true);
  mocks.auth.mockResolvedValue({ user: { id: 'member' } });
  mocks.verification.mockResolvedValue({ status: 'verified' });
  mocks.rpc.mockResolvedValue({ data: { enabled: true, revision: 1 }, error: null });
});

it('기존 노출은 비로그인·미인증에 19 표시를 주고 인증 성인에게만 상세를 연다', async () => {
  expect(await getAdultGoodsAccess()).toBe('full');
  mocks.verification.mockResolvedValue({ status: 'none' });
  expect(await getAdultGoodsAccess()).toBe('masked');
  mocks.auth.mockResolvedValue({ user: null });
  expect(await getAdultGoodsAccess()).toBe('masked');
});

it('모두 숨기거나 설정을 읽지 못하면 성인 인증 상태와 무관하게 숨긴다', async () => {
  mocks.rpc.mockResolvedValue({ data: { enabled: false, revision: 2 }, error: null });
  expect(await getAdultGoodsAccess()).toBe('hidden');
  mocks.auth.mockResolvedValueOnce({ user: null });
  expect(await getAdultGoodsAccess()).toBe('hidden');
  mocks.rpc.mockResolvedValue({ data: null, error: { code: 'failed' } });
  expect(await getAdultGoodsAccess()).toBe('hidden');
});

it('노출로 설정해도 KCP 인증 기능이 닫혀 있으면 상품을 숨긴다', async () => {
  mocks.kcp.mockReturnValue(false);
  expect(await getAdultGoodsAccess()).toBe('hidden');
});

it('해외 신분증을 승인한 회원은 국내 휴대폰 인증이 닫혀 있어도 모든 19금 상품을 이용한다', async () => {
  mocks.kcp.mockReturnValue(false);
  mocks.verification.mockResolvedValue({ status: 'verified', method: 'overseas_manual' });
  expect(await getAdultGoodsAccess()).toBe('full');
});

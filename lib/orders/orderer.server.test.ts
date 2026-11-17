import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  phoneVerificationConfig: vi.fn(),
  readMyVerifiedPhone: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/sms/phone-verification.server', () => ({
  phoneVerificationConfig: mocks.phoneVerificationConfig,
  readMyVerifiedPhone: mocks.readMyVerifiedPhone,
}));

import { loadOrdererInfo } from './orderer.server';

const client = { rpc: vi.fn() };
const verified = { verified: true, maskedPhone: '010-****-5678', reverificationRequired: false };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue(client);
  mocks.phoneVerificationConfig.mockReturnValue({ sender: {}, secret: 's'.repeat(32), allowlist: [] });
  mocks.readMyVerifiedPhone.mockResolvedValue(verified);
});

describe('loadOrdererInfo', () => {
  it('닉네임·프로필 이메일·인증 휴대폰 마스킹 번호를 돌려준다', async () => {
    const info = await loadOrdererInfo({
      user: { email: 'login@example.test' },
      profile: { nickname: '  홍길동  ', email: 'profile@example.test' },
    });
    expect(info).toEqual({ name: '홍길동', email: 'profile@example.test', maskedPhone: '010-****-5678' });
    expect(mocks.readMyVerifiedPhone).toHaveBeenCalledWith(client);
  });

  it('닉네임이 없거나 공백이면 회원이고, 프로필 없음도 회원이다', async () => {
    const user = { email: 'login@example.test' };
    for (const profile of [null, { nickname: null, email: null }, { nickname: '   ', email: null }, { email: null }]) {
      const info = await loadOrdererInfo({ user, profile });
      expect(info.name, JSON.stringify(profile)).toBe('회원');
    }
  });

  it('프로필 이메일이 없거나 공백이면 로그인 이메일을 쓰고, 둘 다 없으면 null이다', async () => {
    expect((await loadOrdererInfo({ user: { email: 'login@example.test' }, profile: { nickname: 'a', email: null } })).email).toBe('login@example.test');
    expect((await loadOrdererInfo({ user: { email: 'login@example.test' }, profile: { nickname: 'a', email: '  ' } })).email).toBe('login@example.test');
    expect((await loadOrdererInfo({ user: { email: 'login@example.test' }, profile: null })).email).toBe('login@example.test');
    expect((await loadOrdererInfo({ user: { email: null }, profile: { nickname: 'a', email: null } })).email).toBeNull();
    expect((await loadOrdererInfo({ user: { email: '' }, profile: { nickname: 'a' } })).email).toBeNull();
  });

  it('휴대폰 인증 스위치가 꺼져 있으면 읽지 않고 null이다', async () => {
    mocks.phoneVerificationConfig.mockReturnValue(null);
    const info = await loadOrdererInfo({ user: { email: 'a@example.test' }, profile: { nickname: 'a', email: 'a@example.test' } });
    expect(info.maskedPhone).toBeNull();
    expect(mocks.readMyVerifiedPhone).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it('미인증·읽기 실패(null)는 번호 없음이다', async () => {
    const auth = { user: { email: 'a@example.test' }, profile: { nickname: 'a', email: null } };
    mocks.readMyVerifiedPhone.mockResolvedValueOnce({ verified: false, maskedPhone: null, reverificationRequired: false });
    expect((await loadOrdererInfo(auth)).maskedPhone).toBeNull();
    mocks.readMyVerifiedPhone.mockResolvedValueOnce({ verified: true, maskedPhone: null, reverificationRequired: false });
    expect((await loadOrdererInfo(auth)).maskedPhone).toBeNull();
    mocks.readMyVerifiedPhone.mockResolvedValueOnce(null);
    expect((await loadOrdererInfo(auth)).maskedPhone).toBeNull();
  });

  it('휴대폰 읽기가 던져도 이름·이메일은 그대로 돌려준다', async () => {
    mocks.readMyVerifiedPhone.mockRejectedValueOnce(new Error('rpc down'));
    expect(await loadOrdererInfo({ user: { email: 'a@example.test' }, profile: { nickname: '길동', email: null } })).toEqual({
      name: '길동',
      email: 'a@example.test',
      maskedPhone: null,
    });
    mocks.createClient.mockRejectedValueOnce(new Error('cookies unavailable'));
    expect((await loadOrdererInfo({ user: { email: 'a@example.test' }, profile: null })).maskedPhone).toBeNull();
  });

  it('로그인 사용자가 없으면 휴대폰을 읽지 않는다', async () => {
    expect(await loadOrdererInfo({ user: null, profile: null })).toEqual({ name: '회원', email: null, maskedPhone: null });
    expect(mocks.readMyVerifiedPhone).not.toHaveBeenCalled();
  });
});

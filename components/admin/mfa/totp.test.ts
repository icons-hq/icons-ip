import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { listTotpFactors, normalizeTotpCode, startTotpEnrollment, verifyTotp } from './totp';

function fakeSupabase(overrides: Record<string, unknown> = {}) {
  const mfa = {
    listFactors: vi.fn().mockResolvedValue({ data: { all: [
      { id: 'v1', factor_type: 'totp', status: 'verified', friendly_name: '휴대폰', created_at: '2026-11-18T01:00:00Z' },
      { id: 'u1', factor_type: 'totp', status: 'unverified', friendly_name: null, created_at: '2026-11-18T02:00:00Z' },
      { id: 'p1', factor_type: 'phone', status: 'verified', created_at: '2026-11-18T03:00:00Z' },
    ] }, error: null }),
    unenroll: vi.fn().mockResolvedValue({ data: {}, error: null }),
    enroll: vi.fn().mockResolvedValue({ data: { id: 'new', type: 'totp', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRET', uri: 'otpauth://x' } }, error: null }),
    challengeAndVerify: vi.fn().mockResolvedValue({ data: {}, error: null }),
    ...overrides,
  };
  return { client: { auth: { mfa } } as unknown as SupabaseClient, mfa };
}

describe('인증 앱 브라우저 흐름', () => {
  it('TOTP만 고르고 상태를 정리한다', async () => {
    const { client } = fakeSupabase();
    const result = await listTotpFactors(client);
    expect(result).toEqual({ ok: true, value: [
      { id: 'v1', friendlyName: '휴대폰', status: 'verified', createdAt: '2026-11-18T01:00:00Z' },
      { id: 'u1', friendlyName: null, status: 'unverified', createdAt: '2026-11-18T02:00:00Z' },
    ] });
  });

  it('끝내지 않은 등록만 지우고 새로 등록한다(확인된 인증 앱은 그대로)', async () => {
    const { client, mfa } = fakeSupabase();
    const listed = await listTotpFactors(client);
    if (!listed.ok) throw new Error('listed');
    const result = await startTotpEnrollment(client, listed.value, new Date('2026-11-18T03:04:05Z'));
    expect(mfa.unenroll.mock.calls).toEqual([[{ factorId: 'u1' }]]);
    expect(mfa.enroll).toHaveBeenCalledWith({ factorType: 'totp', friendlyName: 'ICONS 어드민 2026-11-18 03:04:05', issuer: 'ICONS 어드민' });
    expect(result).toEqual({ ok: true, value: { factorId: 'new', qrCode: 'data:image/svg+xml;utf-8,<svg/>', secret: 'SECRET' } });
  });

  it('GoTrue 거절은 운영자 문구로 바꾼다', async () => {
    const { client } = fakeSupabase({ challengeAndVerify: vi.fn().mockResolvedValue({ data: null, error: { code: 'mfa_verification_failed', message: 'Invalid TOTP code entered' } }) });
    expect(await verifyTotp(client, 'v1', '123456')).toEqual({ ok: false, error: expect.stringContaining('인증 코드가 맞지 않습니다') });
    const enrollOff = fakeSupabase({ enroll: vi.fn().mockResolvedValue({ data: null, error: { code: 'mfa_totp_enroll_not_enabled' } }) });
    expect(await startTotpEnrollment(enrollOff.client, [])).toEqual({ ok: false, error: expect.stringContaining('꺼져 있습니다') });
  });

  it('붙여넣은 코드의 공백·하이픈을 지우고 6자리로 자른다', () => {
    expect(normalizeTotpCode(' 123-456 ')).toBe('123456');
    expect(normalizeTotpCode('1234567')).toBe('123456');
  });
});

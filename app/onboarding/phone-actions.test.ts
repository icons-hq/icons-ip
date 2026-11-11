import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestPhoneCodeAction, verifyPhoneCodeAction } from './phone-actions';

const mocks = vi.hoisted(() => ({
  config: null as unknown,
  getUser: vi.fn(),
  headers: new Map<string, string>(),
  request: vi.fn(),
  revalidatePath: vi.fn(),
  verify: vi.fn(),
}));

vi.mock('@/lib/sms/phone-verification.server', () => ({
  phoneVerificationConfig: () => mocks.config,
  requestPhoneVerificationCode: mocks.request,
  verifyPhoneVerificationCode: mocks.verify,
}));
vi.mock('@/lib/supabase/config', () => ({ getSupabaseConfig: () => ({ isConfigured: true }) }));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: mocks.getUser } }) }));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock('next/headers', () => ({
  headers: async () => ({ get: (name: string) => mocks.headers.get(name.toLowerCase()) ?? null }),
}));

const USER_ID = '00000000-0000-4000-8000-000000000601';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  mocks.config = { sender: {}, secret: 'x'.repeat(32), countries: [] };
  mocks.getUser.mockReset();
  mocks.getUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  mocks.headers = new Map([['x-forwarded-for', '198.51.100.9, 10.0.0.1']]);
  mocks.request.mockReset();
  mocks.verify.mockReset();
  mocks.revalidatePath.mockReset();
});

describe('phone verification actions — 스위치 OFF', () => {
  it('does nothing and reveals nothing when the switch is off', async () => {
    mocks.config = null;

    expect(await requestPhoneCodeAction({}, form({ phoneCountry: 'KR', phone: '01012345678' })))
      .toEqual({ errors: { form: '지금은 휴대폰 번호 인증을 사용할 수 없어요.' } });
    expect(await verifyPhoneCodeAction({}, form({ challengeId: CHALLENGE_ID, code: '123456' })))
      .toEqual({ errors: { form: '지금은 휴대폰 번호 인증을 사용할 수 없어요.' } });
    expect(mocks.getUser).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });
});

describe('phone verification actions — 스위치 ON', () => {
  it('requires a signed-in member', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await requestPhoneCodeAction({}, form({ phone: '01012345678' })))
      .toEqual({ errors: { form: '로그인한 뒤 휴대폰 번호를 인증할 수 있어요.' } });
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('sends a code for the signed-in member with the first forwarded IP and opens the code stage', async () => {
    mocks.request.mockResolvedValue({ ok: true, challengeId: CHALLENGE_ID, maskedPhone: '010-****-5678' });

    expect(await requestPhoneCodeAction({}, form({ phoneCountry: 'KR', phone: '010-1234-5678' }))).toEqual({
      stage: 'code_sent',
      challengeId: CHALLENGE_ID,
      maskedPhone: '010-****-5678',
      message: '010-****-5678로 인증번호를 보냈어요. 5분 안에 입력해주세요.',
    });
    expect(mocks.request).toHaveBeenCalledWith(
      { userId: USER_ID, countryIso: 'KR', phone: '010-1234-5678', ip: '198.51.100.9' },
      { config: mocks.config },
    );
  });

  it('puts phone and form errors where the screen shows them, and survives an unexpected failure', async () => {
    mocks.request.mockResolvedValueOnce({ ok: false, field: 'phone', error: '휴대폰 번호를 다시 확인해주세요.' });
    expect(await requestPhoneCodeAction({}, form({ phone: 'x' }))).toEqual({ errors: { phone: '휴대폰 번호를 다시 확인해주세요.' } });

    mocks.request.mockRejectedValueOnce(new Error('service role missing'));
    expect(await requestPhoneCodeAction({}, form({ phone: '01012345678' })))
      .toEqual({ errors: { form: '인증번호를 보내지 못했어요. 잠시 후 다시 시도해주세요.' } });
  });

  it('completes verification, refreshes onboarding and settings, and echoes the challenge', async () => {
    mocks.verify.mockResolvedValue({ ok: true });

    expect(await verifyPhoneCodeAction({}, form({ challengeId: CHALLENGE_ID, code: '123456', maskedPhone: '010-****-5678' }))).toEqual({
      stage: 'verified',
      challengeId: CHALLENGE_ID,
      maskedPhone: '010-****-5678',
      message: '휴대폰 번호를 인증했어요.',
    });
    expect(mocks.verify).toHaveBeenCalledWith({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '123456' }, { config: mocks.config });
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual(['/onboarding', '/settings']);
  });

  it('keeps the code stage for a wrong code and returns to phone entry when the challenge is over', async () => {
    mocks.verify.mockResolvedValueOnce({ ok: false, field: 'code', error: '인증번호가 맞지 않아요.', restart: false });
    expect(await verifyPhoneCodeAction({}, form({ challengeId: CHALLENGE_ID, code: '000000', maskedPhone: '010-****-5678' }))).toEqual({
      stage: 'code_sent',
      challengeId: CHALLENGE_ID,
      maskedPhone: '010-****-5678',
      errors: { code: '인증번호가 맞지 않아요.' },
    });

    mocks.verify.mockResolvedValueOnce({ ok: false, field: 'form', error: '인증번호를 다시 받아주세요.', restart: true });
    expect(await verifyPhoneCodeAction({}, form({ challengeId: CHALLENGE_ID, code: '000000' }))).toEqual({
      challengeId: CHALLENGE_ID,
      restart: true,
      errors: { form: '인증번호를 다시 받아주세요.' },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

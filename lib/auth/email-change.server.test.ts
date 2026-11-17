import { describe, expect, it, vi } from 'vitest';
import { isUnusableLoginEmail, normalizeEmailInput } from './email-change';
import {
  createConsoleEmailChangeSender,
  notifyPreviousEmail,
  emailChangeCodeDigest,
  emailChangeConfig,
  emailChangeSenderFromProvider,
  renderEmailChangeCodeEmail,
  requestEmailChangeCode,
  verifyEmailChangeCode,
  type EmailChangeConfig,
  type EmailChangeMessage,
} from './email-change.server';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('tests inject the service client');
  },
}));

const SECRET = 'email-dispatch-hmac-test-secret-0123456789';
const USER_ID = '00000000-0000-4000-8000-000000000701';
const CHALLENGE_ID = '22222222-2222-4222-8222-222222222222';
const SESSION_ID = '33333333-3333-4333-8333-333333333333';

function sender(ok = true) {
  const sent: EmailChangeMessage[] = [];
  return { sent, sender: { provider: 'fake', send: vi.fn(async (message: EmailChangeMessage) => { sent.push(message); return ok; }) } };
}

function configWith(emailSender = sender().sender): EmailChangeConfig {
  return { secret: SECRET, sender: emailSender };
}

function service(
  responses: Record<string, { data: unknown; error: unknown }>,
  update: { error: unknown } = { error: null },
  previousEmail: string | null = 'old@privaterelay.appleid.com',
) {
  const rpc = vi.fn(async (name: string) => responses[name] ?? { data: null, error: { message: 'unexpected' } });
  const updateUserById = vi.fn(async () => update);
  const getUserById = vi.fn(async () => ({ data: { user: { email: previousEmail } }, error: null }));
  return { rpc, updateUserById, client: { rpc, auth: { admin: { updateUserById, getUserById } } } as never };
}

describe('isUnusableLoginEmail / normalizeEmailInput', () => {
  it('opens the change only for an empty login email or an Apple private relay address', () => {
    expect(isUnusableLoginEmail('')).toBe(true);
    expect(isUnusableLoginEmail(null)).toBe(true);
    expect(isUnusableLoginEmail('jb7m5nzh4s@privaterelay.appleid.com')).toBe(true);
    expect(isUnusableLoginEmail('JB7@PrivateRelay.AppleID.com')).toBe(true);
    expect(isUnusableLoginEmail('fan@icons.gg')).toBe(false);
    expect(isUnusableLoginEmail('fan@appleid.com')).toBe(false);
  });

  it('lower-cases the new address and refuses relay or malformed addresses', () => {
    expect(normalizeEmailInput('  Fan@Example.COM ')).toEqual({ ok: true, email: 'fan@example.com' });
    expect(normalizeEmailInput('')).toMatchObject({ ok: false });
    expect(normalizeEmailInput('fan@example')).toMatchObject({ ok: false });
    expect(normalizeEmailInput('x@privaterelay.appleid.com')).toEqual({ ok: false, error: '실제로 메일을 받을 수 있는 이메일을 입력해주세요.' });
  });
});

describe('emailChangeConfig', () => {
  it('needs the email dispatch HMAC secret and a mail provider; console only outside Vercel', () => {
    const provider = { send: vi.fn() };
    expect(emailChangeConfig({}, () => provider)).toBeNull();
    expect(emailChangeConfig({ EMAIL_DISPATCH_HMAC_SECRET: 'short' }, () => provider)).toBeNull();
    expect(emailChangeConfig({ EMAIL_DISPATCH_HMAC_SECRET: SECRET }, () => provider)?.sender.provider).toBe('resend');
    expect(emailChangeConfig({ EMAIL_DISPATCH_HMAC_SECRET: SECRET }, () => null)?.sender.provider).toBe('console');
    expect(emailChangeConfig({ EMAIL_DISPATCH_HMAC_SECRET: SECRET, VERCEL_ENV: 'preview' }, () => null)).toBeNull();
  });

  it('opens in production only from the privacy revision effective date (2026-11-18 KST)', () => {
    const provider = () => ({ send: vi.fn() });
    const env = { EMAIL_DISPATCH_HMAC_SECRET: SECRET, VERCEL_ENV: 'production' };
    expect(emailChangeConfig(env, provider, new Date('2026-11-17T14:59:59Z'))).toBeNull();
    expect(emailChangeConfig(env, provider, new Date('2026-11-17T15:00:00Z'))?.sender.provider).toBe('resend');
  });

  it('sends through the Resend provider with an idempotency key bound to the request', async () => {
    const send = vi.fn(async () => ({ kind: 'accepted' as const, providerReference: 're_1' }));
    const mail = emailChangeSenderFromProvider({ send });
    await expect(mail.send({ to: 'fan@example.com', challengeId: CHALLENGE_ID, subject: 's', text: 't', html: 'h' })).resolves.toBe(true);
    expect(send).toHaveBeenCalledWith({
      intentId: CHALLENGE_ID,
      idempotencyKey: `member-email-change:code:${CHALLENGE_ID}`,
      recipient: 'fan@example.com',
      message: { subject: 's', text: 't', html: 'h' },
    });
  });

  it('logs the code locally but masks the address', async () => {
    const write = vi.fn();
    await createConsoleEmailChangeSender(write).send({ to: 'fan@example.com', challengeId: CHALLENGE_ID, ...renderEmailChangeCodeEmail('123456') });
    expect(write).toHaveBeenCalledWith('[email-change:console] to=f***@example.com kind=code text=인증 코드: 123456');
  });
});

describe('requestEmailChangeCode', () => {
  it('records only digests in the DB, then mails the code to the new address', async () => {
    const fake = sender();
    const { rpc, client } = service({ service_issue_member_email_change: { data: { ok: true }, error: null } });

    await expect(requestEmailChangeCode(
      { userId: USER_ID, sessionId: SESSION_ID, email: ' Real@Example.com ', ip: '203.0.113.9' },
      { config: configWith(fake.sender), service: client, newChallengeId: () => CHALLENGE_ID, newCode: () => '482913' },
    )).resolves.toEqual({ ok: true, challengeId: CHALLENGE_ID, email: 'real@example.com' });

    const args = rpc.mock.calls[0][1] as Record<string, unknown>;
    expect(args).toMatchObject({ p_challenge_id: CHALLENGE_ID, p_user_id: USER_ID, p_session_id: SESSION_ID, p_email: 'real@example.com', p_ttl_seconds: 600 });
    expect(args.p_code_digest).toBe(emailChangeCodeDigest(SECRET, CHALLENGE_ID, '482913'));
    expect(JSON.stringify(args)).not.toContain('482913');
    expect(JSON.stringify(args)).not.toContain('203.0.113.9');
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({ to: 'real@example.com', challengeId: CHALLENGE_ID, subject: '[ICONS] 이메일 변경 인증 코드' });
    expect(fake.sent[0].text).toContain('인증 코드: 482913');
  });

  it('maps DB refusals and does not mail anything', async () => {
    const fake = sender();
    const cases: [unknown, Record<string, unknown>][] = [
      [{ ok: false, reason: 'cooldown', retryAfterSeconds: 42 }, { field: 'form', error: '인증 코드 요청이 너무 잦아요. 42초 후 다시 시도해주세요.' }],
      [{ ok: false, reason: 'not_eligible' }, { field: 'form', error: '이 계정은 여기서 이메일을 바꿀 수 없어요.' }],
      [{ ok: false, reason: 'same_email' }, { field: 'email' }],
      [{ ok: false, reason: 'reauthentication_required' }, { field: 'form', error: '보안을 위해 로그아웃했다가 다시 로그인한 뒤 이메일을 바꿔주세요.' }],
    ];
    for (const [data, expected] of cases) {
      const { client } = service({ service_issue_member_email_change: { data, error: null } });
      await expect(requestEmailChangeCode({ userId: USER_ID, sessionId: SESSION_ID, email: 'real@example.com', ip: null }, { config: configWith(fake.sender), service: client }))
        .resolves.toMatchObject({ ok: false, ...expected });
    }
    expect(fake.sent).toHaveLength(0);
  });

  it('closes the request when the mail cannot be sent', async () => {
    const { rpc, client } = service({
      service_issue_member_email_change: { data: { ok: true }, error: null },
      service_fail_member_email_change: { data: true, error: null },
    });
    await expect(requestEmailChangeCode(
      { userId: USER_ID, sessionId: SESSION_ID, email: 'real@example.com', ip: null },
      { config: configWith(sender(false).sender), service: client, newChallengeId: () => CHALLENGE_ID },
    )).resolves.toMatchObject({ ok: false, field: 'form' });
    expect(rpc).toHaveBeenCalledWith('service_fail_member_email_change', { p_challenge_id: CHALLENGE_ID, p_user_id: USER_ID });
  });
});

describe('verifyEmailChangeCode', () => {
  it('changes the login email with the Admin API only after the DB accepted the code', async () => {
    const { rpc, updateUserById, client } = service({ service_verify_member_email_change: { data: { ok: true, email: 'real@example.com' }, error: null } });

    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '482 913' }, { config: configWith(), service: client }))
      .resolves.toEqual({ ok: true, email: 'real@example.com', previousEmail: 'old@privaterelay.appleid.com' });
    expect(rpc).toHaveBeenCalledWith('service_verify_member_email_change', {
      p_challenge_id: CHALLENGE_ID, p_user_id: USER_ID, p_code_digest: emailChangeCodeDigest(SECRET, CHALLENGE_ID, '482913'),
    });
    expect(updateUserById).toHaveBeenCalledWith(USER_ID, { email: 'real@example.com', email_confirm: true });
  });

  it('does not touch the account on a wrong code and keeps the code step open', async () => {
    const { updateUserById, client } = service({ service_verify_member_email_change: { data: { ok: false, reason: 'mismatch', remainingAttempts: 3 }, error: null } });
    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '000000' }, { config: configWith(), service: client }))
      .resolves.toEqual({ ok: false, field: 'code', error: '인증 코드가 맞지 않아요. 3번 더 입력할 수 있어요.', restart: false });
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('tells a proven owner that another account uses the address, from the DB or from Auth', async () => {
    const taken = service({ service_verify_member_email_change: { data: { ok: false, reason: 'email_taken' }, error: null } });
    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '482913' }, { config: configWith(), service: taken.client }))
      .resolves.toMatchObject({ ok: false, restart: true, error: expect.stringContaining('다른 계정이 있어요') });

    const race = service(
      { service_verify_member_email_change: { data: { ok: true, email: 'real@example.com' }, error: null } },
      { error: { code: 'email_exists', message: 'exists' } },
    );
    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '482913' }, { config: configWith(), service: race.client }))
      .resolves.toMatchObject({ ok: false, restart: true, error: expect.stringContaining('다른 계정이 있어요') });
  });

  it('rejects malformed input before the database', async () => {
    const { rpc, client } = service({});
    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: 'nope', code: '123456' }, { config: configWith(), service: client }))
      .resolves.toMatchObject({ ok: false, restart: true });
    await expect(verifyEmailChangeCode({ userId: USER_ID, challengeId: CHALLENGE_ID, code: '12ab' }, { config: configWith(), service: client }))
      .resolves.toMatchObject({ ok: false, field: 'code', restart: false });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('notifyPreviousEmail', () => {
  it('tells the previous address that the account email changed, with a separate idempotency kind', async () => {
    const fake = sender();
    await expect(notifyPreviousEmail(configWith(fake.sender), { previousEmail: 'old@privaterelay.appleid.com', newEmail: 'real@example.com', challengeId: CHALLENGE_ID }))
      .resolves.toBe(true);
    expect(fake.sent[0]).toMatchObject({ to: 'old@privaterelay.appleid.com', challengeId: CHALLENGE_ID, kind: 'changed_notice', subject: '[ICONS] 계정 이메일이 바뀌었어요' });
    expect(fake.sent[0].text).toContain('r***@example.com');
    expect(fake.sent[0].text).not.toContain('real@example.com');
  });

  it('does nothing without a previous address', async () => {
    const fake = sender();
    await expect(notifyPreviousEmail(configWith(fake.sender), { previousEmail: null, newEmail: 'real@example.com', challengeId: CHALLENGE_ID })).resolves.toBe(false);
    expect(fake.sent).toHaveLength(0);
  });
});

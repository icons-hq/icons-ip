import { describe, expect, it, vi } from 'vitest';
import { createConsoleSmsSender, smsSenderFromEnvironment } from './sender.server';

describe('smsSenderFromEnvironment (발송 seam)', () => {
  it('has no sender by default and for providers that are not implemented yet', () => {
    expect(smsSenderFromEnvironment({})).toBeNull();
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: ' ' })).toBeNull();
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'nhncloud' })).toBeNull();
  });

  it('builds the console sender only outside Vercel', () => {
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'console' })?.provider).toBe('console');
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'console', VERCEL: '1' })).toBeNull();
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'console', VERCEL_ENV: 'preview' })).toBeNull();
    expect(smsSenderFromEnvironment({ ICONS_SMS_PROVIDER: 'console', VERCEL_ENV: 'production' })).toBeNull();
  });

  it('writes the text for local testing but masks the recipient', async () => {
    const write = vi.fn();
    const sender = createConsoleSmsSender(write);

    await expect(sender.send({ to: '+821012345678', text: '[ICONS] 인증번호 [123456]', purpose: 'phone_verification' }))
      .resolves.toEqual({ ok: true, providerMessageId: null });
    expect(write).toHaveBeenCalledWith('[sms:console] to=+821****78 purpose=phone_verification text=[ICONS] 인증번호 [123456]');
    expect(write.mock.calls[0][0]).not.toContain('1012345678');
  });
});

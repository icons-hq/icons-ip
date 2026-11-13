import { describe, expect, it, vi } from 'vitest';
import {
  advertisingSmsText,
  isAdvertisingQuietHours,
  sendMemberSms,
  smsNotificationConfig,
  type SmsNotificationConfig,
} from './notifications.server';
import type { SmsMessage } from './sender.server';

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient: () => {
    throw new Error('tests inject the service client');
  },
}));

const USER_ID = '00000000-0000-4000-8000-000000000701';
/* 2026-11-11 14:00 KST */
const DAYTIME = new Date('2026-11-11T05:00:00Z');
/* 2026-11-11 21:30 KST */
const NIGHT = new Date('2026-11-11T12:30:00Z');

function harness(recipient: { data: unknown; error: unknown }, optOut: string | null = '무료수신거부 080-000-0000') {
  const sent: SmsMessage[] = [];
  const config: SmsNotificationConfig = {
    sender: { provider: 'fake', send: vi.fn(async (message: SmsMessage) => { sent.push(message); return { ok: true as const, providerMessageId: 'p-1' }; }) },
    advertisingOptOut: optOut,
  };
  const rpc = vi.fn(async () => recipient);
  return { sent, rpc, deps: { config, service: { rpc } as never } };
}

describe('smsNotificationConfig — 스위치 OFF 기본', () => {
  it('is null unless the switch is exactly true and a sender exists', () => {
    expect(smsNotificationConfig({})).toBeNull();
    expect(smsNotificationConfig({ ICONS_SMS_NOTIFICATIONS_ENABLED: 'true' })).toBeNull();
    expect(smsNotificationConfig({ ICONS_SMS_NOTIFICATIONS_ENABLED: 'true', ICONS_SMS_PROVIDER: 'console' })).toEqual({
      sender: expect.objectContaining({ provider: 'console' }),
      advertisingOptOut: null,
    });
    expect(smsNotificationConfig({ ICONS_SMS_NOTIFICATIONS_ENABLED: 'true', ICONS_SMS_PROVIDER: 'console', VERCEL_ENV: 'production' })).toBeNull();
  });

  it('sends nothing while disabled', async () => {
    expect(await sendMemberSms({ userId: USER_ID, kind: 'transactional', body: '배송을 시작했어요.' }, { config: null }))
      .toEqual({ sent: false, reason: 'disabled' });
  });
});

describe('sendMemberSms', () => {
  it('marks advertising, names the sender and appends the opt-out notice', async () => {
    const h = harness({ data: { ok: true, phoneE164: '+821012345678', smsConsentAgreedAt: '2026-11-01T00:00:00Z' }, error: null });

    expect(await sendMemberSms({ userId: USER_ID, kind: 'advertising', body: '새 굿즈가 나왔어요.', now: DAYTIME }, h.deps))
      .toEqual({ sent: true, providerMessageId: 'p-1' });
    expect(h.rpc).toHaveBeenCalledWith('service_member_sms_recipient', { p_user_id: USER_ID, p_purpose: 'advertising' });
    expect(h.sent).toEqual([{ to: '+821012345678', text: '(광고)ICONS\n새 굿즈가 나왔어요.\n무료수신거부 080-000-0000', purpose: 'advertising' }]);
  });

  it('refuses advertising at night or without an opt-out notice before looking up anyone', async () => {
    const night = harness({ data: { ok: true, phoneE164: '+821012345678' }, error: null });
    expect(await sendMemberSms({ userId: USER_ID, kind: 'advertising', body: '이벤트', now: NIGHT }, night.deps))
      .toEqual({ sent: false, reason: 'quiet_hours' });
    expect(night.rpc).not.toHaveBeenCalled();

    const noOptOut = harness({ data: { ok: true, phoneE164: '+821012345678' }, error: null }, null);
    expect(await sendMemberSms({ userId: USER_ID, kind: 'advertising', body: '이벤트', now: DAYTIME }, noOptOut.deps))
      .toEqual({ sent: false, reason: 'opt_out_missing' });
    expect(noOptOut.rpc).not.toHaveBeenCalled();
  });

  it('sends transactional notices without the advertising marks, at any hour', async () => {
    const h = harness({ data: { ok: true, phoneE164: '+819012345678', smsConsentAgreedAt: null }, error: null });

    expect((await sendMemberSms({ userId: USER_ID, kind: 'transactional', body: '주문하신 굿즈를 보냈어요.', now: NIGHT }, h.deps)).sent).toBe(true);
    expect(h.sent[0]?.text).toBe('[ICONS] 주문하신 굿즈를 보냈어요.');
    expect(h.sent[0]?.text).not.toContain('(광고)');
  });

  it.each(['no_verified_phone', 'consent_required', 'account_unavailable'] as const)('passes the database refusal %s through', async (reason) => {
    const h = harness({ data: { ok: false, reason }, error: null });
    expect(await sendMemberSms({ userId: USER_ID, kind: 'advertising', body: '이벤트', now: DAYTIME }, h.deps)).toEqual({ sent: false, reason });
    expect(h.sent).toEqual([]);
  });

  it('rejects empty or over-long bodies', async () => {
    const h = harness({ data: { ok: true, phoneE164: '+821012345678' }, error: null });
    expect(await sendMemberSms({ userId: USER_ID, kind: 'transactional', body: '  ' }, h.deps)).toEqual({ sent: false, reason: 'invalid_body' });
    expect(await sendMemberSms({ userId: USER_ID, kind: 'transactional', body: 'a'.repeat(1001) }, h.deps)).toEqual({ sent: false, reason: 'invalid_body' });
  });
});

describe('advertising helpers', () => {
  it('treats 21:00–07:59 KST as quiet hours', () => {
    expect(isAdvertisingQuietHours(new Date('2026-11-11T11:59:59Z'))).toBe(false);
    expect(isAdvertisingQuietHours(new Date('2026-11-11T12:00:00Z'))).toBe(true);
    expect(isAdvertisingQuietHours(new Date('2026-11-11T22:59:59Z'))).toBe(true);
    expect(isAdvertisingQuietHours(new Date('2026-11-11T23:00:00Z'))).toBe(false);
  });

  it('builds the advertising text in the legal order', () => {
    expect(advertisingSmsText('본문', '무료수신거부 080')).toBe('(광고)ICONS\n본문\n무료수신거부 080');
  });
});

import { describe, expect, it } from 'vitest';
import { planAuthHookEmails } from './auth-hook';

const USER_ID = '8484b834-f29e-4af2-bf42-80644d154f76';

describe('planAuthHookEmails', () => {
  it('builds a fixed signup message and Supabase verification link', () => {
    const plans = planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '305805',
        token_hash: '7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0',
        token_new: '',
        token_hash_new: '',
        redirect_to: 'https://iconsip.com/auth/callback',
        email_action_type: 'signup',
        site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual(expect.objectContaining({
      source: 'auth_hook',
      sourceReference: `signup:${USER_ID}:7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0:primary`,
      recipient: 'member@example.test',
      messageKind: 'auth_signup',
      contentRevision: 'auth_signup_v1',
    }));
    expect(plans[0].message.subject).toBe('[ICONS] 이메일을 확인해 주세요');
    expect(plans[0].message.html).toContain(
      'https://project.supabase.co/auth/v1/verify?token=7d5b7b1964cf5d388340a7f04f1dbb5eeb6c7b52ef8270e1737a58d0&amp;type=signup&amp;redirect_to=https%3A%2F%2Ficonsip.com%2Fauth%2Fcallback',
    );
    expect(plans[0].message.text).not.toContain('user_metadata');
  });

  it('sends recovery to the dedicated token-hash callback', () => {
    const plans = planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '440011',
        token_hash: 'recovery_token_hash_123',
        token_new: '',
        token_hash_new: '',
        redirect_to: 'https://iconsip.com/auth/recovery/callback',
        email_action_type: 'recovery',
        site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual(expect.objectContaining({
      sourceReference: `recovery:${USER_ID}:recovery_token_hash_123:primary`,
      recipient: 'member@example.test',
      messageKind: 'auth_recovery',
      contentRevision: 'auth_recovery_v1',
    }));
    expect(plans[0].message.html).toContain(
      'https://iconsip.com/auth/recovery/callback?token_hash=recovery_token_hash_123&amp;type=recovery',
    );
    expect(plans[0].message.html).not.toContain('project.supabase.co/auth/v1/verify');
  });

  it('maps secure email change hashes to the correct current and new recipients', () => {
    const plans = planAuthHookEmails({
      user: {
        id: USER_ID,
        email: 'current@example.test',
        new_email: 'new@example.test',
      },
      email_data: {
        token: '111111',
        token_hash: 'hash_for_new_recipient',
        token_new: '222222',
        token_hash_new: 'hash_for_current_recipient',
        redirect_to: 'https://iconsip.com/auth/callback',
        email_action_type: 'email_change',
        site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' });

    expect(plans).toHaveLength(2);
    expect(plans[0]).toEqual(expect.objectContaining({
      recipient: 'current@example.test',
      messageKind: 'auth_email_change_current',
      sourceReference: `email_change:${USER_ID}:hash_for_current_recipient:current`,
    }));
    expect(plans[0].message.html).toContain('token=hash_for_current_recipient');
    expect(plans[0].message.html).not.toContain('hash_for_new_recipient');

    expect(plans[1]).toEqual(expect.objectContaining({
      recipient: 'new@example.test',
      messageKind: 'auth_email_change_new',
      sourceReference: `email_change:${USER_ID}:hash_for_new_recipient:new`,
    }));
    expect(plans[1].message.html).toContain('token=hash_for_new_recipient');
    expect(plans[1].message.html).not.toContain('hash_for_current_recipient');
  });

  it('renders reauthentication as an OTP and never trusts provider subject fields', () => {
    const plans = planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '938201',
        token_hash: 'reauth_hash_1',
        token_new: '',
        token_hash_new: '',
        redirect_to: 'https://iconsip.com/settings',
        email_action_type: 'reauthentication',
        site_url: 'https://iconsip.com',
        subject: 'ATTACKER CONTROLLED SUBJECT',
      },
    }, { supabaseUrl: 'https://project.supabase.co' });

    expect(plans).toHaveLength(1);
    expect(plans[0]).toEqual(expect.objectContaining({
      sourceReference: `reauthentication:${USER_ID}:reauth_hash_1:primary`,
      messageKind: 'auth_reauthentication',
      contentRevision: 'auth_reauthentication_v1',
    }));
    expect(plans[0].message.subject).toBe('[ICONS] 본인 확인 코드');
    expect(plans[0].message.text).toContain('938201');
    expect(plans[0].message.html).not.toContain('ATTACKER CONTROLLED SUBJECT');
  });

  it.each([
    ['unknown action', 'unsupported', 'token_hash'],
    ['missing hash', 'signup', ''],
  ])('rejects %s without producing a partial plan', (_label, action, tokenHash) => {
    expect(() => planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '123456', token_hash: tokenHash, token_new: '', token_hash_new: '',
        redirect_to: 'https://iconsip.com/auth/callback',
        email_action_type: action,
        site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' })).toThrow('invalid_auth_hook_payload');
  });

  it.each([
    ['foreign origin', 'https://evil.example/auth/callback'],
    ['wrong callback path', 'https://iconsip.com/auth/recovery/callback'],
    ['callback query', 'https://iconsip.com/auth/callback?next=https://evil.example'],
    ['callback credentials', 'https://attacker:secret@iconsip.com/auth/callback'],
  ])('rejects a signup %s even when the Hook payload is signed upstream', (_label, redirectTo) => {
    expect(() => planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '123456', token_hash: 'signup_hash', token_new: '', token_hash_new: '',
        redirect_to: redirectTo, email_action_type: 'signup', site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' })).toThrow('invalid_auth_hook_payload');
  });

  it('rejects a recovery token link on an untrusted origin', () => {
    expect(() => planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '123456', token_hash: 'recovery_hash', token_new: '', token_hash_new: '',
        redirect_to: 'https://evil.example/auth/recovery/callback',
        email_action_type: 'recovery', site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' })).toThrow('invalid_auth_hook_payload');
  });

  it('ignores an unused reauthentication redirect instead of turning it into a link', () => {
    const plans = planAuthHookEmails({
      user: { id: USER_ID, email: 'member@example.test' },
      email_data: {
        token: '123456', token_hash: 'reauth_hash', token_new: '', token_hash_new: '',
        redirect_to: 'javascript:ignored', email_action_type: 'reauthentication',
        site_url: 'https://iconsip.com',
      },
    }, { supabaseUrl: 'https://project.supabase.co' });

    expect(plans[0].message.text).not.toContain('javascript:ignored');
    expect(plans[0].message.html).not.toContain('javascript:ignored');
  });
});

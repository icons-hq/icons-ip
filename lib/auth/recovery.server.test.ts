import { describe, expect, it } from 'vitest';

import {
  AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS,
  AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS,
  PASSWORD_RESET_MAX_BUCKETS,
  PASSWORD_RESET_WINDOW_MS,
  authNextStateFromCookie,
  consumePasswordResetAttempt,
  signedAuthNextCookieValue,
} from './recovery.server';

const SECRET = 'test-auth-recovery-secret-with-enough-entropy';
const NOW = Date.parse('2026-07-15T09:00:00.000Z');

function decodePayload(value: string) {
  const [payload, signature, extra] = value.split('.');
  expect(payload).toBeTruthy();
  expect(signature).toBeTruthy();
  expect(extra).toBeUndefined();
  return Buffer.from(payload, 'base64url').toString('utf8');
}

describe('signed auth-next cookie', () => {
  it('round-trips a safe recovery purpose and next path', () => {
    const value = signedAuthNextCookieValue('/community?sort=hot#feed', 'recovery', NOW, SECRET);

    expect(authNextStateFromCookie(value, NOW, SECRET)).toEqual({
      issuedAt: NOW,
      next: '/community?sort=hot#feed',
      purpose: 'recovery',
    });
  });

  it('round-trips oauth state with the signup ten-minute lifetime', () => {
    const value = signedAuthNextCookieValue('/shop?tab=goods', 'oauth', NOW, SECRET);

    expect(authNextStateFromCookie(value, NOW, SECRET)).toEqual({
      issuedAt: NOW,
      next: '/shop?tab=goods',
      purpose: 'oauth',
    });
    expect(authNextStateFromCookie(
      value,
      NOW + AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS * 1000 - 1,
      SECRET,
    )).toMatchObject({ purpose: 'oauth' });
    expect(authNextStateFromCookie(
      value,
      NOW + AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS * 1000,
      SECRET,
    )).toBeNull();
  });

  it('normalizes unsafe next paths before signing', () => {
    const value = signedAuthNextCookieValue('https://evil.example', 'signup', NOW, SECRET);

    expect(authNextStateFromCookie(value, NOW, SECRET)?.next).toBe('/');
  });

  it('rejects tampered, future, and purpose-specific expired payloads', () => {
    const signup = signedAuthNextCookieValue('/shop', 'signup', NOW, SECRET);
    const recovery = signedAuthNextCookieValue('/shop', 'recovery', NOW, SECRET);

    expect(authNextStateFromCookie(`${signup}tampered`, NOW, SECRET)).toBeNull();
    expect(authNextStateFromCookie(signup, NOW - 1, SECRET)).toBeNull();
    expect(authNextStateFromCookie(
      signup,
      NOW + AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS * 1000,
      SECRET,
    )).toBeNull();
    expect(authNextStateFromCookie(
      recovery,
      NOW + AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS * 1000 - 1,
      SECRET,
    )).toMatchObject({ purpose: 'recovery' });
    expect(authNextStateFromCookie(
      recovery,
      NOW + AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS * 1000,
      SECRET,
    )).toBeNull();
  });
});

describe('password-reset browser rate state', () => {
  it('allows three attempts for one normalized email and blocks the fourth', () => {
    let cookieValue: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const consumed = consumePasswordResetAttempt(cookieValue, ' Fan@Icons.gg ', NOW, SECRET);
      expect(consumed).toMatchObject({ blocked: false, attemptCount: attempt });
      cookieValue = consumed.cookieValue;
    }

    const blocked = consumePasswordResetAttempt(cookieValue, 'fan@icons.gg', NOW, SECRET);
    expect(blocked).toMatchObject({ blocked: true, attemptCount: 3 });
  });

  it('keeps independent email buckets without allowing A to reset through B', () => {
    let cookieValue: string | undefined;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      cookieValue = consumePasswordResetAttempt(cookieValue, 'a@icons.gg', NOW, SECRET).cookieValue;
    }

    const emailB = consumePasswordResetAttempt(cookieValue, 'b@icons.gg', NOW, SECRET);
    expect(emailB).toMatchObject({ blocked: false, attemptCount: 1 });

    const emailAAgain = consumePasswordResetAttempt(emailB.cookieValue, 'a@icons.gg', NOW, SECRET);
    expect(emailAAgain).toMatchObject({ blocked: true, attemptCount: 3 });
  });

  it('does not store the raw email in the signed payload', () => {
    const consumed = consumePasswordResetAttempt(undefined, 'Fan@Icons.gg', NOW, SECRET);
    const payload = decodePayload(consumed.cookieValue);

    expect(payload).not.toContain('Fan@Icons.gg');
    expect(payload).not.toContain('fan@icons.gg');
  });

  it('ignores tampered state and starts a fresh bucket', () => {
    const initial = consumePasswordResetAttempt(undefined, 'fan@icons.gg', NOW, SECRET);
    const consumed = consumePasswordResetAttempt(`${initial.cookieValue}tampered`, 'fan@icons.gg', NOW, SECRET);

    expect(consumed).toMatchObject({ blocked: false, attemptCount: 1 });
  });

  it('starts a fresh window after ten minutes', () => {
    let cookieValue: string | undefined;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      cookieValue = consumePasswordResetAttempt(cookieValue, 'fan@icons.gg', NOW, SECRET).cookieValue;
    }

    const consumed = consumePasswordResetAttempt(
      cookieValue,
      'fan@icons.gg',
      NOW + PASSWORD_RESET_WINDOW_MS,
      SECRET,
    );

    expect(consumed).toMatchObject({ blocked: false, attemptCount: 1 });
  });

  it('caps active email buckets before the cookie can grow past browser limits', () => {
    let cookieValue: string | undefined;

    for (let index = 0; index < PASSWORD_RESET_MAX_BUCKETS; index += 1) {
      const consumed = consumePasswordResetAttempt(
        cookieValue,
        `fan-${index}@icons.gg`,
        NOW,
        SECRET,
      );
      expect(consumed.blocked).toBe(false);
      cookieValue = consumed.cookieValue;
    }

    const blocked = consumePasswordResetAttempt(
      cookieValue,
      'one-more@icons.gg',
      NOW,
      SECRET,
    );

    expect(blocked).toMatchObject({ blocked: true, attemptCount: 0 });
    expect(blocked.cookieValue).toBe(cookieValue);
    expect(blocked.cookieValue.length).toBeLessThan(4096);
  });
});

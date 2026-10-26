import { describe, expect, it, vi } from 'vitest';

import {
  AUTH_NEXT_RECOVERY_MAX_AGE_SECONDS,
  AUTH_NEXT_SIGNUP_MAX_AGE_SECONDS,
  AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS,
  PASSWORD_RESET_MAX_BUCKETS,
  PASSWORD_RESET_WINDOW_MS,
  authNextStateFromCookie,
  consumePasswordResetAttempt,
  hasEmailIdentity,
  hasPasswordRecoveryProof,
  passwordRecoveryProofCookieOptions,
  passwordRecoveryProofFromCookie,
  passwordUpdateAccess,
  signedAuthNextCookieValue,
  signedPasswordRecoveryProofValue,
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

describe('password recovery proof', () => {
  const proof = { sessionId: 'session-1', userId: 'user-1' };

  function claimsReader(claims: Record<string, unknown> | null, error: unknown = null) {
    return {
      auth: {
        getClaims: vi.fn(async () => ({ data: claims ? { claims } : null, error })),
      },
    };
  }

  it('round-trips the recovered user and session for fifteen minutes only', () => {
    const value = signedPasswordRecoveryProofValue(proof, NOW, SECRET);
    const lastValidMs = NOW + AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS * 1000 - 1;

    expect(AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS).toBe(15 * 60);
    expect(passwordRecoveryProofFromCookie(value, NOW, SECRET)).toEqual({ issuedAt: NOW, ...proof });
    expect(passwordRecoveryProofFromCookie(value, lastValidMs, SECRET)).toEqual({ issuedAt: NOW, ...proof });
    expect(passwordRecoveryProofFromCookie(value, lastValidMs + 1, SECRET)).toBeNull();
  });

  it('rejects tampered, foreign-domain, future, or unsigned proofs', () => {
    const value = signedPasswordRecoveryProofValue(proof, NOW, SECRET);
    const [payload, signature] = value.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ issuedAt: NOW, sessionId: 'attacker', userId: 'user-1' }))
      .toString('base64url');

    expect(passwordRecoveryProofFromCookie(`${forgedPayload}.${signature}`, NOW, SECRET)).toBeNull();
    expect(passwordRecoveryProofFromCookie(`${payload}.${signature}`, NOW, 'another-secret')).toBeNull();
    expect(passwordRecoveryProofFromCookie(value, NOW, null)).toBeNull();
    expect(passwordRecoveryProofFromCookie(value, NOW - 1, SECRET)).toBeNull();
    // 같은 비밀값으로 서명된 recovery next 쿠키를 증명으로 바꿔 쓸 수 없다(서명 도메인 분리).
    expect(passwordRecoveryProofFromCookie(
      signedAuthNextCookieValue('/settings', 'recovery', NOW, SECRET),
      NOW,
      SECRET,
    )).toBeNull();
  });

  it('scopes the proof cookie to the password update page', () => {
    expect(passwordRecoveryProofCookieOptions(true)).toEqual({
      httpOnly: true,
      maxAge: AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS,
      path: '/update-password',
      sameSite: 'lax',
      secure: true,
    });
  });

  it('accepts only the verified session that passed the recovery callback', async () => {
    const value = signedPasswordRecoveryProofValue(proof, NOW, SECRET);

    await expect(hasPasswordRecoveryProof(
      claimsReader({ sub: 'user-1', session_id: 'session-1' }),
      value,
      NOW,
      SECRET,
    )).resolves.toBe(true);
    await expect(hasPasswordRecoveryProof(
      claimsReader({ sub: 'user-1', session_id: 'password-login-session' }),
      value,
      NOW,
      SECRET,
    )).resolves.toBe(false);
    await expect(hasPasswordRecoveryProof(
      claimsReader({ sub: 'user-2', session_id: 'session-1' }),
      value,
      NOW,
      SECRET,
    )).resolves.toBe(false);
    await expect(hasPasswordRecoveryProof(
      claimsReader(null, { code: 'session_not_found' }),
      value,
      NOW,
      SECRET,
    )).resolves.toBe(false);
  });

  it('does not read claims when there is no valid proof cookie', async () => {
    const reader = claimsReader({ sub: 'user-1', session_id: 'session-1' });

    await expect(hasPasswordRecoveryProof(reader, undefined, NOW, SECRET)).resolves.toBe(false);
    await expect(hasPasswordRecoveryProof(
      reader,
      signedPasswordRecoveryProofValue(proof, NOW - AUTH_RECOVERY_PROOF_MAX_AGE_SECONDS * 1000, SECRET),
      NOW,
      SECRET,
    )).resolves.toBe(false);
    expect(reader.auth.getClaims).not.toHaveBeenCalled();
  });
});

describe('password update access', () => {
  const proof = signedPasswordRecoveryProofValue({ sessionId: 'session-1', userId: 'user-1' }, NOW, SECRET);

  function claimsReader() {
    return {
      auth: {
        getClaims: vi.fn(async () => ({ data: { claims: { sub: 'user-1', session_id: 'session-1' } }, error: null })),
      },
    };
  }

  it('treats only accounts with an email identity as able to hold a password', () => {
    expect(hasEmailIdentity({ identities: [{ provider: 'email' }] })).toBe(true);
    expect(hasEmailIdentity({ identities: [{ provider: 'kakao' }, { provider: 'email' }] })).toBe(true);
    expect(hasEmailIdentity({ identities: [{ provider: 'kakao' }] })).toBe(false);
    expect(hasEmailIdentity({ identities: [{ provider: 'google' }, { provider: 'apple' }] })).toBe(false);
    expect(hasEmailIdentity({ identities: [] })).toBe(false);
    expect(hasEmailIdentity({})).toBe(false);
  });

  it('refuses a social-only account even with a valid recovery proof, without reading claims', async () => {
    const reader = claimsReader();

    await expect(passwordUpdateAccess(reader, { identities: [{ provider: 'kakao' }] }, proof, NOW, SECRET))
      .resolves.toBe('no_email_identity');
    expect(reader.auth.getClaims).not.toHaveBeenCalled();
  });

  it('requires the recovery proof for email and linked accounts', async () => {
    const linked = { identities: [{ provider: 'email' }, { provider: 'kakao' }] };

    await expect(passwordUpdateAccess(claimsReader(), linked, proof, NOW, SECRET)).resolves.toBe('allowed');
    await expect(passwordUpdateAccess(claimsReader(), linked, undefined, NOW, SECRET))
      .resolves.toBe('recovery_required');
  });
});

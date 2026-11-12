import { describe, expect, it } from 'vitest';
import { isPasswordSessionAccessToken } from './session-amr';

function token(payload: unknown) {
  return `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

function amr(...methods: string[]) {
  return token({ sub: 'user-1', amr: methods.map((method) => ({ method, timestamp: 1 })) });
}

/*
 * 리뷰 F1 — 운영 Auth는 AMR otp·magiclink·recovery 세션에 '현재 비밀번호 요구' 가드를 면제한다.
 * 가입 확인 코드 뒤에 브라우저에 주는 세션은 비밀번호 로그인(password)만으로 만든 것이어야 한다.
 */
describe('isPasswordSessionAccessToken', () => {
  it('accepts a session made only by a password sign-in', () => {
    expect(isPasswordSessionAccessToken(amr('password'))).toBe(true);
  });

  it('refuses sessions the password-update guard exempts', () => {
    expect(isPasswordSessionAccessToken(amr('otp'))).toBe(false);
    expect(isPasswordSessionAccessToken(amr('magiclink'))).toBe(false);
    expect(isPasswordSessionAccessToken(amr('recovery'))).toBe(false);
    expect(isPasswordSessionAccessToken(amr('password', 'otp'))).toBe(false);
    expect(isPasswordSessionAccessToken(amr('oauth'))).toBe(false);
  });

  it('refuses tokens without a readable AMR', () => {
    expect(isPasswordSessionAccessToken(undefined)).toBe(false);
    expect(isPasswordSessionAccessToken(null)).toBe(false);
    expect(isPasswordSessionAccessToken('')).toBe(false);
    expect(isPasswordSessionAccessToken('not-a-jwt')).toBe(false);
    expect(isPasswordSessionAccessToken('header.%%%.signature')).toBe(false);
    expect(isPasswordSessionAccessToken(token({ sub: 'user-1' }))).toBe(false);
    expect(isPasswordSessionAccessToken(token({ sub: 'user-1', amr: [] }))).toBe(false);
    expect(isPasswordSessionAccessToken(token({ sub: 'user-1', amr: ['password'] }))).toBe(false);
    expect(isPasswordSessionAccessToken(token(null))).toBe(false);
  });

  it('reads base64url payloads that need padding and carry non-ASCII claims', () => {
    expect(isPasswordSessionAccessToken(token({ sub: 'user-12', name: '팬', amr: [{ method: 'password', timestamp: 1 }] }))).toBe(true);
  });
});

/*
 * 로그인 이메일이 실제 메일을 받을 수 없는 주소인 회원의 이메일 변경(2026-11-17 사용자 결정 '도메인 등록 + 선택 변경').
 *
 * Apple 로그인에서 '이메일 가리기'를 고르면 <임의>@privaterelay.appleid.com 릴레이 주소가 온다. 우리 발신 도메인을 Apple에
 * 등록하면 이 주소로도 메일이 전달되지만(런북 §12), 원하는 회원은 온보딩·설정에서 다른 이메일로 바꿀 수 있다(선택).
 * 이메일이 아예 없는 계정은 온보딩을 마칠 수 없으므로(isOnboarded) 그때만 필수다. 화면·서버·DB가 같은 규칙을 쓴다 —
 * DB 쪽은 private.member_login_email_unusable(supabase/migrations/20261117180100_member_email_change.sql).
 */

export const APPLE_PRIVATE_RELAY_DOMAIN = 'privaterelay.appleid.com';
export const EMAIL_CHANGE_CODE_LENGTH = 6;
export const EMAIL_CHANGE_CODE_TTL_SECONDS = 10 * 60;

export function isAppleRelayEmail(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(`@${APPLE_PRIVATE_RELAY_DOMAIN}`);
}

/** 로그인 이메일이 비었거나 Apple 이메일 가리기 릴레이 주소다 — 이메일 변경을 연다. */
export function isUnusableLoginEmail(email: string | null | undefined): boolean {
  return !email?.trim() || isAppleRelayEmail(email);
}

export type NormalizedEmailInput = { ok: true; email: string } | { ok: false; error: string };

/** 새 이메일 입력을 소문자·공백 없는 모양으로 맞춘다. DB 검사와 같은 모양(앞·뒤 공백 없음, @ 하나, 점 있는 도메인). */
export function normalizeEmailInput(value: unknown): NormalizedEmailInput {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email) return { ok: false, error: '바꿀 이메일을 입력해주세요.' };
  if (email.length < 6 || email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: '이메일 형식을 확인해주세요.' };
  }
  if (isAppleRelayEmail(email)) return { ok: false, error: '실제로 메일을 받을 수 있는 이메일을 입력해주세요.' };
  return { ok: true, email };
}

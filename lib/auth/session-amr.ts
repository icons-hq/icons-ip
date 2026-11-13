/*
 * 세션의 인증 방식(JWT amr) 판정. 운영 Auth는 recovery·magic link·OTP(amr otp) 세션에 '현재 비밀번호 요구' 가드를
 * 면제한다(docs/runbooks/supabase-auth-password-update-guards.md). 가입 확인 코드로 만든 세션도 otp라, 앱은 그런 세션을
 * 브라우저에 주지 않고 비밀번호 로그인 세션(amr password)으로 바꾼다(1014-004, 리뷰 F1).
 *
 * 방금 GoTrue에서 받은 토큰의 payload만 읽는다 — 서명 검증은 하지 않으므로 받은 토큰의 판정에만 쓴다.
 */

function decodeJwtPayload(token: string): unknown {
  const part = token.split('.')[1];
  if (!part) return null;
  const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** AMR이 비밀번호 로그인 하나뿐인지. 가드 면제 방식(otp·magiclink·recovery)이 섞이거나 읽을 수 없으면 false. */
export function isPasswordSessionAccessToken(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  try {
    const payload = decodeJwtPayload(accessToken) as { amr?: unknown } | null;
    if (!payload || !Array.isArray(payload.amr) || payload.amr.length === 0) return false;
    const methods = payload.amr.map((entry) => (entry && typeof entry === 'object' ? (entry as { method?: unknown }).method : null));
    return methods.every((method) => method === 'password');
  } catch {
    return false;
  }
}

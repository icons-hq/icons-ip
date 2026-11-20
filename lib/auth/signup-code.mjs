// Supabase Auth의 이메일 OTP 길이는 프로젝트마다 6~10자리다. 발급된 문자열의 앞쪽 0도 그대로 보낸다.
export const MAX_SIGNUP_CODE_LENGTH = 10;

/** @param {number} length */
export function supportsSignupCodeLength(length) {
  return Number.isInteger(length) && length >= 6 && length <= MAX_SIGNUP_CODE_LENGTH;
}

/** @param {string} code */
export function isSignupCode(code) {
  return supportsSignupCodeLength(code.length) && /^[0-9]+$/.test(code);
}

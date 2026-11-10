export const EXPORT_PASSWORD_MIN_LENGTH = 4;
export const EXPORT_PASSWORD_MAX_LENGTH = 16;
export const EXPORT_PASSWORD_HINT = `${EXPORT_PASSWORD_MIN_LENGTH}~${EXPORT_PASSWORD_MAX_LENGTH}자의 영문 대소문자·숫자·기호를 사용해주세요. 공백은 사용할 수 없습니다.`;

/** No trimming or normalization: Excel must receive the exact password entered. */
export function exportPasswordError(password: unknown, confirmation: unknown): string | null {
  if (typeof password !== 'string'
    || password.length < EXPORT_PASSWORD_MIN_LENGTH
    || password.length > EXPORT_PASSWORD_MAX_LENGTH
    || !/^[\x21-\x7e]+$/.test(password)) return EXPORT_PASSWORD_HINT;
  if (password !== confirmation) return '비밀번호가 일치하지 않습니다. 다시 입력해주세요.';
  return null;
}

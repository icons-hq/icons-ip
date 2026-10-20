export const EXPORT_PASSWORD_HINT = '12~64자의 영문 대소문자·숫자·기호를 사용해주세요. 공백은 사용할 수 없습니다.';

/** No trimming or normalization: Excel must receive the exact password entered. */
export function exportPasswordError(password: unknown, confirmation: unknown): string | null {
  if (typeof password !== 'string' || !/^[\x21-\x7e]{12,64}$/.test(password)) return EXPORT_PASSWORD_HINT;
  if (password !== confirmation) return '비밀번호가 일치하지 않습니다. 다시 입력해주세요.';
  return null;
}

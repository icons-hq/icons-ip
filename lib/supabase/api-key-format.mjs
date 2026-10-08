/* Supabase는 legacy anon·service_role JWT 키를 2026년 말까지 폐기한다. 배포 경로는
 * 새 publishable(`sb_publishable_…`)·secret(`sb_secret_…`) 키만 받는다.
 * Management API가 reveal 없이 돌려주는 secret 키는 `·`로 마스킹되므로 형식 검사에서 걸러진다. */

const PUBLISHABLE_KEY = /^sb_publishable_[A-Za-z0-9_-]+$/;
const SECRET_KEY = /^sb_secret_[A-Za-z0-9_-]+$/;

export function isSupabasePublishableKey(value) {
  return typeof value === 'string' && PUBLISHABLE_KEY.test(value.trim());
}

export function isSupabaseSecretKey(value) {
  return typeof value === 'string' && SECRET_KEY.test(value.trim());
}

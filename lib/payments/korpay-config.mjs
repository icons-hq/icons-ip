const KORPAY_MID_PATTERN = /^[A-Za-z0-9]{10}$/;
const KORPAY_KEY_PATTERN = /^(?=.{32,256}$)[A-Za-z0-9+/]+={0,2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const KORPAY_PRODUCTION_SITE_ORIGIN = 'https://iconsip.com';

export function isKorpayMerchantId(value) {
  return typeof value === 'string' && KORPAY_MID_PATTERN.test(value);
}

export function isKorpayMerchantKey(value) {
  return typeof value === 'string' && KORPAY_KEY_PATTERN.test(value);
}

export function isKorpayUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function normalizeKorpaySiteUrl(value, { production = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    const localHttp = url.protocol === 'http:'
      && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
    if (
      (url.protocol !== 'https:' && !localHttp)
      || url.username
      || url.password
      || url.pathname !== '/'
      || url.search
      || url.hash
    ) return null;
    if (production && url.origin !== KORPAY_PRODUCTION_SITE_ORIGIN) return null;
    return url.origin;
  } catch {
    return null;
  }
}

// 나이스페이(NICEPAY 웹표준) 자격 증명 형식. 빌드 스크립트(scripts/check-vercel-build-env.mjs)와
// 런타임 게이트가 같은 정규식을 공유하도록 korpay-config.mjs·toss-config.mjs와 같은 이유로
// .mjs로 둔다. 근거: developers.nicepay.co.kr(2026-08-03 개편본) — 결제창 요청 MID는 10byte,
// MerchantKey는 가맹점관리자(npg.nicepay.co.kr) "가맹점정보 > KEY관리"에서 확인하는 값이다.
// 문서는 MerchantKey의 문자 집합을 규정하지 않는다. 발급 키는 base64 문자열로 내려오므로
// base64 문자 집합·길이만 강제하고, 그 이상 좁히지 않는다(유효한 키가 침묵 차단된다).
const NICEPAY_MID_PATTERN = /^[A-Za-z0-9]{10}$/;
const NICEPAY_MERCHANT_KEY_PATTERN = /^(?=.{32,256}$)[A-Za-z0-9+/]+={0,2}$/;

// 승인(NextAppURL)·망취소(NetCancelURL)는 인증 응답이 dc1 또는 dc2 도메인으로 준다(결제창
// 호출하기 4절). 브라우저가 실어 온 URL이라 그대로 믿지 않는다 — 문서가 밝힌 호스트·경로만
// 허용한다(SSRF·키 유출 방지). 취소·거래조회는 문서가 고정 URL을 준다.
export const NICEPAY_CALLBACK_API_HOSTS = Object.freeze(['dc1-api.nicepay.co.kr', 'dc2-api.nicepay.co.kr']);
export const NICEPAY_APPROVE_PATH = '/webapi/pay_process.jsp';
export const NICEPAY_NET_CANCEL_PATH = '/webapi/cancel_process.jsp';
export const NICEPAY_CANCEL_URL = 'https://pg-api.nicepay.co.kr/webapi/cancel_process.jsp';
export const NICEPAY_INQUIRY_URL = 'https://webapi.nicepay.co.kr/webapi/inquery/trans_status.jsp';

export function isNicepayMerchantId(value) {
  return typeof value === 'string' && NICEPAY_MID_PATTERN.test(value);
}

export function isNicepayMerchantKey(value) {
  return typeof value === 'string' && NICEPAY_MERCHANT_KEY_PATTERN.test(value);
}

/** 인증 응답의 NextAppURL·NetCancelURL이 문서가 밝힌 나이스페이 API 주소인지. */
export function isNicepayCallbackApiUrl(value, path) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 255) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && (url.port === '' || url.port === '443')
      && NICEPAY_CALLBACK_API_HOSTS.includes(url.hostname)
      && url.pathname === path
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

// 토스페이먼츠 주문서형(구 결제위젯) v2 연동 키 형식. 빌드 스크립트
// (scripts/check-vercel-build-env.mjs)와 런타임 게이트가 같은 정규식을 공유하도록
// korpay-config.mjs와 같은 이유로 .mjs로 둔다.
// 키 체계 근거: docs.tosspayments.com/reference/using-api/api-keys — 주문서형·결제창형
// 연동 키는 클라이언트 gck / 시크릿 gsk 쌍이고 test_/live_ 접두사가 모드를 가른다.
// 공식 계약이 규정하는 것은 접두사뿐이고 그 뒤 문자집합은 무규정이다 — 문서가
// 게시한 test_gsk_docs_OaPz8L5KdmQXkzRz3y47BMw6조차 밑줄을 쓰므로, 접두사만
// 강제하고 suffix는 밑줄을 포함한 넉넉한 집합으로 둔다. 여기서 좁히면 유효한
// 발급 키가 침묵 차단된다.
const TOSS_CLIENT_KEY_PATTERN = /^(test|live)_gck_[A-Za-z0-9_]{8,128}$/;
const TOSS_SECRET_KEY_PATTERN = /^(test|live)_gsk_[A-Za-z0-9_]{8,128}$/;
// provider로 나가는 주문번호(굿즈 O·티켓 T 접두 + 32 hex)의 wire 계약. 어댑터·
// 콜백 파서·클라이언트 payload 검증이 같은 형식을 봐야 한다 — 사본이 갈라지면
// 결제 콜백이 조용히 깨진다.
const TOSS_PROVIDER_ORDER_ID_PATTERN = /^[OT][0-9a-f]{32}$/i;
// 개발자센터 문서에 박힌 공개 테스트 키(`test_gck_docs_…`/`test_gsk_docs_…`). 전자결제
// 신청 전 연동 시연용이라 결제내역·웹훅이 우리 상점에 남지 않는다(공식문서 122
// /reference/using-api/api-keys, 123 /reference/using-api/authorization).
const TOSS_DOCS_PUBLIC_KEY_PATTERN = /^test_g[cs]k_docs_/;

/**
 * 우리 결제를 처리하는 토스 상점아이디(MID) 허용 목록. Payment 객체의 `mId`가 여기
 * 없으면 어댑터는 그 결제를 승인·취소 확정·실패 판정 근거로 쓰지 않는다
 * (lib/payments/toss-gateway.server.ts — needs_review `provider_merchant_mismatch`).
 *
 * 단일 값이 아니라 목록인 이유: 결제서비스와 MID는 1:1이라 브랜드페이·해외 간편결제를
 * 계약하면 같은 주문서형 연동 키 아래 MID가 따로 발급된다(공식문서 24
 * /guides/v2/payment-widget/admin, 122). 목록에 MID를 더하는 것은 그 결제서비스의
 * 정산·취소 계약을 받아들인다는 결정이라 env가 아니라 코드 리뷰를 거치는 상수로 둔다.
 * 현재 값은 국내 일반결제 MID 하나다.
 */
export const TOSS_ALLOWED_MERCHANT_IDS = Object.freeze(['iconsi0xvd']);

/** Payment.mId가 허용된 상점아이디인지(문서 129 /reference#payment-객체: 최대 14자). */
export function isTossAllowedMerchantId(value) {
  return typeof value === 'string' && TOSS_ALLOWED_MERCHANT_IDS.includes(value);
}

/**
 * 문서 공개 테스트 키인지. 이 키의 결제는 우리 상점(MID) 결제가 아니므로 런타임 MID
 * 대조에서 전부 needs_review가 된다 — 빌드 readback이 Production에서 경고한다.
 */
export function isTossDocsPublicKey(value) {
  return typeof value === 'string' && TOSS_DOCS_PUBLIC_KEY_PATTERN.test(value.trim());
}

export function isTossClientKey(value) {
  return typeof value === 'string' && TOSS_CLIENT_KEY_PATTERN.test(value);
}

export function isTossSecretKey(value) {
  return typeof value === 'string' && TOSS_SECRET_KEY_PATTERN.test(value);
}

/** provider 주문번호가 wire 계약 형식인지. */
export function isTossProviderOrderId(value) {
  return typeof value === 'string' && TOSS_PROVIDER_ORDER_ID_PATTERN.test(value);
}

/** 유효한 위젯 키의 모드('test' | 'live')를 돌려주고, 형식 밖이면 null. */
export function tossKeyMode(value) {
  if (typeof value !== 'string') return null;
  if (TOSS_CLIENT_KEY_PATTERN.test(value) || TOSS_SECRET_KEY_PATTERN.test(value)) {
    return value.startsWith('live_') ? 'live' : 'test';
  }
  return null;
}

/**
 * 클라이언트/시크릿 키가 모두 유효한 위젯 키이면서 같은 모드인지. 테스트 클라이언트
 * 키로 띄운 결제를 라이브 시크릿 키로 승인하는 반쪽 전환을 빌드·런타임 양쪽에서 막는다.
 */
export function isTossKeyPairAligned(clientKey, secretKey) {
  const clientMode = isTossClientKey(clientKey) ? tossKeyMode(clientKey) : null;
  const secretMode = isTossSecretKey(secretKey) ? tossKeyMode(secretKey) : null;
  return clientMode !== null && clientMode === secretMode;
}

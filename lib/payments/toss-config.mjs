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

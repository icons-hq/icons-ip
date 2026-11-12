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
// 신청 전 연동 시연용이라 결제내역·웹훅이 우리 상점에 남지 않는다
// (/reference/using-api/api-keys, /reference/using-api/authorization).
const TOSS_DOCS_PUBLIC_KEY_PATTERN = /^test_g[cs]k_docs_/;

/**
 * 결제 UI 바인딩을 켜는 서버 env. 값은 결제 어드민에서 만든 결제 UI의 variantKey다
 * (런북이 정한 이름은 TOSS_ICONS_WIDGET_VARIANT_KEY = `ICONS`).
 *
 * `NEXT_PUBLIC_`을 붙이지 않는다. variantKey 자체는 비밀이 아니고 브라우저 SDK
 * `renderPaymentMethods({ variantKey })`의 파라미터라 공개 env도 문서상 허용되지만
 * (/sdk/v2/js/payment-widget — 시크릿 키만 브라우저 금지), 클라이언트 키처럼 서버 prepare가
 * 일회성 payload에 실어 보내고 서버의 상점(MID) 대조와 한 출처에서 읽어야 위젯과 판정이
 * 갈라지지 않는다. 또 Production에 남아 있는 구 연동 env `NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY`
 * (값 미상, 현행 코드는 읽지 않는다 — TOSS_LEGACY_VARIANT_ENV_NAME)와 이름이 겹치지 않게 새
 * 이름을 쓴다.
 */
export const TOSS_WIDGET_VARIANT_ENV_NAME = 'TOSS_WIDGET_VARIANT_KEY';

/** 알리페이 등 나중에 계약하는 상점아이디(MID)를 코드 배포 없이 허용 목록에 더하는 서버 env. */
export const TOSS_ADDITIONAL_MERCHANT_IDS_ENV_NAME = 'TOSS_ADDITIONAL_MERCHANT_IDS';

/** 구 토스 연동이 쓰던 variant env — 현행 코드는 읽지 않는다. 남아 있으면 빌드가 경고한다. */
export const TOSS_LEGACY_VARIANT_ENV_NAME = 'NEXT_PUBLIC_TOSS_PAYMENT_METHOD_VARIANT_KEY';

/**
 * ICONS 전용 결제 UI의 variantKey(런북 `docs/runbooks/toss-production-rollout.md`가 결제
 * 어드민에 만들게 하는 이름). 코드는 이 값을 강제하지 않는다 — 실제로 쓰는 값은
 * TOSS_WIDGET_VARIANT_KEY env다.
 */
export const TOSS_ICONS_WIDGET_VARIANT_KEY = 'ICONS';

/**
 * SDK 기본 결제 UI. 우리 계정의 `DEFAULT`는 다른 서비스와 함께 쓰는 구 MID(`gsangwbzqu`,
 * 테스트 `tgsangwbzqu`)에 연결돼 있어(2026-10-12 결제 어드민 실측) 바꾸지 않는다. 바인딩 env에
 * 이 값을 넣으면 MID 대조가 모든 결제를 격리하므로 형식 오류로 거절한다.
 */
export const TOSS_DEFAULT_WIDGET_VARIANT_KEY = 'DEFAULT';

// variantKey는 결제 어드민에서 사람이 입력하는 값이라 문서가 형식을 정하지 않는다
// (예시 `DEFAULT`·`DEFAULT-2`·`CUSTOM-1`·`AGREEMENT-EN` — /guides/v2/payment-widget/admin,
// /guides/v2/learn/foreign-payment). 예시 문자집합(영숫자·`-`·`_`)과 넉넉한 길이로만 좁힌다.
const TOSS_WIDGET_VARIANT_KEY_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;

// Payment.mId는 "최대 14자"다(/reference#payment-객체). 우리 계정의 MID는 영숫자와 밑줄이다
// (2026-10-12 실측: iconsi0xvd·gsangwbzqu·CF_arikonfww8·im_crewonlyrd).
const TOSS_MERCHANT_ID_PATTERN = /^[A-Za-z0-9_]{2,14}$/;

/**
 * 우리 결제를 처리하는 토스 상점아이디(MID)의 **라이브** 허용 목록(코드 리뷰를 거치는 상수).
 * 결제 UI 바인딩이 켜져 있으면 Payment 객체의 `mId`가 키 모드에 맞는 허용 MID
 * (tossMerchantIdsForMode)가 아닐 때 어댑터는 그 결제를 승인·취소 확정·실패 판정 근거로 쓰지
 * 않는다(lib/payments/toss-gateway.server.ts — needs_review `provider_merchant_mismatch`).
 *
 * - `iconsi0xvd`: 국내카드(일반결제) MID — 2026-09-08 계약.
 * - `iconsi8sr4`: 해외카드(원화 인증) MID — 2026-11-05 접수, 사용자 결정(11/12)으로 허용 목록에만
 *   넣는다. 이 MID로 들어가는 결제 진입(결제 UI·결제수단)은 만들지 않는다.
 *
 * 목록인 이유: 결제서비스와 MID는 1:1이고 하나의 결제 UI에 여러 MID의 결제서비스를 붙일 수
 * 있다(/guides/v2/payment-widget/admin). 생성 예정인 알리페이 MID처럼 나중에 계약하는 MID는
 * TOSS_ADDITIONAL_MERCHANT_IDS env로 더한다(parseTossAdditionalMerchantIds) — 이 상수는 env로
 * 줄일 수 없다.
 */
export const TOSS_ALLOWED_MERCHANT_IDS = Object.freeze(['iconsi0xvd', 'iconsi8sr4']);

/**
 * 테스트 모드 MID 접두사. 테스트 키(`test_g*k_…`)로 만든 결제의 Payment.mId는 라이브 MID
 * 앞에 `t`가 붙는다 — 2026-10-12 결제 어드민 실측(테스트 모드 결제 UI의 MID가
 * `tgsangwbzqu`·`theygrav2hj`, 라이브 모드는 `gsangwbzqu`·`heygrav2hj`)과 공식문서의 테스트
 * 응답 예시 MID `tvivarepublica2`(/resources/release-note)가 같은 관례다. 그래서 테스트 MID를
 * 따로 적지 않고 라이브 목록에서 파생한다 — 목록과 접두사가 갈라질 수 없다.
 */
const TOSS_TEST_MERCHANT_ID_PREFIX = 't';

/**
 * TOSS_ADDITIONAL_MERCHANT_IDS env(쉼표로 구분한 **라이브** MID)를 읽는다. 비어 있거나 없으면
 * 빈 목록, 하나라도 형식 밖이면 null(호출자가 설정 오류로 다룬다 — 빌드는 멈추고 런타임은
 * 게이트웨이를 만들지 않는다). 중복과 코드 상수에 이미 있는 MID는 걸러 낸다. 테스트 모드 MID는
 * 적지 않는다 — tossMerchantIdsForMode가 `t`를 붙여 파생한다.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
export function parseTossAdditionalMerchantIds(value) {
  if (value === undefined || value === null) return [];
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return [];
  const merchantIds = trimmed.split(',').map((merchantId) => merchantId.trim());
  if (merchantIds.some((merchantId) => !TOSS_MERCHANT_ID_PATTERN.test(merchantId))) return null;
  return [...new Set(merchantIds)].filter((merchantId) => !TOSS_ALLOWED_MERCHANT_IDS.includes(merchantId));
}

/**
 * 키 모드('live' | 'test')에서 Payment.mId로 허용하는 상점아이디 목록. 라이브는 라이브 MID만,
 * 테스트는 `t` + 라이브 MID만이다 — 테스트 키 결제가 라이브 MID를, 라이브 키 결제가 테스트
 * MID를 달고 오면 키·상점 연결이 어긋난 것이므로 허용하지 않는다. 모드가 그 밖이면 빈
 * 목록(fail-closed)이다. `additionalMerchantIds`는 parseTossAdditionalMerchantIds가 검증한
 * 라이브 MID 목록이다.
 *
 * @param {unknown} mode
 * @param {readonly string[]} [additionalMerchantIds]
 * @returns {string[]}
 */
export function tossMerchantIdsForMode(mode, additionalMerchantIds = []) {
  const liveMerchantIds = [...TOSS_ALLOWED_MERCHANT_IDS, ...additionalMerchantIds];
  if (mode === 'live') return liveMerchantIds;
  if (mode === 'test') {
    return liveMerchantIds.map((merchantId) => `${TOSS_TEST_MERCHANT_ID_PREFIX}${merchantId}`);
  }
  return [];
}

/**
 * Payment.mId가 이 키 모드에서 허용된 상점아이디인지. 모드를 모르면 허용하지 않는다.
 *
 * @param {unknown} value
 * @param {unknown} mode
 * @param {readonly string[]} [additionalMerchantIds]
 * @returns {boolean}
 */
export function isTossAllowedMerchantId(value, mode, additionalMerchantIds = []) {
  return typeof value === 'string' && tossMerchantIdsForMode(mode, additionalMerchantIds).includes(value);
}

/**
 * TOSS_WIDGET_VARIANT_KEY env 값을 읽는다.
 * - 없거나 빈 값: `null` — 바인딩 꺼짐(SDK 기본 `DEFAULT` 결제 UI, 지금 동작 그대로).
 * - 형식 밖이거나 `DEFAULT`: `false` — 설정 오류(빌드는 멈추고 런타임은 게이트웨이를 만들지 않는다).
 * - 그 밖: 앞뒤 공백을 뺀 variantKey.
 *
 * @param {unknown} value
 * @returns {string | false | null}
 */
export function parseTossWidgetVariantKey(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (!TOSS_WIDGET_VARIANT_KEY_PATTERN.test(trimmed)) return false;
  if (trimmed.toUpperCase() === TOSS_DEFAULT_WIDGET_VARIANT_KEY) return false;
  return trimmed;
}

/**
 * 클라이언트 payload의 variantKey가 서버가 보낼 수 있는 값인지(형식 안 + `DEFAULT` 아님).
 *
 * @param {unknown} value
 * @returns {value is string}
 */
export function isTossWidgetVariantKey(value) {
  return typeof value === 'string' && parseTossWidgetVariantKey(value) === value;
}

/**
 * 결제 UI 바인딩(서버 env 두 개)을 한 번에 판정한다. 빌드 가드와 런타임 어댑터가 같은 규칙을 쓴다.
 *
 * - `{ kind: 'unbound' }`: TOSS_WIDGET_VARIANT_KEY가 없다 — 위젯은 variantKey 없이(=DEFAULT) 그려지고
 *   어댑터는 상점(MID)·결제수단을 대조하지 않는다. 지금 동작 그대로다.
 * - `{ kind: 'bound', variantKey, additionalMerchantIds }`: 위젯이 그 결제 UI를 그리고, 어댑터가 응답
 *   mId를 허용 MID와, 결제수단을 카드·간편결제와 대조한다.
 * - `{ kind: 'invalid', reason }`: 값이 형식 밖이다(reason: 'variant_key' | 'additional_merchant_ids').
 *
 * 결제의 MID는 키가 아니라 결제 UI(variant)가 정한다 — 주문서형 연동 키는 계정 단위이고("일반
 * 결제, 브랜드페이, 해외결제 서비스를 함께 사용해도 클라이언트 키는 하나만 필요",
 * /reference/using-api/api-keys), 결제 어드민에서 결제 UI마다 결제서비스의 MID를 연결한다
 * (/guides/v2/payment-widget/admin). 그래서 MID 대조는 결제 UI를 명시했을 때만 켠다 — 바인딩
 * 없이 대조를 켜면 다른 서비스가 함께 쓰는 DEFAULT 결제 UI(구 MID)로 들어온 결제가 전부
 * 격리된다.
 *
 * @param {Readonly<Record<string, string | undefined>> | undefined} environment
 * @returns {{ readonly kind: 'unbound', readonly additionalMerchantIds: string[] }
 *   | { readonly kind: 'bound', readonly variantKey: string, readonly additionalMerchantIds: string[] }
 *   | { readonly kind: 'invalid', readonly reason: 'variant_key' | 'additional_merchant_ids' }}
 */
export function tossMerchantBindingFromEnvironment(environment) {
  const variantKey = parseTossWidgetVariantKey(environment?.[TOSS_WIDGET_VARIANT_ENV_NAME]);
  const additionalMerchantIds = parseTossAdditionalMerchantIds(
    environment?.[TOSS_ADDITIONAL_MERCHANT_IDS_ENV_NAME],
  );
  if (variantKey === false) return { kind: 'invalid', reason: 'variant_key' };
  if (additionalMerchantIds === null) return { kind: 'invalid', reason: 'additional_merchant_ids' };
  if (variantKey === null) return { kind: 'unbound', additionalMerchantIds };
  return { kind: 'bound', variantKey, additionalMerchantIds };
}

/**
 * 문서 공개 테스트 키인지. 이 키의 결제는 우리 상점(MID) 결제가 아니라 결제내역·웹훅에
 * 남지 않고, 바인딩이 켜져 있으면 런타임 MID 대조에서 전부 needs_review가 된다 — 빌드
 * readback이 Production에서 경고한다.
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

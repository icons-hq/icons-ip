import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from '../lib/payments/korpay-config.mjs';
import { isNicepayMerchantId, isNicepayMerchantKey } from '../lib/payments/nicepay-config.mjs';
import { isTossKeyPairAligned, tossKeyMode } from '../lib/payments/toss-config.mjs';
import { isSupabasePublishableKey, isSupabaseSecretKey } from '../lib/supabase/api-key-format.mjs';
import { validateStagingBuildEnvironment } from './staging-environment.mjs';

const VERCEL_TARGETS = new Set(['preview', 'production']);
const KORPAY_GATE_NAMES = [
  'KORPAY_ORDER_CHECKOUT_ENABLED',
  'KORPAY_TICKET_CHECKOUT_ENABLED',
];
const KORPAY_CANARY_NAMES = [
  'KORPAY_ORDER_CANARY_USER_ID',
  'KORPAY_TICKET_CANARY_USER_ID',
];
const TOSS_GATE_NAMES = [
  'TOSS_ORDER_CHECKOUT_ENABLED',
  'TOSS_TICKET_CHECKOUT_ENABLED',
];
const TOSS_CANARY_NAMES = [
  'TOSS_ORDER_CANARY_USER_ID',
  'TOSS_TICKET_CANARY_USER_ID',
];
// 나이스페이는 판매 제한 굿즈 주문 전용이다 — 티켓 gate는 없다(runtime-gateway.ts).
const NICEPAY_CREDENTIAL_NAMES = ['NICEPAY_MID', 'NICEPAY_MERCHANT_KEY'];

const SHIPPING_BUNDLE_REVISION_FILE = fileURLToPath(
  new URL('../lib/legal/shipping-bundle-wording-revision.json', import.meta.url),
);

/*
 * 약관·배송 정책 '출고지' 표기 개정(1027T-010)의 날짜 파일(lib/legal/shipping-bundle-wording-revision.json)은 앱과 이 가드가 같은
 * 값을 읽는다. 개정 날짜는 시행 뒤에도 남으므로 '공지일이 오늘보다 이르다'는 이유로 막지 않는다 — 늘 참이어야 하는 것만 본다:
 * 둘 다 null(예약 없음)이거나 둘 다 YYYY-MM-DD 이고, 시행일 >= 공지일 + 7일, 공지일 >= 법정 문서 최초 판(2026-11-06).
 * '공지일 = 실제 운영 배포일'은 런북 절차(배포 직전 날짜 커밋)로 지킨다. 해석할 수 없으면 실패한다.
 */
const LEGAL_FIRST_EDITION = '2026-11-06';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value) {
  return DATE_PATTERN.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

export function validateLegalRevisionDates(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Invalid legal revision dates: shipping-bundle-wording-revision.json is not valid JSON');
  }
  const announced = parsed?.announcedDate;
  const effective = parsed?.effectiveDate;
  if (announced === null && effective === null) return;
  if (typeof announced !== 'string' || typeof effective !== 'string' || !isRealDate(announced) || !isRealDate(effective)) {
    throw new Error('Invalid legal revision dates: announcedDate and effectiveDate must both be null or both YYYY-MM-DD');
  }
  if (announced < LEGAL_FIRST_EDITION) {
    throw new Error(`Invalid legal revision dates: announcedDate ${announced} is before the first edition ${LEGAL_FIRST_EDITION}`);
  }
  const days = (Date.parse(`${effective}T00:00:00+09:00`) - Date.parse(`${announced}T00:00:00+09:00`)) / 86_400_000;
  if (!(days >= 7)) {
    throw new Error(`Invalid legal revision dates: effectiveDate ${effective} must be at least 7 days after announcedDate ${announced}`);
  }
}

function isPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function parseBooleanGate(environment, target, name) {
  const value = environment[name];
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`Invalid Vercel ${target} ${name}: use true, false, or leave unset`);
}

export function validateVercelBuildEnvironment(environment, options = {}) {
  const stagingVerified = validateStagingBuildEnvironment(environment);
  const target = environment.VERCEL_ENV;
  if (!VERCEL_TARGETS.has(target)) return { checked: false };

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    'AUTH_SIGNUP_RESEND_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  if (target === 'production') {
    required.push(
      'CRON_SECRET',
      'KORPAY_MID',
      'KORPAY_KEY',
      'SITE_URL',
    );
  }
  if (target === 'production') {
    validateLegalRevisionDates(options.revisionSource ?? readFileSync(SHIPPING_BUNDLE_REVISION_FILE, 'utf8'));
  }
  const missing = required.filter((name) => !isPresent(environment[name]));

  if (missing.length > 0) {
    throw new Error(`Missing Vercel ${target} environment: ${missing.join(', ')}`);
  }

  // legacy anon·service_role JWT는 Supabase 폐기 대상이다. 비활성화 뒤 런타임 장애가 되기 전에 빌드에서 막는다.
  if (!isSupabasePublishableKey(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)) {
    throw new Error(`Invalid Vercel ${target} NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: use a Supabase publishable key (sb_publishable_), not a legacy anon JWT`);
  }
  if (!isSupabaseSecretKey(environment.SUPABASE_SERVICE_ROLE_KEY)) {
    throw new Error(`Invalid Vercel ${target} SUPABASE_SERVICE_ROLE_KEY: use a Supabase secret key (sb_secret_), not a legacy service_role JWT`);
  }

  const korpayOrderCheckoutEnabled = parseBooleanGate(
    environment,
    target,
    'KORPAY_ORDER_CHECKOUT_ENABLED',
  );
  const korpayTicketCheckoutEnabled = parseBooleanGate(
    environment,
    target,
    'KORPAY_TICKET_CHECKOUT_ENABLED',
  );
  const tossOrderCheckoutEnabled = parseBooleanGate(
    environment,
    target,
    'TOSS_ORDER_CHECKOUT_ENABLED',
  );
  const tossTicketCheckoutEnabled = parseBooleanGate(
    environment,
    target,
    'TOSS_TICKET_CHECKOUT_ENABLED',
  );
  const nicepayOrderCheckoutEnabled = parseBooleanGate(
    environment,
    target,
    'NICEPAY_ORDER_CHECKOUT_ENABLED',
  );

  if (target === 'preview') {
    for (const name of ['KORPAY_MID', 'KORPAY_KEY']) {
      if (isPresent(environment[name])) {
        throw new Error(`Invalid Vercel preview ${name}: Korpay credentials are production-only`);
      }
    }
    for (const name of KORPAY_GATE_NAMES) {
      if (environment[name] === 'true') {
        throw new Error(`Invalid Vercel preview ${name}: checkout must remain disabled`);
      }
    }
    for (const name of KORPAY_CANARY_NAMES) {
      if (isPresent(environment[name])) {
        throw new Error(`Invalid Vercel preview ${name}: canary users are production-only`);
      }
    }
    // 토스 위젯 키 자체는 preview 존재를 막지 않는다 — 구 v1 키가 Preview
    // 스코프에 남은 이력(#199)이 있고, 런타임은 VERCEL_ENV로 이미 fail closed다.
    // 결제를 여는 신호(gate·canary)만 preview에서 차단한다.
    for (const name of TOSS_GATE_NAMES) {
      if (environment[name] === 'true') {
        throw new Error(`Invalid Vercel preview ${name}: checkout must remain disabled`);
      }
    }
    for (const name of TOSS_CANARY_NAMES) {
      if (isPresent(environment[name])) {
        throw new Error(`Invalid Vercel preview ${name}: canary users are production-only`);
      }
    }
    // 나이스페이 MID·MerchantKey는 production 전용이다. 공개 저장소의 preview 빌드에
    // 실 자격 증명이 새지 않도록 존재 자체를 막는다.
    for (const name of NICEPAY_CREDENTIAL_NAMES) {
      if (isPresent(environment[name])) {
        throw new Error(`Invalid Vercel preview ${name}: NICEPAY credentials are production-only`);
      }
    }
    if (nicepayOrderCheckoutEnabled) {
      throw new Error('Invalid Vercel preview NICEPAY_ORDER_CHECKOUT_ENABLED: checkout must remain disabled');
    }
    if (isPresent(environment.NICEPAY_ORDER_CANARY_USER_ID)) {
      throw new Error('Invalid Vercel preview NICEPAY_ORDER_CANARY_USER_ID: canary users are production-only');
    }
  }

  if (target === 'production') {
    if (!isKorpayMerchantId(environment.KORPAY_MID)) {
      throw new Error('Invalid Vercel production KORPAY_MID: use exactly 10 ASCII letters or digits');
    }
    if (!isKorpayMerchantKey(environment.KORPAY_KEY)) {
      throw new Error('Invalid Vercel production KORPAY_KEY: use 32-256 base64 characters');
    }
    if (!normalizeKorpaySiteUrl(environment.SITE_URL, { production: true })) {
      throw new Error('Invalid Vercel production SITE_URL: use the canonical HTTPS origin');
    }
    for (const name of KORPAY_CANARY_NAMES) {
      if (isPresent(environment[name]) && !isKorpayUuid(environment[name])) {
        throw new Error(`Invalid Vercel production ${name}: use a UUID v1-5`);
      }
    }
    for (const name of TOSS_CANARY_NAMES) {
      if (isPresent(environment[name]) && !isKorpayUuid(environment[name])) {
        throw new Error(`Invalid Vercel production ${name}: use a UUID v1-5`);
      }
    }
    if (
      isPresent(environment.NICEPAY_ORDER_CANARY_USER_ID)
      && !isKorpayUuid(environment.NICEPAY_ORDER_CANARY_USER_ID)
    ) {
      throw new Error('Invalid Vercel production NICEPAY_ORDER_CANARY_USER_ID: use a UUID v1-5');
    }
  }

  // 나이스페이 자격 증명은 required가 아니다 — MID·KEY 발급 전에도 production 빌드가
  // 깨지면 안 된다. 다만 하나라도 놓였다면 둘 다 형식에 맞아야 한다. 새로 등록하는 값의
  // 오타가 조용히 "미구성"으로 새면 심사 canary가 결제창을 못 여는 원인을 찾기 어렵다.
  const nicepayCredentialsPresent = NICEPAY_CREDENTIAL_NAMES.some((name) => isPresent(environment[name]));
  if (target === 'production' && nicepayCredentialsPresent) {
    if (!isNicepayMerchantId(environment.NICEPAY_MID?.trim())) {
      throw new Error('Invalid Vercel production NICEPAY_MID: use exactly 10 ASCII letters or digits');
    }
    if (!isNicepayMerchantKey(environment.NICEPAY_MERCHANT_KEY?.trim())) {
      throw new Error('Invalid Vercel production NICEPAY_MERCHANT_KEY: use 32-256 base64 characters');
    }
  }
  const nicepayConfigured = target === 'production' && nicepayCredentialsPresent;
  const nicepayOrderCanaryConfigured = isPresent(environment.NICEPAY_ORDER_CANARY_USER_ID);
  if (
    target === 'production'
    && !nicepayConfigured
    && (nicepayOrderCheckoutEnabled || nicepayOrderCanaryConfigured)
  ) {
    throw new Error(
      'Invalid Vercel production NICEPAY configuration: checkout gate or canary is set '
      + 'but NICEPAY_MID/NICEPAY_MERCHANT_KEY are not configured',
    );
  }

  // 토스 위젯 키 페어는 required가 아니다 — 전자결제 심사(#394) 전 미등록
  // 상태에서 production 빌드가 깨지면 안 되고, 구 v1 키(test_sk_)가 잔존해도
  // 형식 무효는 런타임과 같은 규칙으로 unconfigured 침묵이다. 단 결제를 여는
  // 신호가 있는데 페어가 무효하면 오타가 조용히 결제 불가로 새는 것이므로
  // 빌드에서 멈춘다.
  const tossConfigured = target === 'production'
    && isTossKeyPairAligned(
      environment.NEXT_PUBLIC_TOSS_CLIENT_KEY?.trim(),
      environment.TOSS_SECRET_KEY?.trim(),
    );
  const tossOrderCanaryConfigured = isPresent(environment.TOSS_ORDER_CANARY_USER_ID);
  const tossTicketCanaryConfigured = isPresent(environment.TOSS_TICKET_CANARY_USER_ID);
  if (
    target === 'production'
    && !tossConfigured
    && (
      tossOrderCheckoutEnabled
      || tossTicketCheckoutEnabled
      || tossOrderCanaryConfigured
      || tossTicketCanaryConfigured
    )
  ) {
    throw new Error(
      'Invalid Vercel production Toss configuration: checkout gates or canaries are set '
      + 'but NEXT_PUBLIC_TOSS_CLIENT_KEY/TOSS_SECRET_KEY are not a matching widget key pair',
    );
  }

  if (target === 'production'
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.CRON_SECRET)) {
    throw new Error('Invalid Vercel production CRON_SECRET: use 16-128 URL-safe characters');
  }
  if (isPresent(environment.PAYMENT_RECONCILIATION_SECRET)
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.PAYMENT_RECONCILIATION_SECRET)) {
    throw new Error(`Invalid Vercel ${target} PAYMENT_RECONCILIATION_SECRET: use 16-128 URL-safe characters`);
  }
  if (isPresent(environment.ERP_SYNC_SECRET)
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.ERP_SYNC_SECRET)) {
    throw new Error(`Invalid Vercel ${target} ERP_SYNC_SECRET: use 16-128 URL-safe characters`);
  }

  const korpayOrderCanaryConfigured = isPresent(environment.KORPAY_ORDER_CANARY_USER_ID);
  const korpayTicketCanaryConfigured = isPresent(environment.KORPAY_TICKET_CANARY_USER_ID);

  // 심사 창(#398 시퀀스 ③)에는 production에서 공개 gate + 테스트 키가 계획된
  // 정상 상태다 — 외부 심사자가 비회원으로 결제창을 봐야 해서 canary로 대체할 수
  // 없다. 그래서 막지 않고, 대신 빌드 로그에 눈에 띄게 남긴다. 이 상태가 심사
  // 뒤까지 남으면 무과금 결제가 paid 주문을 만든다.
  const warnings = [];
  // 코페이는 drain 전용으로 은퇴했다 — 런타임은 이 gate·canary를 더는 읽지 않는다. 남아
  // 있으면 운영자가 "열려 있다"고 오해하지 않도록 빌드 로그에 남긴다(빌드는 막지 않는다).
  if (
    target === 'production'
    && (korpayOrderCheckoutEnabled || korpayTicketCheckoutEnabled
      || isPresent(environment.KORPAY_ORDER_CANARY_USER_ID)
      || isPresent(environment.KORPAY_TICKET_CANARY_USER_ID))
  ) {
    warnings.push(
      'Korpay checkout gates and canaries are retired and ignored at runtime; new restricted-goods '
      + 'card checkouts use NICEPAY. Remove KORPAY_*_CHECKOUT_ENABLED/KORPAY_*_CANARY_USER_ID: '
      + 'docs/runbooks/nicepay-production-rollout.md',
    );
  }
  if (
    tossConfigured
    && (tossOrderCheckoutEnabled || tossTicketCheckoutEnabled)
    && tossKeyMode(environment.TOSS_SECRET_KEY?.trim()) === 'test'
  ) {
    warnings.push(
      'Toss public checkout gate is open on test-mode keys. This is the review-window '
      + 'state only: paid orders can be created without a real charge. Live switchover '
      + 'steps: docs/runbooks/toss-production-rollout.md',
    );
  }

  return {
    checked: true,
    ...(stagingVerified ? { stagingVerified: true } : {}),
    warnings,
    // 코페이 gate는 은퇴해 신규 결제를 열지 않으므로 이 합에 들어가지 않는다.
    newCheckoutEnabled: tossOrderCheckoutEnabled
      || tossTicketCheckoutEnabled
      || tossOrderCanaryConfigured
      || tossTicketCanaryConfigured
      || nicepayOrderCheckoutEnabled
      || nicepayOrderCanaryConfigured,
    paymentReconciliationConfigured: isPresent(environment.PAYMENT_RECONCILIATION_SECRET),
    korpayConfigured: target === 'production',
    korpayOrderCheckoutEnabled,
    korpayTicketCheckoutEnabled,
    korpayOrderCanaryConfigured,
    korpayTicketCanaryConfigured,
    tossConfigured,
    tossOrderCheckoutEnabled,
    tossTicketCheckoutEnabled,
    tossOrderCanaryConfigured,
    tossTicketCanaryConfigured,
    nicepayConfigured,
    nicepayOrderCheckoutEnabled,
    nicepayOrderCanaryConfigured,
  };
}

function main() {
  try {
    const result = validateVercelBuildEnvironment(process.env);
    if (!result.checked) {
      console.log('Vercel build environment check skipped outside preview/production');
      return;
    }

    for (const warning of result.warnings) {
      console.warn(`Warning: Vercel ${process.env.VERCEL_ENV} ${warning}`);
    }

    if (result.stagingVerified) {
      console.log('Staging inherited test widget keys and isolated Preview target verified; checkout gates closed');
    }

    console.log(
      `Vercel ${process.env.VERCEL_ENV} environment verified; `
      + `Korpay configured=${result.korpayConfigured} (drain only; checkout gates retired); `
      + `Toss configured=${result.tossConfigured}, `
      + `order checkout enabled=${result.tossOrderCheckoutEnabled}, `
      + `ticket checkout enabled=${result.tossTicketCheckoutEnabled}, `
      + `order canary configured=${result.tossOrderCanaryConfigured}, `
      + `ticket canary configured=${result.tossTicketCanaryConfigured}; `
      + `NICEPAY configured=${result.nicepayConfigured}, `
      + `order checkout enabled=${result.nicepayOrderCheckoutEnabled}, `
      + `order canary configured=${result.nicepayOrderCanaryConfigured}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Vercel build environment');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

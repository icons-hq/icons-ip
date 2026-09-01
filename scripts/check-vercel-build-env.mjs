import { pathToFileURL } from 'node:url';

import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from '../lib/payments/korpay-config.mjs';
import { isTossKeyPairAligned } from '../lib/payments/toss-config.mjs';

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

export function validateVercelBuildEnvironment(environment) {
  const target = environment.VERCEL_ENV;
  if (!VERCEL_TARGETS.has(target)) return { checked: false };

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
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
  const missing = required.filter((name) => !isPresent(environment[name]));

  if (!isPresent(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    && !isPresent(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`Missing Vercel ${target} environment: ${missing.join(', ')}`);
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

  const korpayOrderCanaryConfigured = isPresent(environment.KORPAY_ORDER_CANARY_USER_ID);
  const korpayTicketCanaryConfigured = isPresent(environment.KORPAY_TICKET_CANARY_USER_ID);

  return {
    checked: true,
    newCheckoutEnabled: korpayOrderCheckoutEnabled
      || korpayTicketCheckoutEnabled
      || korpayOrderCanaryConfigured
      || korpayTicketCanaryConfigured
      || tossOrderCheckoutEnabled
      || tossTicketCheckoutEnabled
      || tossOrderCanaryConfigured
      || tossTicketCanaryConfigured,
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
  };
}

function main() {
  try {
    const result = validateVercelBuildEnvironment(process.env);
    if (!result.checked) {
      console.log('Vercel build environment check skipped outside preview/production');
      return;
    }

    console.log(
      `Vercel ${process.env.VERCEL_ENV} environment verified; `
      + `Korpay configured=${result.korpayConfigured}, `
      + `order checkout enabled=${result.korpayOrderCheckoutEnabled}, `
      + `ticket checkout enabled=${result.korpayTicketCheckoutEnabled}, `
      + `order canary configured=${result.korpayOrderCanaryConfigured}, `
      + `ticket canary configured=${result.korpayTicketCanaryConfigured}; `
      + `Toss configured=${result.tossConfigured}, `
      + `order checkout enabled=${result.tossOrderCheckoutEnabled}, `
      + `ticket checkout enabled=${result.tossTicketCheckoutEnabled}, `
      + `order canary configured=${result.tossOrderCanaryConfigured}, `
      + `ticket canary configured=${result.tossTicketCanaryConfigured}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Vercel build environment');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

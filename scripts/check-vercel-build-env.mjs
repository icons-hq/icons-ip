import { pathToFileURL } from 'node:url';

import { paymentKeyMode } from '../lib/payments/key-mode.mjs';
import {
  isKorpayMerchantId,
  isKorpayMerchantKey,
  isKorpayUuid,
  normalizeKorpaySiteUrl,
} from '../lib/payments/korpay-config.mjs';

const VERCEL_TARGETS = new Set(['preview', 'production']);
const KORPAY_GATE_NAMES = [
  'KORPAY_ORDER_CHECKOUT_ENABLED',
  'KORPAY_TICKET_CHECKOUT_ENABLED',
];
const KORPAY_CANARY_NAMES = [
  'KORPAY_ORDER_CANARY_USER_ID',
  'KORPAY_TICKET_CANARY_USER_ID',
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
      'TOSS_SECRET_KEY',
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
  }

  if (target === 'production'
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.CRON_SECRET)) {
    throw new Error('Invalid Vercel production CRON_SECRET: use 16-128 URL-safe characters');
  }
  if (isPresent(environment.PAYMENT_RECONCILIATION_SECRET)
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.PAYMENT_RECONCILIATION_SECRET)) {
    throw new Error(`Invalid Vercel ${target} PAYMENT_RECONCILIATION_SECRET: use 16-128 URL-safe characters`);
  }

  const secretMode = paymentKeyMode(environment.TOSS_SECRET_KEY, 'secret');
  if (isPresent(environment.TOSS_SECRET_KEY) && secretMode === null) {
    throw new Error(`Invalid Vercel ${target} Toss legacy server key`);
  }

  const korpayOrderCanaryConfigured = isPresent(environment.KORPAY_ORDER_CANARY_USER_ID);
  const korpayTicketCanaryConfigured = isPresent(environment.KORPAY_TICKET_CANARY_USER_ID);

  return {
    checked: true,
    legacyTossMode: secretMode,
    newCheckoutEnabled: korpayOrderCheckoutEnabled
      || korpayTicketCheckoutEnabled
      || korpayOrderCanaryConfigured
      || korpayTicketCanaryConfigured,
    paymentReconciliationConfigured: isPresent(environment.PAYMENT_RECONCILIATION_SECRET),
    korpayConfigured: target === 'production',
    korpayOrderCheckoutEnabled,
    korpayTicketCheckoutEnabled,
    korpayOrderCanaryConfigured,
    korpayTicketCanaryConfigured,
  };
}

function main() {
  try {
    const result = validateVercelBuildEnvironment(process.env);
    if (!result.checked) {
      console.log('Vercel build environment check skipped outside preview/production');
      return;
    }

    const legacyStatus = result.legacyTossMode
      ? `Toss legacy ${result.legacyTossMode} API available`
      : 'Toss legacy API unavailable (Fake-only preview)';
    console.log(
      `Vercel ${process.env.VERCEL_ENV} environment verified; ${legacyStatus}; `
      + `Korpay configured=${result.korpayConfigured}, `
      + `order checkout enabled=${result.korpayOrderCheckoutEnabled}, `
      + `ticket checkout enabled=${result.korpayTicketCheckoutEnabled}, `
      + `order canary configured=${result.korpayOrderCanaryConfigured}, `
      + `ticket canary configured=${result.korpayTicketCanaryConfigured}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Vercel build environment');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

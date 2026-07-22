import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { paymentKeyMode, paymentModeEnabledInProduction } from '../lib/payments/key-mode.mjs';

const VERCEL_TARGETS = new Set(['preview', 'production']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateVercelBuildEnvironment(environment) {
  const target = environment.VERCEL_ENV;
  if (!VERCEL_TARGETS.has(target)) return { checked: false };

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'AUTH_SIGNUP_RESEND_SECRET',
    'NEXT_PUBLIC_TOSS_CLIENT_KEY',
    'TOSS_SECRET_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  if (target === 'production') required.push('CRON_SECRET');
  const missing = required.filter((name) => !isPresent(environment[name]));

  if (!isPresent(environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
    && !isPresent(environment.NEXT_PUBLIC_SUPABASE_ANON_KEY)) {
    missing.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`Missing Vercel ${target} environment: ${missing.join(', ')}`);
  }

  if (target === 'production'
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.CRON_SECRET)) {
    throw new Error('Invalid Vercel production CRON_SECRET: use 16-128 URL-safe characters');
  }

  const clientMode = paymentKeyMode(environment.NEXT_PUBLIC_TOSS_CLIENT_KEY, 'client');
  const secretMode = paymentKeyMode(environment.TOSS_SECRET_KEY, 'secret');
  if (clientMode === null || clientMode !== secretMode) {
    throw new Error(`Invalid Vercel ${target} payment keys: use a matching Toss widget key pair`);
  }

  const productionCheckoutEnabled = target === 'production'
    && paymentModeEnabledInProduction(clientMode, environment.ALLOW_TOSS_TEST_PAYMENTS_IN_PRODUCTION);
  if (productionCheckoutEnabled) {
    const paymentRequired = ['TOSS_PAYMENT_KEY_PAIR_SHA256'];
    if (clientMode === 'test') paymentRequired.unshift('TOSS_TEST_PAYMENT_REVIEWER_USER_IDS');
    const paymentMissing = paymentRequired.filter((name) => !isPresent(environment[name]));
    if (paymentMissing.length > 0) {
      throw new Error(`Missing Vercel production test-payment environment: ${paymentMissing.join(', ')}`);
    }

    if (clientMode === 'test') {
      const reviewerIds = environment.TOSS_TEST_PAYMENT_REVIEWER_USER_IDS
        .split(',')
        .map((value) => value.trim());
      if (reviewerIds.length === 0 || reviewerIds.some((value) => !UUID_PATTERN.test(value))) {
        throw new Error('Invalid Vercel production test-payment reviewer IDs: use comma-separated UUIDs');
      }
    }

    const actualFingerprint = createHash('sha256')
      .update(`${environment.NEXT_PUBLIC_TOSS_CLIENT_KEY}\0${environment.TOSS_SECRET_KEY}`)
      .digest('hex');
    if (environment.TOSS_PAYMENT_KEY_PAIR_SHA256 !== actualFingerprint) {
      throw new Error('Invalid Vercel production payment key-pair fingerprint');
    }
  }

  return {
    checked: true,
    paymentMode: clientMode,
    productionCheckoutEnabled,
  };
}

function main() {
  try {
    const result = validateVercelBuildEnvironment(process.env);
    if (!result.checked) {
      console.log('Vercel build environment check skipped outside preview/production');
      return;
    }

    if (process.env.VERCEL_ENV === 'production' && !result.productionCheckoutEnabled) {
      console.log('Vercel production environment verified; checkout remains disabled until live Toss widget keys are configured');
      return;
    }

    console.log(`Vercel ${process.env.VERCEL_ENV} environment verified; Toss widget ${result.paymentMode} mode`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Vercel build environment');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

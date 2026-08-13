import { pathToFileURL } from 'node:url';

import { paymentKeyMode } from '../lib/payments/key-mode.mjs';

const VERCEL_TARGETS = new Set(['preview', 'production']);

function isPresent(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateVercelBuildEnvironment(environment) {
  const target = environment.VERCEL_ENV;
  if (!VERCEL_TARGETS.has(target)) return { checked: false };

  const required = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'AUTH_SIGNUP_RESEND_SECRET',
    'SUPABASE_SERVICE_ROLE_KEY',
  ];
  if (target === 'production') required.push('TOSS_SECRET_KEY', 'CRON_SECRET');
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
  if (isPresent(environment.PAYMENT_RECONCILIATION_SECRET)
    && !/^[A-Za-z0-9_-]{16,128}$/.test(environment.PAYMENT_RECONCILIATION_SECRET)) {
    throw new Error(`Invalid Vercel ${target} PAYMENT_RECONCILIATION_SECRET: use 16-128 URL-safe characters`);
  }

  const secretMode = paymentKeyMode(environment.TOSS_SECRET_KEY, 'secret');
  if (isPresent(environment.TOSS_SECRET_KEY) && secretMode === null) {
    throw new Error(`Invalid Vercel ${target} Toss legacy server key`);
  }

  return {
    checked: true,
    legacyTossMode: secretMode,
    newCheckoutEnabled: false,
    paymentReconciliationConfigured: isPresent(environment.PAYMENT_RECONCILIATION_SECRET),
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
    console.log(`Vercel ${process.env.VERCEL_ENV} environment verified; ${legacyStatus} and new checkout disabled`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid Vercel build environment');
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();

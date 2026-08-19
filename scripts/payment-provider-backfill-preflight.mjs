#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const EXPECTED_LEGACY_PAYMENT_COUNT = 2;

export const PAYMENT_PROVIDER_BACKFILL_PREFLIGHT_SQL = `
select
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'payments'
      and column_name = 'provider'
  ) as provider_column_exists,
  count(*)::text as payment_count
from public.payments;
`;

function requirePaymentCount(value) {
  const count = typeof value === 'string' && /^\d+$/.test(value)
    ? Number(value)
    : value;
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error('invalid provider backfill preflight snapshot');
  }
  return count;
}

export function evaluatePaymentProviderBackfillPreflight(snapshot) {
  if (!snapshot || typeof snapshot.providerColumnExists !== 'boolean') {
    throw new Error('invalid provider backfill preflight snapshot');
  }

  const paymentCount = requirePaymentCount(snapshot.paymentCount);
  if (snapshot.providerColumnExists) return { status: 'already_applied' };
  if (paymentCount !== EXPECTED_LEGACY_PAYMENT_COUNT) {
    throw new Error(
      `expected exactly ${EXPECTED_LEGACY_PAYMENT_COUNT} legacy payments before provider backfill, found ${paymentCount}`,
    );
  }
  return { status: 'ready', legacyPaymentCount: paymentCount };
}

function normalizeQuerySnapshot(value) {
  if (!value || typeof value !== 'object') {
    throw new Error('invalid provider backfill preflight snapshot');
  }
  return {
    providerColumnExists: value.provider_column_exists,
    paymentCount: value.payment_count,
  };
}

export async function runPaymentProviderBackfillPreflight(querySnapshot) {
  const rawSnapshot = await querySnapshot(PAYMENT_PROVIDER_BACKFILL_PREFLIGHT_SQL);
  return evaluatePaymentProviderBackfillPreflight(normalizeQuerySnapshot(rawSnapshot));
}

async function querySupabaseSnapshot(target, sql) {
  const { stdout } = await execFileAsync(
    'supabase',
    ['db', 'query', target, '--output-format', 'json', sql],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  return parsePaymentProviderQueryResponse(stdout);
}

export function parsePaymentProviderQueryResponse(stdout) {
  const response = JSON.parse(stdout);
  // CLI 2.101 emits a bare row array in ordinary CI, but wraps it in
  // `{ rows, boundary, warning }` when agent mode is active.
  const rows = Array.isArray(response) ? response : response?.rows;
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new Error('invalid provider backfill preflight query response');
  }
  return rows[0];
}

async function main() {
  const target = process.argv[2];
  if (target !== '--linked' && target !== '--local') {
    throw new Error('usage: payment-provider-backfill-preflight.mjs --linked|--local');
  }

  const outcome = await runPaymentProviderBackfillPreflight((sql) => (
    querySupabaseSnapshot(target, sql)
  ));
  if (outcome.status === 'ready') {
    console.log(`Payment provider backfill preflight passed: legacy_count=${outcome.legacyPaymentCount}`);
    return;
  }
  console.log('Payment provider backfill preflight skipped: provider column already exists');
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`Payment provider backfill preflight failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  });
}

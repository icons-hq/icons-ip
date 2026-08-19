import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appliedMigration = {
  path: '../supabase/migrations/20260813220000_goods_payment_provider_seam.sql',
  sha256: '2ea0704163f20a3170440a0c0941010efba1245d29903817cdf0d3afb20bf1e4',
} as const;

describe('applied goods payment migration', () => {
  it('keeps the Preview-applied 220000 migration byte-for-byte immutable', async () => {
    const bytes = await readFile(fileURLToPath(new URL(appliedMigration.path, import.meta.url)));

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(appliedMigration.sha256);
  });
});

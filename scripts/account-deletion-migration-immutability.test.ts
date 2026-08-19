import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appliedMigrations = [
  {
    path: '../supabase/migrations/20260813193000_account_deletion_phase_one.sql',
    sha256: '76ab51460348c25ec135a2623eafe5a23c3c3871da434b05448c18151ebc0f85',
  },
  {
    path: '../supabase/migrations/20260813204000_account_deletion_phase_one_review_fixes.sql',
    sha256: '453f39f581cb9d338ceafe96e2ac4c92a5314250f3a5d6aad02d2ec5f547e20c',
  },
] as const;

describe('applied account deletion migration', () => {
  it.each(appliedMigrations)('keeps $path byte-for-byte immutable', async ({ path, sha256 }) => {
    const bytes = await readFile(fileURLToPath(new URL(path, import.meta.url)));

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256);
  });
});

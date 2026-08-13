import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const appliedMigration = fileURLToPath(new URL(
  '../supabase/migrations/20260813193000_account_deletion_phase_one.sql',
  import.meta.url,
));

describe('applied account deletion migration', () => {
  it('keeps the shared Preview migration byte-for-byte immutable', async () => {
    const bytes = await readFile(appliedMigration);

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      '76ab51460348c25ec135a2623eafe5a23c3c3871da434b05448c18151ebc0f85',
    );
  });
});

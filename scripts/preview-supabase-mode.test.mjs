import { describe, expect, it } from 'vitest';

import {
  determinePreviewDatabaseMode,
  requiresIsolatedPreviewDatabase,
} from './preview-supabase-mode.mjs';

describe('preview Supabase database mode', () => {
  it.each([
    'supabase/migrations/20260826090000_example.sql',
    'supabase/config.toml',
    'supabase/seed.sql',
    'supabase/roles.sql',
    'supabase/functions/example/index.ts',
    'supabase/templates/recovery.html',
    'scripts/sync-supabase-auth.mjs',
    '.github/workflows/pipeline.yml',
  ])('isolates deploy-affecting path %s', (filePath) => {
    expect(requiresIsolatedPreviewDatabase(filePath)).toBe(true);
  });

  it.each([
    'supabase/tests/catalog_baseline.sql',
    'app/page.tsx',
    'README.md',
    '.github/workflows/supabase-preview-cleanup.yml',
  ])('keeps non-deploying path %s on the shared main preview', (filePath) => {
    expect(requiresIsolatedPreviewDatabase(filePath)).toBe(false);
  });

  it('uses an isolated database when any changed path deploys Supabase state', () => {
    expect(determinePreviewDatabaseMode([
      'app/page.tsx',
      'supabase/migrations/20260826090000_example.sql',
    ])).toBe('isolated');
  });

  it('uses the shared main preview for app-only changes', () => {
    expect(determinePreviewDatabaseMode(['app/page.tsx', 'README.md'])).toBe('shared');
  });
});

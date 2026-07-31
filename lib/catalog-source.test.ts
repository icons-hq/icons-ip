import { describe, expect, it } from 'vitest';
import { resolveCatalogSource } from './catalog-source';

describe('resolveCatalogSource', () => {
  it('uses mock data by default on Vercel Preview even when Supabase is configured', () => {
    expect(resolveCatalogSource({
      env: { VERCEL_ENV: 'preview' },
      isSupabaseConfigured: true,
    })).toBe('mock');
  });

  it('allows explicit catalog source overrides', () => {
    expect(resolveCatalogSource({
      env: { VERCEL_ENV: 'preview', ICONS_CATALOG_SOURCE: 'supabase' },
      isSupabaseConfigured: true,
    })).toBe('supabase');
    expect(resolveCatalogSource({
      env: { ICONS_CATALOG_SOURCE: 'mock' },
      isSupabaseConfigured: true,
    })).toBe('mock');
  });

  it('allows callers to keep Supabase as the preview default when no override is set', () => {
    expect(resolveCatalogSource({
      env: { VERCEL_ENV: 'preview' },
      isSupabaseConfigured: true,
      previewDefaultSource: 'supabase',
    })).toBe('supabase');
  });

  it('falls back to mock data when Supabase is not configured', () => {
    expect(resolveCatalogSource({
      env: {},
      isSupabaseConfigured: false,
    })).toBe('mock');
  });
});

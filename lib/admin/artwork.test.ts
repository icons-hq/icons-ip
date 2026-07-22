import { describe, expect, it } from 'vitest';
import {
  ADMIN_ARTWORK_ACCEPT,
  ADMIN_ARTWORK_ERROR,
  ADMIN_ARTWORK_MAX_BYTES,
  buildAdminArtworkPath,
  normalizeAdminArtworkMetadata,
  normalizePublicMediaObjectPath,
  parseAdminArtworkPath,
} from './artwork';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('admin artwork metadata', () => {
  it('exports the browser file-picker contract', () => {
    expect(ADMIN_ARTWORK_ACCEPT).toBe('image/jpeg,image/png,image/webp');
    expect(ADMIN_ARTWORK_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each([
    ['ip', 'image/jpeg', 1],
    ['good', 'image/png', ADMIN_ARTWORK_MAX_BYTES],
    ['card', 'image/webp', 42],
    ['event', 'image/jpeg', 1024],
    ['curation', 'image/png', 2048],
  ] as const)('accepts %s %s metadata within the inclusive limit', (kind, mimeType, size) => {
    expect(normalizeAdminArtworkMetadata({ kind, mimeType, size })).toEqual({
      ok: true,
      value: { kind, mimeType, size },
    });
  });

  it.each([
    { kind: 'post', mimeType: 'image/png', size: 1 },
    { kind: 'ip', mimeType: 'image/svg+xml', size: 1 },
    { kind: 'ip', mimeType: 'image/png', size: 0 },
    { kind: 'ip', mimeType: 'image/png', size: 1.5 },
    { kind: 'ip', mimeType: 'image/png', size: ADMIN_ARTWORK_MAX_BYTES + 1 },
    { kind: 'ip', mimeType: 'image/png', size: Number.NaN },
  ])('rejects unsupported or unsafe metadata %#', (input) => {
    expect(normalizeAdminArtworkMetadata(input)).toEqual({
      ok: false,
      error: ADMIN_ARTWORK_ERROR,
    });
  });
});

describe('admin artwork paths', () => {
  it.each([
    ['ip', 'image/jpeg', 'jpg'],
    ['good', 'image/png', 'png'],
    ['card', 'image/webp', 'webp'],
    ['event', 'image/jpeg', 'jpg'],
    ['curation', 'image/png', 'png'],
  ] as const)('builds a catalog/%s path with the canonical extension', (kind, mimeType, extension) => {
    expect(buildAdminArtworkPath({
      kind,
      mimeType,
      nonce: UUID.toUpperCase(),
    })).toBe(`catalog/${kind}/${UUID}.${extension}`);
  });

  it('rejects invalid path inputs', () => {
    expect(() => buildAdminArtworkPath({
      kind: 'ip',
      mimeType: 'image/png',
      nonce: 'not-a-uuid',
    })).toThrow('Invalid admin artwork nonce');
  });

  it.each([
    ['catalog/ip/123e4567-e89b-42d3-a456-426614174000.jpg', 'ip', 'image/jpeg'],
    ['catalog/good/123e4567-e89b-42d3-a456-426614174000.png', 'good', 'image/png'],
    ['catalog/card/123e4567-e89b-42d3-a456-426614174000.webp', 'card', 'image/webp'],
    ['catalog/event/123e4567-e89b-42d3-a456-426614174000.jpg', 'event', 'image/jpeg'],
    ['catalog/curation/123e4567-e89b-42d3-a456-426614174000.png', 'curation', 'image/png'],
  ] as const)('parses the strict generated path contract %s', (path, kind, mimeType) => {
    expect(parseAdminArtworkPath(path)).toEqual({ path, kind, mimeType });
  });

  it.each([
    'public-media/catalog/ip/123e4567-e89b-42d3-a456-426614174000.png',
    'catalog/ip/123E4567-E89B-42D3-A456-426614174000.png',
    'catalog/post/123e4567-e89b-42d3-a456-426614174000.png',
    'catalog/ip/123e4567-e89b-12d3-a456-426614174000.png',
    'catalog/ip/123e4567-e89b-42d3-a456-426614174000.gif',
    '../catalog/ip/123e4567-e89b-42d3-a456-426614174000.png',
  ])('rejects a path outside the generated contract: %s', (path) => {
    expect(parseAdminArtworkPath(path)).toBeNull();
  });

  it.each([
    ['catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['public-media/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
    ['///public-media/catalog/ip/art.jpg', 'catalog/ip/art.jpg'],
  ])('normalizes stored public-media path %s', (storedPath, expected) => {
    expect(normalizePublicMediaObjectPath(storedPath)).toBe(expected);
  });
});

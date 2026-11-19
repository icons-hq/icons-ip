import { describe, expect, it } from 'vitest';
import {
  ADMIN_ARTWORK_ACCEPT,
  ADMIN_ARTWORK_ERROR,
  ADMIN_ARTWORK_MAX_BYTES,
  GOODS_ARTWORK_ERROR,
  GOODS_ARTWORK_MAX_BYTES,
  adminArtworkRejectMessage,
  adminArtworkStagingFailure,
  buildAdminArtworkPath,
  detectAdminArtworkMimeType,
  normalizeAdminArtworkMetadata,
  parseAdminArtworkPath,
  parseAdminArtworkStagingFailure,
} from './artwork';

const UUID = '123e4567-e89b-42d3-a456-426614174000';

describe('admin artwork metadata', () => {
  it('exports the browser file-picker contract', () => {
    expect(ADMIN_ARTWORK_ACCEPT).toBe('image/jpeg,image/png,image/webp');
    expect(ADMIN_ARTWORK_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it.each([
    ['ip', 'image/jpeg', 1],
    ['good', 'image/png', GOODS_ARTWORK_MAX_BYTES],
    ['card', 'image/webp', 42],
    ['event', 'image/jpeg', 1024],
    ['curation', 'image/png', 2048],
  ] as const)('accepts %s %s metadata within the inclusive limit', (kind, mimeType, size) => {
    expect(normalizeAdminArtworkMetadata({ kind, mimeType, size })).toEqual({
      ok: true,
      value: { kind, mimeType, size },
    });
  });

  it('상품 이미지만 큰 한도를 쓰고 넘으면 그 한도를 안내한다', () => {
    expect(GOODS_ARTWORK_MAX_BYTES).toBe(20 * 1024 * 1024);
    expect(normalizeAdminArtworkMetadata({ kind: 'good', mimeType: 'image/jpeg', size: GOODS_ARTWORK_MAX_BYTES + 1 })).toEqual({
      ok: false,
      error: GOODS_ARTWORK_ERROR,
    });
    expect(normalizeAdminArtworkMetadata({ kind: 'event', mimeType: 'image/jpeg', size: GOODS_ARTWORK_MAX_BYTES })).toEqual({
      ok: false,
      error: ADMIN_ARTWORK_ERROR,
    });
  });

  it.each([
    { kind: 'post', mimeType: 'image/png', size: 1 },
    { kind: 'ip', mimeType: 'image/svg+xml', size: 1 },
    { kind: 'ip', mimeType: 'image/png', size: 0 },
    { kind: 'ip', mimeType: 'image/png', size: 1.5 },
    { kind: 'ip', mimeType: 'image/png', size: ADMIN_ARTWORK_MAX_BYTES + 1 },
    { kind: 'ip', mimeType: 'image/png', size: Number.NaN },
    // Object.prototype keys must not survive the allowlist: a matched prototype key
    // makes the extension lookup return a function that the path template stringifies.
    { kind: 'ip', mimeType: 'toString', size: 1 },
    { kind: 'ip', mimeType: 'constructor', size: 1 },
    { kind: 'toString', mimeType: 'image/png', size: 1 },
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

});

/* 2026-11-19: 확장자(.jpg)와 내용(PNG)이 다른 긴 상세 이미지가 형식 불일치로 사유 없이 거절됐다. */
describe('detectAdminArtworkMimeType', () => {
  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d], 'image/png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1], 'image/jpeg'],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'image/webp'],
    ['RIFF 아닌 WAVE', [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x41, 0x56, 0x45], null],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0], null],
    ['짧은 머리', [0x89, 0x50], null],
  ] as const)('%s → %s', (_label, bytes, expected) => {
    expect(detectAdminArtworkMimeType(new Uint8Array(bytes))).toBe(expected);
  });
});

describe('adminArtworkRejectMessage', () => {
  it('names the declared and real format for a renamed file', () => {
    expect(adminArtworkRejectMessage('good', { reason: 'format_mismatch', detail: { declared: 'image/jpeg', detected: 'png' } }))
      .toBe('파일 이름의 형식(JPEG)과 실제 내용의 형식(PNG)이 다릅니다. 이미지 편집 프로그램에서 JPEG·PNG로 다시 저장해 올려주세요.');
  });

  it('tells a goods operator the size limit with the uploaded size and to split long images', () => {
    const message = adminArtworkRejectMessage('good', { reason: 'dimension_exceeded', detail: { width: 1000, height: 31000, maxDimension: 30000 } });
    expect(message).toContain('가로·세로 30,000px 이하');
    expect(message).toContain('1,000×31,000px');
    expect(message).toContain('잘라서 여러 장');
    expect(adminArtworkRejectMessage('ip', { reason: 'dimension_exceeded', detail: { width: 9000, height: 9000 } })).toContain('8,192px');
  });

  it('keeps storage failures generic but carries the cause code', () => {
    expect(adminArtworkRejectMessage('good', { reason: 'public_upload_failed', detail: { error: 'private detail' } }))
      .toBe('이미지를 저장소로 옮기지 못했습니다. 잠시 뒤 다시 시도해주세요. 계속되면 운영 담당자에게 알려주세요(원인 코드 public_upload_failed).');
    expect(adminArtworkRejectMessage('good', { reason: 'size_exceeded', detail: {} })).toBe(GOODS_ARTWORK_ERROR);
    expect(adminArtworkRejectMessage('ip', { reason: 'size_exceeded', detail: {} })).toBe(ADMIN_ARTWORK_ERROR);
  });
});

describe('staging upload failure', () => {
  it('recognizes a storage size rejection and keeps only a short diagnostic', () => {
    expect(adminArtworkStagingFailure({ statusCode: '413', message: 'The object exceeded the maximum allowed size\nstack' })).toEqual({
      message: '저장소가 파일 크기로 업로드를 거절했습니다. 운영 담당자에게 알려주세요(원인 코드 staging_upload_too_large).',
      detail: { status: 413, message: 'The object exceeded the maximum allowed size', tooLarge: 1 },
    });
    expect(adminArtworkStagingFailure(new Error('network down')).detail).toEqual({ status: null, message: 'network down', tooLarge: 0 });
  });

  it('accepts only the diagnostic shape the browser builds', () => {
    expect(parseAdminArtworkStagingFailure({ status: null, message: null, tooLarge: 0 })).toEqual({ status: null, message: null, tooLarge: 0 });
    expect(parseAdminArtworkStagingFailure({ status: '413', message: null, tooLarge: 1 })).toBeNull();
    expect(parseAdminArtworkStagingFailure({ status: 413, message: null, tooLarge: 2 })).toBeNull();
    expect(parseAdminArtworkStagingFailure([1])).toBeNull();
  });
});

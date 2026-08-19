import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ADMIN_ARTWORK_MAX_DIMENSION } from './artwork';
import { normalizeAdminArtworkImage } from './artwork-image.server';

describe('normalizeAdminArtworkImage', () => {
  it.each([
    ['image/jpeg', 'jpeg'],
    ['image/png', 'png'],
    ['image/webp', 'webp'],
  ] as const)('fully decodes and re-encodes a valid %s image', async (mimeType, format) => {
    const source = await sharp({
      create: {
        background: { alpha: 1, b: 180, g: 120, r: 60 },
        channels: 4,
        height: 2,
        width: 3,
      },
    })[format]().toBuffer();

    const result = await normalizeAdminArtworkImage(source, mimeType);

    expect(result).not.toBeNull();
    expect(result?.height).toBe(2);
    expect(result?.width).toBe(3);
    expect((await sharp(result?.bytes).metadata()).format).toBe(format);
  });

  it('strips bytes appended after a valid image instead of publishing a polyglot payload', async () => {
    const source = await sharp({
      create: {
        background: { alpha: 1, b: 30, g: 20, r: 10 },
        channels: 4,
        height: 1,
        width: 1,
      },
    }).png().toBuffer();
    const marker = new TextEncoder().encode('<script>payload</script>');
    const polyglot = new Uint8Array(source.byteLength + marker.byteLength);
    polyglot.set(source);
    polyglot.set(marker, source.byteLength);

    const result = await normalizeAdminArtworkImage(polyglot, 'image/png');

    expect(result).not.toBeNull();
    expect(new TextDecoder().decode(result?.bytes)).not.toContain('<script>payload</script>');
  });

  it('preserves a PNG alpha channel while JPEG output remains three-channel and opaque', async () => {
    const rgbaSource = await sharp({
      create: {
        background: { alpha: 0.5, b: 90, g: 60, r: 30 },
        channels: 4,
        height: 2,
        width: 2,
      },
    }).png().toBuffer();
    const jpegSource = await sharp(rgbaSource).jpeg().toBuffer();

    const pngResult = await normalizeAdminArtworkImage(rgbaSource, 'image/png');
    const jpegResult = await normalizeAdminArtworkImage(jpegSource, 'image/jpeg');

    expect(pngResult).not.toBeNull();
    expect(jpegResult).not.toBeNull();
    await expect(sharp(pngResult?.bytes).metadata()).resolves.toMatchObject({
      channels: 4,
      hasAlpha: true,
    });
    await expect(sharp(jpegResult?.bytes).metadata()).resolves.toMatchObject({
      channels: 3,
      hasAlpha: false,
    });
  });

  it.each([
    ['header-only PNG', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'],
    ['declared MIME mismatch', new Uint8Array([0xff, 0xd8, 0xff, 0x00]), 'image/png'],
    ['arbitrary payload', new TextEncoder().encode('not-an-image'), 'image/webp'],
  ] as const)('rejects %s', async (_label, bytes, mimeType) => {
    await expect(normalizeAdminArtworkImage(bytes, mimeType)).resolves.toBeNull();
  });

  it('rejects an excessive image dimension even when the encoded source is small', async () => {
    const source = await sharp({
      create: {
        background: { alpha: 1, b: 0, g: 0, r: 0 },
        channels: 4,
        height: 1,
        width: ADMIN_ARTWORK_MAX_DIMENSION + 1,
      },
    }).png().toBuffer();

    await expect(normalizeAdminArtworkImage(source, 'image/png')).resolves.toBeNull();
  });
});

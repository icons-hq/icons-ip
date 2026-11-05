import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ADMIN_ARTWORK_MAX_DIMENSION } from './artwork';
import { ADMIN_ARTWORK_OUTPUT_MAX_EDGE, adminArtworkOutputBox, normalizeAdminArtworkImage } from './artwork-image.server';

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

  /* R19(MD-0030): 큰 원본을 원래 크기 그대로 다시 인코딩하던 검증이 사진마다 수 초씩 걸렸다. */
  it.each([
    ['가로 사진', 4000, 3000, 2560, 1920],
    ['세로 사진', 3000, 4000, 1920, 2560],
    ['정사각형은 정사각형으로', 3000, 3000, 2560, 2560],
    ['작은 이미지는 키우지 않는다', 1000, 1000, 1000, 1000],
    ['긴 상세 이미지는 그대로', 860, 8000, 860, 8000],
    ['가로 배너는 그대로', 6000, 1500, 6000, 1500],
    ['폭 넓은 띠형은 짧은 변만 줄인다', 2800, 6000, 2560, 5486],
  ] as const)('%s: %i×%i → %i×%i', async (_label, width, height, outWidth, outHeight) => {
    const source = await sharp({
      create: { background: { alpha: 1, b: 90, g: 60, r: 30 }, channels: 3, height, width },
    }).jpeg().toBuffer();

    const result = await normalizeAdminArtworkImage(source, 'image/jpeg');

    expect(result).toMatchObject({ height: outHeight, width: outWidth });
    await expect(sharp(result?.bytes).metadata()).resolves.toMatchObject({ format: 'jpeg', height: outHeight, width: outWidth });
  });

  it('EXIF 회전을 반영한 크기로 줄이고 회전된 결과를 저장한다', async () => {
    const source = await sharp({
      create: { background: { alpha: 1, b: 90, g: 60, r: 30 }, channels: 3, height: 3000, width: 4000 },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const result = await normalizeAdminArtworkImage(source, 'image/jpeg');

    expect(result).toMatchObject({ height: 2560, width: 1920 });
  });

  it.each([
    [4000, 3000, { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE }],
    [2560, 1000, null],
    [860, 8000, null],
    [2600, 5300, { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: ADMIN_ARTWORK_MAX_DIMENSION }],
    [5300, 2600, { width: ADMIN_ARTWORK_MAX_DIMENSION, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE }],
  ] as const)('출력 상자 %i×%i', (width, height, box) => {
    expect(adminArtworkOutputBox(width, height)).toEqual(box);
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

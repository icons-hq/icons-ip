import 'server-only';

import sharp from 'sharp';
import {
  ADMIN_ARTWORK_MAX_BYTES,
  ADMIN_ARTWORK_MAX_DIMENSION,
  type AdminArtworkMimeType,
} from './artwork';

export const ADMIN_ARTWORK_MAX_PIXELS = 40_000_000;

const SHARP_FORMAT_BY_MIME: Record<AdminArtworkMimeType, 'jpeg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};

export interface NormalizedAdminArtworkImage {
  bytes: Uint8Array;
  height: number;
  width: number;
}

export async function normalizeAdminArtworkImage(
  bytes: Uint8Array,
  mimeType: AdminArtworkMimeType,
): Promise<NormalizedAdminArtworkImage | null> {
  if (bytes.byteLength < 1 || bytes.byteLength > ADMIN_ARTWORK_MAX_BYTES) return null;

  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: 'error',
      limitInputPixels: ADMIN_ARTWORK_MAX_PIXELS,
    });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (
      metadata.format !== SHARP_FORMAT_BY_MIME[mimeType]
      || width < 1
      || height < 1
      || width > ADMIN_ARTWORK_MAX_DIMENSION
      || height > ADMIN_ARTWORK_MAX_DIMENSION
      || width * height > ADMIN_ARTWORK_MAX_PIXELS
      || (metadata.pages ?? 1) !== 1
    ) {
      return null;
    }

    const rotated = image.rotate();
    const output = mimeType === 'image/jpeg'
      ? await rotated.jpeg({ mozjpeg: true, quality: 90 }).toBuffer({ resolveWithObject: true })
      : mimeType === 'image/png'
        ? await rotated.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
        : await rotated.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });

    if (
      output.data.byteLength < 1
      || output.data.byteLength > ADMIN_ARTWORK_MAX_BYTES
      || output.info.width > ADMIN_ARTWORK_MAX_DIMENSION
      || output.info.height > ADMIN_ARTWORK_MAX_DIMENSION
      || output.info.width * output.info.height > ADMIN_ARTWORK_MAX_PIXELS
    ) {
      return null;
    }

    return {
      bytes: new Uint8Array(output.data),
      height: output.info.height,
      width: output.info.width,
    };
  } catch {
    return null;
  }
}

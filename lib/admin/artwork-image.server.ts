import 'server-only';

import sharp from 'sharp';
import {
  ADMIN_ARTWORK_MAX_BYTES,
  ADMIN_ARTWORK_MAX_DIMENSION,
  ADMIN_ARTWORK_OUTPUT_MAX_EDGE,
  type AdminArtworkMimeType,
} from './artwork';

export { ADMIN_ARTWORK_OUTPUT_MAX_EDGE };

export const ADMIN_ARTWORK_MAX_PIXELS = 40_000_000;
/*
 * R19(MD-0030): 휴대폰·카메라 원본(긴 변 4000px 안팎)을 원래 크기 그대로 다시 인코딩하던 검증 단계가
 * 사진마다 수 초씩 걸렸다. 공개 원본은 사진형 이미지의 긴 변을 2560px까지만 둔다(권장 1000×1000의 2.5배).
 * 한 변이 다른 변의 2배를 넘는 띠형 이미지(긴 상세 이미지·가로 배너)는 짧은 변만 2560px로 제한한다 —
 * 긴 변까지 줄이면 860×8000 상세 이미지가 275×2560으로 뭉개진다. 작은 이미지는 키우지 않고,
 * 정사각형은 정사각형으로 남는다(스토어 대표 이미지의 1:1 검사).
 */
const STRIP_ASPECT_RATIO = 2;

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

/** EXIF 회전을 적용한 크기 기준의 축소 상자(fit: inside). 줄일 필요가 없으면 null. */
export function adminArtworkOutputBox(width: number, height: number): { width: number; height: number } | null {
  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge > shortEdge * STRIP_ASPECT_RATIO) {
    if (shortEdge <= ADMIN_ARTWORK_OUTPUT_MAX_EDGE) return null;
    return width < height
      ? { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: ADMIN_ARTWORK_MAX_DIMENSION }
      : { width: ADMIN_ARTWORK_MAX_DIMENSION, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE };
  }
  if (longEdge <= ADMIN_ARTWORK_OUTPUT_MAX_EDGE) return null;
  return { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE };
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

    const oriented = metadata.autoOrient ?? { width, height };
    const box = adminArtworkOutputBox(oriented.width, oriented.height);
    const rotated = image.rotate();
    const sized = box ? rotated.resize({ ...box, fit: 'inside', withoutEnlargement: true }) : rotated;
    // mozjpeg와 PNG 압축 9단계는 파일이 조금 작아지는 대신 인코딩이 여러 배 느리다.
    const output = mimeType === 'image/jpeg'
      ? await sized.jpeg({ quality: 85 }).toBuffer({ resolveWithObject: true })
      : mimeType === 'image/png'
        ? await sized.png({ compressionLevel: 6 }).toBuffer({ resolveWithObject: true })
        : await sized.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });

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

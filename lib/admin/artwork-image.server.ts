import 'server-only';

import sharp from 'sharp';
import {
  ADMIN_ARTWORK_OUTPUT_MAX_EDGE,
  GOODS_ARTWORK_MAX_DIMENSION,
  adminArtworkLimits,
  type AdminArtworkImageRejectReason,
  type AdminArtworkKind,
  type AdminArtworkMimeType,
  type AdminArtworkRejectDetail,
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
    // 긴 변은 종류별 한도로 이미 검사했다. 상자가 그보다 작으면 긴 상세 이미지의 폭까지 줄어든다.
    return width < height
      ? { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: GOODS_ARTWORK_MAX_DIMENSION }
      : { width: GOODS_ARTWORK_MAX_DIMENSION, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE };
  }
  if (longEdge <= ADMIN_ARTWORK_OUTPUT_MAX_EDGE) return null;
  return { width: ADMIN_ARTWORK_OUTPUT_MAX_EDGE, height: ADMIN_ARTWORK_OUTPUT_MAX_EDGE };
}

/*
 * 확인을 거절하면 이유를 돌려준다(artwork.ts AdminArtworkImageRejectReason). 업로드 확인 claim(reject_reason)에 남기고
 * 운영자 안내 문구를 고른다. 2026-11-19까지는 모든 실패가 같은 "확인하지 못했습니다"였고 claim에도 이유가 없어,
 * 확장자와 내용이 다른 파일의 거절 원인을 운영 기록으로 찾을 수 없었다.
 */
export type AdminArtworkImageResult =
  | { ok: true; image: NormalizedAdminArtworkImage }
  | { ok: false; reason: AdminArtworkImageRejectReason; detail: AdminArtworkRejectDetail };

/** 기록용 오류 문구. 경로·스택이 섞이지 않게 첫 줄 앞부분만 남긴다. */
function shortError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.split('\n')[0].slice(0, 160);
}

export async function inspectAdminArtworkImage(
  bytes: Uint8Array,
  mimeType: AdminArtworkMimeType,
  kind: AdminArtworkKind,
): Promise<AdminArtworkImageResult> {
  const { maxBytes, maxDimension } = adminArtworkLimits(kind);
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) {
    return { ok: false, reason: 'size_exceeded', detail: { size: bytes.byteLength, maxBytes } };
  }

  let stage: 'metadata' | 'encode' = 'metadata';
  try {
    const image = sharp(bytes, {
      animated: false,
      failOn: 'error',
      limitInputPixels: ADMIN_ARTWORK_MAX_PIXELS,
    });
    const metadata = await image.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    const declared = SHARP_FORMAT_BY_MIME[mimeType];

    if (metadata.format !== declared) {
      return { ok: false, reason: 'format_mismatch', detail: { declared: mimeType, detected: metadata.format ?? null, width, height } };
    }
    if (width < 1 || height < 1) return { ok: false, reason: 'decode_failed', detail: { width, height } };
    if (width > maxDimension || height > maxDimension) {
      return { ok: false, reason: 'dimension_exceeded', detail: { width, height, maxDimension } };
    }
    if (width * height > ADMIN_ARTWORK_MAX_PIXELS) {
      return { ok: false, reason: 'pixel_limit_exceeded', detail: { width, height, maxPixels: ADMIN_ARTWORK_MAX_PIXELS } };
    }
    if ((metadata.pages ?? 1) !== 1) return { ok: false, reason: 'animated', detail: { pages: metadata.pages ?? null } };

    stage = 'encode';
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
      || output.data.byteLength > maxBytes
      || output.info.width > maxDimension
      || output.info.height > maxDimension
      || output.info.width * output.info.height > ADMIN_ARTWORK_MAX_PIXELS
    ) {
      return {
        ok: false,
        reason: 'output_too_large',
        detail: { size: output.data.byteLength, maxBytes, width: output.info.width, height: output.info.height },
      };
    }

    return {
      ok: true,
      image: {
        bytes: new Uint8Array(output.data),
        height: output.info.height,
        width: output.info.width,
      },
    };
  } catch (error) {
    // sharp의 픽셀 한도(limitInputPixels)는 메타데이터 단계에서 예외로 온다.
    const message = shortError(error);
    if (/pixel limit/i.test(message)) return { ok: false, reason: 'pixel_limit_exceeded', detail: { stage, error: message } };
    return { ok: false, reason: 'decode_failed', detail: { stage, error: message } };
  }
}

export async function normalizeAdminArtworkImage(
  bytes: Uint8Array,
  mimeType: AdminArtworkMimeType,
  kind: AdminArtworkKind,
): Promise<NormalizedAdminArtworkImage | null> {
  const result = await inspectAdminArtworkImage(bytes, mimeType, kind);
  return result.ok ? result.image : null;
}

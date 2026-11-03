'use client';

/*
 * R19(MD-0030): 상품 이미지 타일과 편집기 미리보기가 고른 원본 파일(4000px 안팎)을 그대로 그려, 10장을 한 번에
 * 고르면 원본 크기의 디코딩 메모리(장당 수십 MB)가 쌓여 화면이 멈췄다. 미리보기는 긴 변 800px 사본으로 그린다.
 * 디코딩(createImageBitmap)은 브라우저가 메인 스레드 밖에서 하고, 한 번에 한 장씩만 만들어 순간 메모리를 묶는다.
 * 만들 수 없는 브라우저·파일이면 원본 object URL로 돌아간다(지금과 같은 동작).
 */
export const ADMIN_ARTWORK_PREVIEW_MAX_EDGE = 800;
const PREVIEW_QUALITY = 0.86;

let previewQueue: Promise<unknown> = Promise.resolve();

type PreviewCanvas = OffscreenCanvas | HTMLCanvasElement;

function createCanvas(width: number, height: number): PreviewCanvas | null {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

async function encode(canvas: PreviewCanvas, type: string): Promise<Blob | null> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality: PREVIEW_QUALITY });
  return new Promise(resolve => canvas.toBlob(resolve, type, PREVIEW_QUALITY));
}

async function downscale(file: Blob, maxEdge: number): Promise<Blob | null> {
  if (typeof createImageBitmap !== 'function') return null;
  const source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const longEdge = Math.max(source.width, source.height);
    if (longEdge <= maxEdge) return null;
    const scale = maxEdge / longEdge;
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = createCanvas(width, height);
    const context = canvas?.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null | undefined;
    if (!canvas || !context) return null;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    // JPEG은 투명도가 없어 JPEG으로, 나머지는 투명도를 지키는 WebP로(인코딩을 못 하는 브라우저는 PNG를 돌려준다).
    return encode(canvas, file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp');
  } finally {
    source.close();
  }
}

async function buildPreviewUrl(file: Blob, maxEdge: number): Promise<string> {
  try {
    const preview = await downscale(file, maxEdge);
    if (preview && preview.size > 0) return URL.createObjectURL(preview);
  } catch {
    // 손상·미지원 파일은 원본 그대로 보여 주고, 서버 확인이 최종 판정한다.
  }
  return URL.createObjectURL(file);
}

/**
 * 업로드 미리보기용 object URL. 큰 이미지는 축소 사본, 작거나 축소할 수 없으면 원본이다.
 * 돌려받은 URL은 호출자가 URL.revokeObjectURL로 해제한다.
 */
export function createAdminArtworkPreviewUrl(file: Blob, maxEdge = ADMIN_ARTWORK_PREVIEW_MAX_EDGE): Promise<string> {
  const run = previewQueue.then(() => buildPreviewUrl(file, maxEdge));
  previewQueue = run.catch(() => undefined);
  return run;
}

export type AouadShareResult = 'web-share' | 'clipboard' | 'download' | 'cancelled' | 'unavailable';

export type AouadSharePayload = {
  title: string;
  text: string;
  url: string;
  /** Never include a local student name or avatar in the default card. */
  routeLabel?: string;
  durationLabel?: string;
  /** Explicit opt-in only. The caller owns validation and object URL cleanup. */
  photo?: AouadSharePhoto;
  /** Lets G2 candidates use the same share card pipeline without duplicating it. */
  cardKicker?: string;
  cardHeadline?: string;
  cardFilename?: string;
};

/**
 * A selected local photo may be composed into a result card only when the caller
 * explicitly passes it. URLs are intentionally limited to validated local blob
 * URLs and raster data URLs; the helper never retains or revokes those URLs.
 */
export type AouadSharePhoto =
  | { source: CanvasImageSource }
  | { src: string };

export type AouadShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

const RESULT_CARD_FILENAME = 'last-bell-survival-record.png';
const SHARE_PHOTO_X = 836;
const SHARE_PHOTO_Y = 174;
const SHARE_PHOTO_SIZE = 246;

function cardFilename(payload: AouadSharePayload): string {
  return payload.cardFilename?.trim() || RESULT_CARD_FILENAME;
}

function isShareCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  try {
    return 'name' in error && error.name === 'AbortError';
  } catch {
    return false;
  }
}

function isLocalRasterPhotoUrl(src: string): boolean {
  return src.startsWith('blob:') || /^data:image\/(?:png|jpeg|webp|gif)(?:;[^,]+)?,/i.test(src);
}

async function loadSharePhoto(photo: AouadSharePhoto | undefined): Promise<CanvasImageSource | null> {
  if (!photo) return null;
  if ('source' in photo) return photo.source;
  if (!isLocalRasterPhotoUrl(photo.src) || typeof Image === 'undefined') return null;

  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = photo.src;
    if (typeof image.decode === 'function') {
      await image.decode();
      return image;
    }
    await new Promise<void>((resolve, reject) => {
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => reject(new Error('share photo failed to load')), { once: true });
    });
    return image;
  } catch {
    return null;
  }
}

function isPositiveDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sharePhotoDimensions(photo: CanvasImageSource): { width: number; height: number } | null {
  try {
    const source = photo as unknown as Record<string, unknown>;
    const dimensionPairs = [
      ['naturalWidth', 'naturalHeight'],
      ['videoWidth', 'videoHeight'],
      ['displayWidth', 'displayHeight'],
      ['codedWidth', 'codedHeight'],
      ['width', 'height'],
    ] as const;

    for (const [widthKey, heightKey] of dimensionPairs) {
      const width = source[widthKey];
      const height = source[heightKey];
      if (width === undefined && height === undefined) continue;
      return isPositiveDimension(width) && isPositiveDimension(height) ? { width, height } : null;
    }
  } catch {
    // A malformed CanvasImageSource must not prevent sharing the text-only result.
  }
  return null;
}

function drawSharePhoto(context: CanvasRenderingContext2D, photo: CanvasImageSource | null): void {
  if (!photo) return;
  const dimensions = sharePhotoDimensions(photo);
  if (!dimensions) return;

  const scale = Math.max(SHARE_PHOTO_SIZE / dimensions.width, SHARE_PHOTO_SIZE / dimensions.height);
  const sourceWidth = SHARE_PHOTO_SIZE / scale;
  const sourceHeight = SHARE_PHOTO_SIZE / scale;
  const sourceX = (dimensions.width - sourceWidth) / 2;
  const sourceY = (dimensions.height - sourceHeight) / 2;

  try {
    context.save();
    context.beginPath();
    context.rect(SHARE_PHOTO_X, SHARE_PHOTO_Y, SHARE_PHOTO_SIZE, SHARE_PHOTO_SIZE);
    context.clip();
    context.drawImage(
      photo,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      SHARE_PHOTO_X,
      SHARE_PHOTO_Y,
      SHARE_PHOTO_SIZE,
      SHARE_PHOTO_SIZE,
    );
    context.restore();
    context.strokeStyle = 'rgba(238, 125, 45, .88)';
    context.lineWidth = 4;
    context.strokeRect(SHARE_PHOTO_X, SHARE_PHOTO_Y, SHARE_PHOTO_SIZE, SHARE_PHOTO_SIZE);
  } catch {
    // A failed optional image must never block the privacy-safe default card.
  }
}

async function createResultCard(payload: AouadSharePayload): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext('2d');
    if (!context) return null;

    const background = context.createLinearGradient(0, 0, 1200, 630);
    background.addColorStop(0, '#071014');
    background.addColorStop(0.62, '#132523');
    background.addColorStop(1, '#130c09');
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = 'rgba(235, 225, 205, .42)';
    context.lineWidth = 2;
    context.strokeRect(34, 34, 1132, 562);
    context.fillStyle = '#ee7d2d';
    context.font = '700 30px sans-serif';
    context.fillText(payload.cardKicker ?? 'ALL OF US ARE DEAD: LAST BELL', 84, 130);
    context.fillStyle = '#f4f0e9';
    context.font = '800 78px sans-serif';
    context.fillText(payload.cardHeadline ?? '생존 기록', 80, 250);
    context.fillStyle = '#c9c7c0';
    context.font = '500 34px sans-serif';
    context.fillText(payload.routeLabel ?? '효산고등학교 · 마지막 수업', 84, 337);
    context.fillStyle = '#f4f0e9';
    context.font = '700 42px sans-serif';
    context.fillText(payload.durationLabel ?? '기록을 남겼습니다', 84, 450);
    context.fillStyle = 'rgba(238, 125, 45, .85)';
    context.fillRect(84, 496, 530, 6);

    drawSharePhoto(context, await loadSharePhoto(payload.photo));

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

function createResultCardFile(blob: Blob | null, filename: string): File | null {
  if (!blob || typeof File === 'undefined') return null;
  return new File([blob], filename, { type: blob.type || 'image/png' });
}

async function downloadResultCard(blob: Blob | null, filename: string): Promise<boolean> {
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    return true;
  } catch {
    return false;
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

export async function shareAouadResult(
  payload: AouadSharePayload,
  navigatorRef: AouadShareNavigator = typeof navigator === 'undefined' ? {} : navigator,
): Promise<AouadShareResult> {
  const cardBlob = await createResultCard(payload);
  const filename = cardFilename(payload);
  const cardFile = createResultCardFile(cardBlob, filename);

  if (navigatorRef.share && cardFile) {
    const fileShareData: ShareData = { title: payload.title, text: payload.text, url: payload.url, files: [cardFile] };
    try {
      if (navigatorRef.canShare?.(fileShareData)) {
        await navigatorRef.share(fileShareData);
        return 'web-share';
      }
    } catch (error) {
      if (isShareCancellation(error)) return 'cancelled';
      // Unsupported file sharing falls through to text sharing.
    }
  }

  try {
    if (navigatorRef.share) {
      await navigatorRef.share({ title: payload.title, text: payload.text, url: payload.url });
      return 'web-share';
    }
  } catch (error) {
    if (isShareCancellation(error)) return 'cancelled';
    // An unsupported native share falls through to a local-only alternative.
  }

  if (await downloadResultCard(cardBlob, filename)) return 'download';

  try {
    if (navigatorRef.clipboard) {
      await navigatorRef.clipboard.writeText(`${payload.text}\n${payload.url}`);
      return 'clipboard';
    }
  } catch {
    // Clipboard may be unavailable outside a secure, user-initiated context.
  }

  return 'unavailable';
}

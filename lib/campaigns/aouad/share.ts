export type AouadShareResult = 'web-share' | 'clipboard' | 'download' | 'cancelled' | 'unavailable';

export type AouadSharePayload = {
  title: string;
  text: string;
  url: string;
  /** Never include a local student name or avatar in the default card. */
  routeLabel?: string;
  durationLabel?: string;
};

export type AouadShareNavigator = {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  clipboard?: { writeText: (text: string) => Promise<void> };
};

const RESULT_CARD_FILENAME = 'last-bell-survival-record.png';

function isShareCancellation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  try {
    return 'name' in error && error.name === 'AbortError';
  } catch {
    return false;
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
    context.fillText('ALL OF US ARE DEAD: LAST BELL', 84, 130);
    context.fillStyle = '#f4f0e9';
    context.font = '800 78px sans-serif';
    context.fillText('생존 기록', 80, 250);
    context.fillStyle = '#c9c7c0';
    context.font = '500 34px sans-serif';
    context.fillText(payload.routeLabel ?? '효산고등학교 · 마지막 수업', 84, 337);
    context.fillStyle = '#f4f0e9';
    context.font = '700 42px sans-serif';
    context.fillText(payload.durationLabel ?? '기록을 남겼습니다', 84, 450);
    context.fillStyle = 'rgba(238, 125, 45, .85)';
    context.fillRect(84, 496, 530, 6);

    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  } catch {
    return null;
  }
}

function createResultCardFile(blob: Blob | null): File | null {
  if (!blob || typeof File === 'undefined') return null;
  return new File([blob], RESULT_CARD_FILENAME, { type: blob.type || 'image/png' });
}

async function downloadResultCard(blob: Blob | null): Promise<boolean> {
  if (!blob || typeof document === 'undefined' || typeof URL === 'undefined') return false;
  let url: string | null = null;
  try {
    url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = RESULT_CARD_FILENAME;
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
  const cardFile = createResultCardFile(cardBlob);

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

  if (await downloadResultCard(cardBlob)) return 'download';

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

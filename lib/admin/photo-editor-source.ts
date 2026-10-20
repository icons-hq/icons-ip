import { normalizePublicMediaPath, publicMediaUrl } from '@/lib/media';
import { parseAdminArtworkPath } from './artwork';

export const PHOTO_EDIT_MAX_BYTES = 5 * 1024 * 1024;
export const PHOTO_EDIT_MAX_PIXELS = 4_000_000;
export const PHOTO_EDIT_MAX_DIMENSION = 4096;
export type PhotoSourceMetadata = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  orientation?: number;
};

const INVALID = '사진 파일의 구조를 확인할 수 없습니다. 원본 파일을 다시 선택해주세요.';
const TOO_LARGE = '사진 편집은 5MB 이하, 가로·세로 4096px 이하, 총 400만 픽셀 이하만 지원합니다.';
const ANIMATED = '움직이는 사진이나 여러 장이 묶인 사진은 편집할 수 없습니다. 정지 사진을 선택해주세요.';
class PhotoSourceError extends Error {}
function fail(message = INVALID): never { throw new PhotoSourceError(message); }
function dimensions(width: number, height: number) {
  if (!width || !height) fail();
  if (width > PHOTO_EDIT_MAX_DIMENSION || height > PHOTO_EDIT_MAX_DIMENSION || width * height > PHOTO_EDIT_MAX_PIXELS) fail(TOO_LARGE);
  return { width, height };
}
function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}
function view(bytes: Uint8Array) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
function mime(value: string) { return value.split(';', 1)[0].trim().toLowerCase(); }

/** Read only IFD0 orientation; embedded thumbnail orientation is not the source orientation. */
function exifOrientation(bytes: Uint8Array): number | undefined {
  if (ascii(bytes, 0, 6) === 'Exif\0\0') bytes = bytes.subarray(6);
  if (bytes.length < 8) fail();
  const order = ascii(bytes, 0, 2), little = order === 'II', data = view(bytes);
  if (order !== 'II' && order !== 'MM' || data.getUint16(2, little) !== 42) fail();
  const offset = data.getUint32(4, little);
  if (offset < 8 || offset + 2 > bytes.length) fail();
  const count = data.getUint16(offset, little);
  if (offset + 2 + count * 12 + 4 > bytes.length) fail();
  let orientation: number | undefined;
  for (let entry = offset + 2; entry < offset + 2 + count * 12; entry += 12) {
    if (data.getUint16(entry, little) !== 0x0112) continue;
    if (orientation !== undefined || data.getUint16(entry + 2, little) !== 3 || data.getUint32(entry + 4, little) !== 1) fail();
    orientation = data.getUint16(entry + 8, little);
    if (orientation < 1 || orientation > 8) fail();
  }
  return orientation;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
  return value >>> 0;
});
function crc32(bytes: Uint8Array, start: number, end: number) {
  let value = 0xffffffff;
  for (let index = start; index < end; index++) value = CRC_TABLE[(value ^ bytes[index]) & 255] ^ value >>> 8;
  return (value ^ 0xffffffff) >>> 0;
}

function inspectPng(bytes: Uint8Array): PhotoSourceMetadata {
  const data = view(bytes);
  let result: PhotoSourceMetadata | undefined, offset = 8, palette = false, image = false, imageEnded = false, exif = false;
  let colorType = 0, imageBytes = 0;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail();
    const length = data.getUint32(offset), type = ascii(bytes, offset + 4, 4), start = offset + 8, end = start + length;
    if (end + 4 > bytes.length || !/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) fail();
    if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail(ANIMATED);
    if (crc32(bytes, offset + 4, end) !== data.getUint32(end)) fail();
    if (!result && type !== 'IHDR') fail();
    if (image && type !== 'IDAT') imageEnded = true;
    if (type === 'IHDR') {
      if (result || length !== 13) fail();
      const depth = bytes[start + 8]; colorType = bytes[start + 9];
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!depths[colorType]?.includes(depth) || bytes[start + 10] !== 0 || bytes[start + 11] !== 0 || bytes[start + 12] > 1) fail();
      result = { mimeType: 'image/png', ...dimensions(data.getUint32(start), data.getUint32(start + 4)) };
    } else if (type === 'PLTE') {
      if (palette || image || length < 3 || length > 768 || length % 3 || colorType === 0 || colorType === 4) fail();
      palette = true;
    } else if (type === 'IDAT') {
      if (imageEnded || colorType === 3 && !palette) fail();
      image = true; imageBytes += length;
    } else if (type === 'IEND') {
      if (length || !imageBytes || end + 4 !== bytes.length) fail();
      return result!;
    } else if (type === 'eXIf') {
      if (exif) fail();
      exif = true;
      const orientation = exifOrientation(bytes.subarray(start, end));
      if (orientation !== undefined) result!.orientation = orientation;
    } else if (type[0] === type[0].toUpperCase()) fail();
    offset = end + 4;
  }
  return fail();
}

function inspectJpeg(bytes: Uint8Array): PhotoSourceMetadata {
  const data = view(bytes);
  let offset = 2, result: PhotoSourceMetadata | undefined, orientation: number | undefined, exif = false, scan = false;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) fail();
    while (bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) fail();
    const marker = bytes[offset++];
    if (marker === 0xd9) {
      if (!result || !scan || offset !== bytes.length) fail();
      return orientation === undefined ? result : { ...result, orientation };
    }
    if (marker === 0xd8) fail(ANIMATED);
    if (marker === 0x00 || marker === 0x01 || marker >= 0xd0 && marker <= 0xd7 || offset + 2 > bytes.length) fail();
    const length = data.getUint16(offset), start = offset + 2, end = offset + length;
    if (length < 2 || end > bytes.length) fail();
    if (![0xc0, 0xc1, 0xc2, 0xc4, 0xda, 0xdb, 0xdd, 0xfe].includes(marker) && !(marker >= 0xe0 && marker <= 0xef)) fail();
    if (marker === 0xdd && length !== 4) fail();
    if (marker === 0xe2 && ascii(bytes, start, 4) === 'MPF\0') fail(ANIMATED);
    if (marker === 0xe1 && ascii(bytes, start, 6) === 'Exif\0\0') {
      if (exif) fail();
      exif = true; orientation = exifOrientation(bytes.subarray(start, end));
    }
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (result || ![0xc0, 0xc1, 0xc2].includes(marker) || length < 8 || bytes[start] !== 8) fail();
      const components = bytes[start + 5];
      if (![1, 3, 4].includes(components) || length !== 8 + 3 * components) fail();
      result = { mimeType: 'image/jpeg', ...dimensions(data.getUint16(start + 3), data.getUint16(start + 1)) };
    }
    offset = end;
    if (marker === 0xda) {
      const components = bytes[start];
      if (!result || components < 1 || components > 4 || length !== 6 + 2 * components) fail();
      scan = true;
      // Entropy bytes may contain stuffed FF00 and restart markers; neither starts a new image.
      while (offset < bytes.length) {
        if (bytes[offset] !== 0xff) { offset++; continue; }
        const markerStart = offset++;
        while (bytes[offset] === 0xff) offset++;
        if (offset >= bytes.length) fail();
        if (bytes[offset] === 0 || bytes[offset] >= 0xd0 && bytes[offset] <= 0xd7) { offset++; continue; }
        offset = markerStart; break;
      }
    }
  }
  return fail();
}

function inspectWebp(bytes: Uint8Array): PhotoSourceMetadata {
  const data = view(bytes);
  if (bytes.length < 20 || data.getUint32(4, true) + 8 !== bytes.length) fail();
  let offset = 12, result: PhotoSourceMetadata | undefined, canvas: { width: number; height: number } | undefined;
  let flags = 0, alpha = false, exif = false, profile = false, xmp = false, orientation: number | undefined;
  const uint24 = (start: number) => bytes[start] + bytes[start + 1] * 256 + bytes[start + 2] * 65536;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail();
    const type = ascii(bytes, offset, 4), length = data.getUint32(offset + 4, true), start = offset + 8, end = start + length;
    if (end + (length % 2) > bytes.length || !/^[\x20-\x7e]{4}$/.test(type) || length % 2 && bytes[end] !== 0) fail();
    if (type === 'ANIM' || type === 'ANMF') fail(ANIMATED);
    if (type === 'VP8X') {
      if (offset !== 12 || length !== 10 || canvas) fail();
      flags = bytes[start];
      if (flags & 2) fail(ANIMATED);
      if (flags & 0xc1 || uint24(start + 1)) fail();
      canvas = dimensions(uint24(start + 4) + 1, uint24(start + 7) + 1);
    } else if (type === 'VP8 ' || type === 'VP8L') {
      if (result) fail(ANIMATED);
      let width: number, height: number;
      if (type === 'VP8 ') {
        if (length < 10 || bytes[start] & 1 || !(bytes[start] & 0x10) || (bytes[start] >>> 1 & 7) > 3
          || bytes[start + 3] !== 0x9d || bytes[start + 4] !== 0x01 || bytes[start + 5] !== 0x2a) fail();
        width = data.getUint16(start + 6, true); height = data.getUint16(start + 8, true);
        if (width & 0xc000 || height & 0xc000) fail();
      } else {
        if (length < 5 || bytes[start] !== 0x2f || bytes[start + 4] & 0xe0 || alpha) fail();
        const header = data.getUint32(start + 1, true);
        width = (header & 0x3fff) + 1; height = (header >>> 14 & 0x3fff) + 1;
      }
      result = { mimeType: 'image/webp', ...dimensions(width, height) };
      if (canvas && (canvas.width !== width || canvas.height !== height)) fail();
    } else if (type === 'ALPH') {
      if (!canvas || !(flags & 0x10) || alpha || result || !length || bytes[start] & 0xc0 || (bytes[start] & 3) > 1 || (bytes[start] >>> 4 & 3) > 1) fail();
      alpha = true;
    } else if (type === 'EXIF') {
      if (!canvas || !(flags & 8) || exif || !result) fail();
      exif = true; orientation = exifOrientation(bytes.subarray(start, end));
    } else if (type === 'ICCP') {
      if (!canvas || !(flags & 0x20) || profile || result || !length) fail();
      profile = true;
    } else if (type === 'XMP ') {
      if (!canvas || !(flags & 4) || xmp || !result || !length) fail();
      xmp = true;
    } else if (!canvas && !result) fail();
    offset = end + length % 2;
  }
  if (!result || Boolean(flags & 8) !== exif || Boolean(flags & 0x20) !== profile || Boolean(flags & 4) !== xmp) fail();
  return orientation === undefined ? result : { ...result, orientation };
}

/** Checks headers/container boundaries before decoding, not compressed pixel correctness. */
export function inspectPhotoSource(bytes: Uint8Array, claimedMime?: string): PhotoSourceMetadata {
  if (!bytes.length) fail();
  if (bytes.length > PHOTO_EDIT_MAX_BYTES) fail(TOO_LARGE);
  let result: PhotoSourceMetadata;
  if (bytes[0] === 0xff && bytes[1] === 0xd8) result = inspectJpeg(bytes);
  else if (ascii(bytes, 0, 8) === '\x89PNG\r\n\x1a\n') result = inspectPng(bytes);
  else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') result = inspectWebp(bytes);
  else return fail('JPEG·PNG·WebP 형식의 정지 사진만 편집할 수 있습니다.');
  if (claimedMime !== undefined && mime(claimedMime) !== result.mimeType) fail('사진의 형식 표시와 실제 파일이 다릅니다. 원본 파일을 다시 선택해주세요.');
  return result;
}

function aborted() { return new DOMException('사진 읽기를 취소했습니다.', 'AbortError'); }
function checkAbort(signal: AbortSignal) { if (signal.aborted) throw aborted(); }
function isAbort(error: unknown) { return error instanceof Error && error.name === 'AbortError'; }

async function readLimitedBody(response: Response, signal: AbortSignal) {
  if (!response.body) return fail('사진 데이터를 읽지 못했습니다. 원본 파일을 다시 선택해주세요.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0, finished = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    checkAbort(signal);
    while (true) {
      const { done, value } = await reader.read();
      checkAbort(signal);
      if (done) { finished = true; break; }
      total += value.byteLength;
      if (total > PHOTO_EDIT_MAX_BYTES) fail(TOO_LARGE);
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return bytes;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function loadPhotoSource(sourcePath: string, signal: AbortSignal): Promise<{ blob: Blob; metadata: PhotoSourceMetadata }> {
  checkAbort(signal);
  const parsed = parseAdminArtworkPath(normalizePublicMediaPath(sourcePath));
  if (!parsed || parsed.kind !== 'good') fail('저장된 상품 사진만 편집할 수 있습니다. 원본 파일을 다시 선택해주세요.');
  const url = publicMediaUrl(parsed.path);
  if (!url) fail('사진 저장소에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
  let response: Response;
  try {
    response = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal });
  } catch (error) {
    if (signal.aborted || isAbort(error)) throw aborted();
    return fail('사진을 불러오지 못했습니다. 연결 상태를 확인한 뒤 다시 열거나 원본 파일을 다시 선택해주세요.');
  }
  try {
    checkAbort(signal);
    if (!response.ok || response.type === 'opaque' || response.redirected) fail('사진을 읽지 못했습니다. 사진이 삭제되었거나 접근할 수 없습니다.');
    const contentType = response.headers.get('content-type');
    if (!contentType || mime(contentType) !== parsed.mimeType) fail('사진의 형식 표시와 저장 경로가 다릅니다. 원본 파일을 다시 선택해주세요.');
    const lengthText = response.headers.get('content-length');
    const length = lengthText === null ? null : /^\d+$/.test(lengthText) ? Number(lengthText) : NaN;
    if (length !== null && (!Number.isSafeInteger(length) || length <= 0)) fail();
    if (length !== null && length > PHOTO_EDIT_MAX_BYTES) fail(TOO_LARGE);
    const bytes = await readLimitedBody(response, signal);
    checkAbort(signal);
    if (length !== null && bytes.length !== length) fail('사진을 끝까지 읽지 못했습니다. 다시 시도하거나 원본 파일을 다시 선택해주세요.');
    const metadata = inspectPhotoSource(bytes, contentType);
    return { blob: new Blob([bytes], { type: metadata.mimeType }), metadata };
  } catch (error) {
    await response.body?.cancel().catch(() => {});
    if (signal.aborted || isAbort(error)) throw aborted();
    if (error instanceof PhotoSourceError) throw error;
    return fail('사진을 끝까지 읽지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해주세요.');
  }
}

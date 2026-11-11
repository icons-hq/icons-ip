/*
 * 이미지 머리 바이트에서 고유 크기를 읽는다 — 높이가 이미지 비율로만 정해지는 셸 띠배너(notice-strip.server.ts)에
 * width·height 를 달아, 이미지가 첫 페인트 뒤에 와도 자리가 미리 잡히게 한다(CLS). 어드민 아트웍 형식(jpg·png·webp,
 * lib/admin/artwork.ts)만 읽고, 모르는 형식·잘린 머리·SOF 가 읽은 범위 밖인 JPEG 는 null 이다(속성 없이 그리던 그대로).
 */

export interface ImageSize {
  width: number;
  height: number;
}

/** 머리를 읽을 범위 — PNG·WebP 는 30바이트 안, JPEG 는 EXIF·ICC 뒤 SOF 까지라 넉넉히 둔다. */
export const IMAGE_SIZE_PROBE_BYTES = 65_536;

const valid = (width: number, height: number): ImageSize | null =>
  width > 0 && height > 0 ? { width, height } : null;

const ascii = (bytes: Uint8Array, start: number, text: string) =>
  [...text].every((character, index) => bytes[start + index] === character.charCodeAt(0));

const u16be = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1];
const u16le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8);
const u24le = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
const u32be = (bytes: Uint8Array, at: number) => ((bytes[at] << 24) >>> 0) + ((bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]);

function pngSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 24 || !ascii(bytes, 12, 'IHDR')) return null;
  return valid(u32be(bytes, 16), u32be(bytes, 20));
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 25) return null;
  if (ascii(bytes, 12, 'VP8L')) {
    if (bytes[20] !== 0x2f) return null;
    const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
    return valid(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)));
  }
  if (bytes.length < 30) return null;
  if (ascii(bytes, 12, 'VP8X')) return valid(1 + u24le(bytes, 24), 1 + u24le(bytes, 27));
  if (ascii(bytes, 12, 'VP8 ')) {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return valid(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff);
  }
  return null;
}

/* SOF0~15 중 DHT(C4)·JPG(C8)·DAC(CC)를 뺀 프레임 머리. */
const JPEG_FRAME_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1];
    if (marker === 0xff) {
      at += 1; // 채움 바이트
      continue;
    }
    if (JPEG_FRAME_MARKERS.has(marker)) return valid(u16be(bytes, at + 7), u16be(bytes, at + 5));
    if (marker === 0xda || marker === 0xd9) return null; // 스캔·끝에 닿도록 프레임 머리가 없었다.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2; // 길이 없는 표지
      continue;
    }
    at += 2 + u16be(bytes, at + 2);
  }
  return null;
}

export function imageSizeFromBytes(bytes: Uint8Array): ImageSize | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 'PNG\r\n\x1a\n')) return pngSize(bytes);
  if (bytes.length >= 12 && ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return webpSize(bytes);
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes);
  return null;
}

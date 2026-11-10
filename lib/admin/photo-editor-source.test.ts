import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import {
  inspectPhotoSource, loadPhotoSource, PHOTO_EDIT_MAX_BYTES, PHOTO_EDIT_MAX_DIMENSION, PHOTO_EDIT_MAX_PIXELS,
} from './photo-editor-source';

const text = (value: string) => Uint8Array.from(value, letter => letter.charCodeAt(0));
function join(...values: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let offset = 0;
  for (const value of values) { result.set(value, offset); offset += value.length; }
  return result;
}
const bytes = (...values: number[]) => Uint8Array.from(values);
function pngChunk(type: string, payload = new Uint8Array(0)) {
  const result = new Uint8Array(payload.length + 12), view = new DataView(result.buffer);
  view.setUint32(0, payload.length); result.set(text(type), 4); result.set(payload, 8);
  let crc = 0xffffffff;
  for (const value of result.subarray(4, result.length - 4)) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? crc >>> 1 ^ 0xedb88320 : crc >>> 1;
  }
  view.setUint32(result.length - 4, (crc ^ 0xffffffff) >>> 0);
  return result;
}
function pngHeader(width = 80, height = 40) {
  const data = new Uint8Array(13), view = new DataView(data.buffer);
  view.setUint32(0, width); view.setUint32(4, height); data[8] = 8; data[9] = 6;
  return pngChunk('IHDR', data);
}
const PNG_START = bytes(137, 80, 78, 71, 13, 10, 26, 10);
const PNG_DATA = pngChunk('IDAT', bytes(120, 156, 99, 0, 0, 0, 1, 0, 1));
function png(width = 80, height = 40, extras: Uint8Array[] = []) {
  return join(PNG_START, pngHeader(width, height), ...extras, PNG_DATA, pngChunk('IEND'));
}
function exif(orientation: number, little = true) {
  const result = new Uint8Array(26), view = new DataView(result.buffer);
  result.set(text(little ? 'II' : 'MM'));
  view.setUint16(2, 42, little); view.setUint32(4, 8, little); view.setUint16(8, 1, little);
  view.setUint16(10, 0x0112, little); view.setUint16(12, 3, little); view.setUint32(14, 1, little); view.setUint16(18, orientation, little);
  return result;
}
function jpegSegment(marker: number, payload: Uint8Array) {
  return join(bytes(0xff, marker, (payload.length + 2) >>> 8, (payload.length + 2) & 255), payload);
}
function jpeg(width = 80, height = 40, extras: Uint8Array[] = [], frame = 0xc0) {
  const sof = jpegSegment(frame, bytes(8, height >>> 8, height & 255, width >>> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1));
  const sos = jpegSegment(0xda, bytes(3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0));
  return join(bytes(0xff, 0xd8), ...extras, sof, sos, bytes(1, 0xff, 0, 2, 0xff, 0xd0, 3, 0xff, 0xd9));
}
function webpChunk(type: string, payload: Uint8Array) {
  const result = new Uint8Array(8 + payload.length + payload.length % 2);
  result.set(text(type)); new DataView(result.buffer).setUint32(4, payload.length, true); result.set(payload, 8);
  return result;
}
function riff(...chunks: Uint8Array[]) {
  const result = join(text('RIFF'), new Uint8Array(4), text('WEBP'), ...chunks);
  new DataView(result.buffer).setUint32(4, result.length - 8, true);
  return result;
}
function vp8(width = 80, height = 40) {
  return webpChunk('VP8 ', bytes(0x10, 0, 0, 0x9d, 1, 0x2a, width & 255, width >>> 8, height & 255, height >>> 8, 0));
}
function vp8l(width = 80, height = 40) {
  const payload = new Uint8Array(6);
  payload[0] = 0x2f; new DataView(payload.buffer).setUint32(1, (width - 1) | (height - 1) << 14, true);
  return webpChunk('VP8L', payload);
}
function vp8x(width = 80, height = 40, flags = 0) {
  const payload = new Uint8Array(10); payload[0] = flags;
  for (let index = 0; index < 3; index++) { payload[4 + index] = (width - 1) >>> (index * 8); payload[7 + index] = (height - 1) >>> (index * 8); }
  return webpChunk('VP8X', payload);
}

describe('inspectPhotoSource: bounded container inspection before decoding', () => {
  it('publishes the browser editing limits', () => {
    expect([PHOTO_EDIT_MAX_BYTES, PHOTO_EDIT_MAX_DIMENSION, PHOTO_EDIT_MAX_PIXELS]).toEqual([5 * 1024 * 1024, 4096, 4_000_000]);
  });
  it.each([
    ['PNG', png(), 'image/png'], ['baseline JPEG', jpeg(), 'image/jpeg'], ['progressive JPEG', jpeg(80, 40, [], 0xc2), 'image/jpeg'],
    ['VP8 WebP', riff(vp8()), 'image/webp'], ['VP8L WebP', riff(vp8l()), 'image/webp'], ['VP8X WebP', riff(vp8x(), vp8()), 'image/webp'],
  ] as const)('reads %s dimensions without decoding pixels', (_label, data, mimeType) => {
    expect(inspectPhotoSource(data, mimeType)).toEqual({ mimeType, width: 80, height: 40 });
  });
  it('handles non-zero Uint8Array byte offsets and MIME parameters', () => {
    const data = png(), wrapped = join(bytes(1, 2, 3), data, bytes(0));
    expect(inspectPhotoSource(wrapped.subarray(3, -1), 'IMAGE/PNG; charset=binary').width).toBe(80);
  });
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('reads JPEG EXIF orientation %i in either endian order', orientation => {
    for (const little of [true, false]) {
      expect(inspectPhotoSource(jpeg(80, 40, [jpegSegment(0xe1, join(text('Exif\0\0'), exif(orientation, little)))])))
        .toEqual({ mimeType: 'image/jpeg', width: 80, height: 40, orientation });
    }
  });
  it('reports PNG and extended WebP EXIF orientation too', () => {
    expect(inspectPhotoSource(png(80, 40, [pngChunk('eXIf', exif(6))])).orientation).toBe(6);
    expect(inspectPhotoSource(riff(vp8x(80, 40, 8), vp8(), webpChunk('EXIF', exif(8)))).orientation).toBe(8);
  });
  it.each([0, 9])('rejects malformed EXIF orientation %i', orientation => {
    expect(() => inspectPhotoSource(jpeg(80, 40, [jpegSegment(0xe1, join(text('Exif\0\0'), exif(orientation)))]))).toThrow('구조');
  });
  it('rejects out-of-bounds EXIF entries and duplicate orientation documents', () => {
    const bad = exif(6); new DataView(bad.buffer).setUint32(4, 0xfffffff0, true);
    expect(() => inspectPhotoSource(png(80, 40, [pngChunk('eXIf', bad)]))).toThrow('구조');
    const app = jpegSegment(0xe1, join(text('Exif\0\0'), exif(6)));
    expect(() => inspectPhotoSource(jpeg(80, 40, [app, app]))).toThrow('구조');
  });
  it.each(['image/jpeg', 'image/webp', 'image/svg+xml', ''])('rejects claimed MIME %s for PNG bytes', claimed => {
    expect(() => inspectPhotoSource(png(), claimed)).toThrow('실제 파일');
  });
  it.each([png, jpeg, (w: number, h: number) => riff(vp8l(w, h))])('enforces pixel and side limits on each format', create => {
    expect(inspectPhotoSource(create(2000, 2000)).width).toBe(2000);
    expect(inspectPhotoSource(create(4096, 1)).width).toBe(4096);
    expect(() => inspectPhotoSource(create(2001, 2000))).toThrow('400만');
    expect(() => inspectPhotoSource(create(4097, 1))).toThrow('4096');
  });
  it('accepts exactly 5MiB but rejects one extra byte before inspecting', () => {
    const base = png();
    const exact = png(80, 40, [pngChunk('teSt', new Uint8Array(PHOTO_EDIT_MAX_BYTES - base.length - 12))]);
    expect(exact.length).toBe(PHOTO_EDIT_MAX_BYTES);
    expect(inspectPhotoSource(exact).width).toBe(80);
    expect(() => inspectPhotoSource(join(exact, bytes(0)))).toThrow('5MB');
  });
  it.each(['acTL', 'fcTL', 'fdAT'])('rejects APNG %s even when its advertised frame count is one', type => {
    expect(() => inspectPhotoSource(png(80, 40, [pngChunk(type, bytes(0, 0, 0, 1, 0, 0, 0, 0))]))).toThrow('움직이는');
  });
  it.each(['ANIM', 'ANMF'])('rejects WebP %s regardless of animation flag', type => {
    expect(() => inspectPhotoSource(riff(vp8x(), vp8(), webpChunk(type, new Uint8Array(8))))).toThrow('움직이는');
  });
  it('rejects the WebP animation flag, duplicate frames, and canvas/bitstream mismatch', () => {
    expect(() => inspectPhotoSource(riff(vp8x(80, 40, 2), vp8()))).toThrow('움직이는');
    expect(() => inspectPhotoSource(riff(vp8(), vp8l()))).toThrow('여러 장');
    expect(() => inspectPhotoSource(riff(vp8x(79, 40), vp8()))).toThrow('구조');
  });
  it('rejects JPEG MPO and concatenated or duplicate frames', () => {
    expect(() => inspectPhotoSource(jpeg(80, 40, [jpegSegment(0xe2, join(text('MPF\0'), new Uint8Array(12)))]))).toThrow('여러 장');
    expect(() => inspectPhotoSource(join(jpeg(), jpeg()))).toThrow('구조');
    expect(() => inspectPhotoSource(jpeg(80, 40, [bytes(0xff, 0xd8)]))).toThrow('여러 장');
  });
  it.each([png(), jpeg(), riff(vp8()), riff(vp8l())])('rejects truncated headers, missing ends, and trailing data', data => {
    for (const length of [1, 7, 12, data.length - 1]) expect(() => inspectPhotoSource(data.subarray(0, length))).toThrow();
    expect(() => inspectPhotoSource(join(data, bytes(0)))).toThrow();
  });
  it('rejects PNG CRC errors, duplicate IHDR, missing image data and zero dimensions', () => {
    const bad = png(); bad[16] ^= 1;
    expect(() => inspectPhotoSource(bad)).toThrow('구조');
    expect(() => inspectPhotoSource(png(80, 40, [pngHeader()]))).toThrow('구조');
    expect(() => inspectPhotoSource(join(PNG_START, pngHeader(), pngChunk('IEND')))).toThrow('구조');
    expect(() => inspectPhotoSource(png(0, 1))).toThrow('구조');
  });
  it('rejects impossible WebP chunk lengths, reserved bits, and invalid codec headers', () => {
    const overflow = riff(vp8()); new DataView(overflow.buffer).setUint32(16, 0xffffffff, true);
    expect(() => inspectPhotoSource(overflow)).toThrow('구조');
    expect(() => inspectPhotoSource(riff(vp8x(80, 40, 1), vp8()))).toThrow('구조');
    const invalidKey = riff(vp8()); invalidKey[20] |= 1;
    expect(() => inspectPhotoSource(invalidKey)).toThrow('구조');
    const invalidVersion = riff(vp8l()); invalidVersion[24] |= 0xe0;
    expect(() => inspectPhotoSource(invalidVersion)).toThrow('구조');
  });
  it('rejects unknown image formats and unsupported JPEG frame headers', () => {
    expect(() => inspectPhotoSource(text('<svg width="1" height="1"/>'), 'image/png')).toThrow('정지 사진');
    expect(() => inspectPhotoSource(text('GIF89a'))).toThrow('정지 사진');
    expect(() => inspectPhotoSource(jpeg(80, 40, [], 0xc3))).toThrow('구조');
  });
  it.each(['png', 'jpeg', 'webp'] as const)('accepts the server encoder %s output with EXIF without writing an image file', async format => {
    const encoded = await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 255, g: 30, b: 100, alpha: 0.4 } } })
      .withMetadata({ orientation: 6 })[format]().toBuffer();
    expect(inspectPhotoSource(encoded)).toEqual({ mimeType: `image/${format}`, width: 80, height: 40, orientation: 6 });
  });
  it('accepts lossless alpha WebP, palette PNG and progressive JPEG server encoding', async () => {
    const source = () => sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 10, g: 100, b: 240, alpha: 0.5 } } });
    for (const encoded of await Promise.all([
      source().webp({ lossless: true }).toBuffer(), source().png({ palette: true }).toBuffer(), source().jpeg({ progressive: true }).toBuffer(),
    ])) expect(inspectPhotoSource(encoded)).toMatchObject({ width: 80, height: 40 });
  });
});

const PATH = 'public-media/catalog/good/123e4567-e89b-42d3-a456-426614174000.png';
const BASE = 'https://media.example.test';
const request = vi.fn<typeof fetch>();
function response(data = png(), headers: Record<string, string> = {}) {
  return new Response(data, { headers: { 'content-type': 'image/png', ...headers } });
}
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', BASE);
  vi.stubGlobal('fetch', request); request.mockReset(); request.mockResolvedValue(response());
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('loadPhotoSource: only bounded public good artwork', () => {
  it('uses a normalized storage URL with CORS, no credentials and the caller signal', async () => {
    const signal = new AbortController().signal;
    const result = await loadPhotoSource(`/${PATH}`, signal);
    expect(request).toHaveBeenCalledExactlyOnceWith(`${BASE}/storage/v1/object/public/${PATH}`, {
      mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal,
    });
    expect(result.metadata).toEqual({ mimeType: 'image/png', width: 80, height: 40 });
    expect(result.blob.type).toBe('image/png');
    expect(new Uint8Array(await result.blob.arrayBuffer())).toEqual(png());
  });
  it.each([
    'https://evil.test/image.png', 'blob:https://media.example.test/abc', 'data:image/png;base64,abc',
    PATH.replace('/good/', '/ip/'), PATH.replace('/good/', '/good/../good/'), PATH.replace('/good/', '/good/%2e%2e/good/'),
    `${PATH}?download=1`, `${PATH}#fragment`, '',
  ])('rejects unsupported source path %s before fetch', async path => {
    await expect(loadPhotoSource(path, new AbortController().signal)).rejects.toThrow('저장된 상품 사진');
    expect(request).not.toHaveBeenCalled();
  });
  it('does not fetch when the storage URL is unavailable', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('저장소');
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a CORS/network failure with actionable Korean text', async () => {
    request.mockRejectedValue(new TypeError('private network detail'));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('연결 상태를 확인한 뒤 다시 열거나 원본 파일을 다시 선택해주세요.');
  });
  it.each(['status', 'opaque', 'redirect'])('rejects unusable %s responses', async kind => {
    const result = kind === 'status' ? new Response('missing', { status: 404 }) : response();
    if (kind === 'opaque') Object.defineProperty(result, 'type', { value: 'opaque' });
    if (kind === 'redirect') Object.defineProperty(result, 'redirected', { value: true });
    request.mockResolvedValue(result);
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('접근할 수 없습니다');
  });
  it.each(['image/jpeg', 'image/svg+xml', 'application/octet-stream', ''])('rejects HTTP MIME %s that contradicts the path', async contentType => {
    request.mockResolvedValue(response(png(), { 'content-type': contentType }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('저장 경로');
  });
  it('rejects bytes that contradict both the path and HTTP MIME', async () => {
    request.mockResolvedValue(response(jpeg()));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('실제 파일');
  });
  it.each(['0', '-1', '1.5', 'NaN', '9007199254740993'])('rejects invalid Content-Length %s', async length => {
    request.mockResolvedValue(response(png(), { 'content-length': length }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('구조');
  });
  it('checks Content-Length before reading a body larger than the limit', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    request.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png', 'content-length': String(PHOTO_EDIT_MAX_BYTES + 1) } }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('5MB');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([undefined, '1'])('caps streamed bytes when Content-Length is %s', async length => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(PHOTO_EDIT_MAX_BYTES)); controller.enqueue(bytes(1));
    }, cancel });
    request.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png', ...(length ? { 'content-length': length } : {}) } }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('5MB');
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each([-1, 1])('rejects a %i byte length mismatch after reading', async delta => {
    request.mockResolvedValue(response(png(), { 'content-length': String(png().length + delta) }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('끝까지');
  });
  it('accepts an exact Content-Length and several streamed chunks', async () => {
    const data = png(), body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(data.slice(0, 10)); controller.enqueue(data.slice(10)); controller.close();
    } });
    request.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png', 'content-length': String(data.length) } }));
    expect((await loadPhotoSource(PATH, new AbortController().signal)).blob.size).toBe(data.length);
  });
  it('distinguishes an already aborted request without fetching', async () => {
    const controller = new AbortController(); controller.abort(new Error('custom abort reason'));
    await expect(loadPhotoSource(PATH, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(request).not.toHaveBeenCalled();
  });
  it('distinguishes an abort while fetch is pending', async () => {
    request.mockRejectedValue(new DOMException('aborted', 'AbortError'));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('cancels a pending stream read on abort and releases its reader', async () => {
    const controller = new AbortController(), cancel = vi.fn(), body = new ReadableStream<Uint8Array>({ cancel });
    request.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } }));
    const pending = loadPhotoSource(PATH, controller.signal);
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancel).toHaveBeenCalledTimes(1); expect(body.locked).toBe(false);
  });
  it('does not expose stream implementation errors', async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.error(new Error('private stream detail')); } });
    request.mockResolvedValue(new Response(body, { headers: { 'content-type': 'image/png' } }));
    await expect(loadPhotoSource(PATH, new AbortController().signal)).rejects.toThrow('연결 상태');
  });
});
